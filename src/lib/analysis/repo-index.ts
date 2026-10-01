import type { AnalysisMode, CodeLocation, LanguageStat, RepoMeta } from '@/types';
import {
  CODE_LANGUAGES,
  detectLanguage,
  extensionOf,
  isConfigPath,
  isDocPath,
  isGeneratedPath,
  isTestPath,
  isVendorPath,
  MANIFEST_FILES,
} from './languages';

export interface RepoFile {
  path: string;
  dir: string;
  base: string;
  ext: string;
  language: string;
  /** Raw byte length. */
  size: number;
  content: string;
  lines: string[];
  /** Non-blank, non-comment lines. */
  loc: number;
  isTest: boolean;
  isConfig: boolean;
  isGenerated: boolean;
  isVendor: boolean;
  isDoc: boolean;
  /** True for languages we run source rules against. */
  isCode: boolean;
}

export interface SearchMatch {
  file: RepoFile;
  /** 1-based. */
  line: number;
  column: number;
  text: string;
  match: string;
  groups: string[];
}

export interface SearchOptions {
  /** Restrict by language name. */
  languages?: string[];
  /** Restrict by path predicate. */
  pathFilter?: (path: string) => boolean;
  /** Skip test files. Defaults to true — test code is allowed to be scrappy. */
  skipTests?: boolean;
  skipVendor?: boolean;
  skipGenerated?: boolean;
  maxMatches?: number;
  /** At most this many matches from any single file, so one file cannot flood. */
  maxPerFile?: number;
  /**
   * Search across a sliding window of N lines instead of a single line.
   *
   * Real code wraps: `pool.query(` on one line and the template literal on the
   * next is the common shape, and a line-at-a-time scan misses it entirely.
   */
  joinLines?: number;
}

export interface IndexStats {
  totalFiles: number;
  skippedFiles: number;
  truncated: boolean;
  totalBytes: number;
}

/**
 * The shared substrate every agent analyses.
 *
 * Built once per scan from the in-memory archive; agents only ever read from
 * it. Keeping this immutable is what makes running agents concurrently safe.
 */
export class RepoIndex {
  readonly files: RepoFile[];
  readonly byPath: Map<string, RepoFile>;
  readonly languages: LanguageStat[];
  readonly manifests: { path: string; ecosystem: string; label: string; file: RepoFile }[];
  readonly loc: number;
  readonly testFiles: number;
  readonly sourceFiles: number;

  constructor(
    readonly repo: RepoMeta,
    readonly mode: AnalysisMode,
    files: RepoFile[],
    readonly stats: IndexStats,
  ) {
    this.files = files;
    this.byPath = new Map(files.map((f) => [f.path, f]));

    let loc = 0;
    let testFiles = 0;
    let sourceFiles = 0;
    const langTotals = new Map<string, { files: number; loc: number }>();

    for (const file of files) {
      loc += file.loc;
      if (file.isTest) testFiles += 1;
      else if (file.isCode && !file.isVendor && !file.isGenerated) sourceFiles += 1;
      if (file.isVendor || file.isGenerated) continue;
      const entry = langTotals.get(file.language) ?? { files: 0, loc: 0 };
      entry.files += 1;
      entry.loc += file.loc;
      langTotals.set(file.language, entry);
    }

    const totalLangLoc = [...langTotals.values()].reduce((sum, l) => sum + l.loc, 0) || 1;
    this.languages = [...langTotals.entries()]
      .map(([name, value]) => ({
        name,
        files: value.files,
        loc: value.loc,
        share: value.loc / totalLangLoc,
      }))
      .sort((a, b) => b.loc - a.loc);

    this.loc = loc;
    this.testFiles = testFiles;
    this.sourceFiles = sourceFiles;

    this.manifests = files
      .filter((f) => !f.isVendor)
      .flatMap((file) => {
        const meta = MANIFEST_FILES[file.base.toLowerCase()];
        return meta ? [{ path: file.path, ...meta, file }] : [];
      });
  }

  file(path: string): RepoFile | undefined {
    return this.byPath.get(path);
  }

  has(path: string): boolean {
    return this.byPath.has(path);
  }

  /** Files whose path matches, ignoring vendored and generated output. */
  find(predicate: (file: RepoFile) => boolean): RepoFile[] {
    return this.files.filter((f) => !f.isVendor && !f.isGenerated && predicate(f));
  }

  /** Source files only: no tests, vendor, generated output or documentation. */
  get sources(): RepoFile[] {
    return this.files.filter(
      (f) => f.isCode && !f.isVendor && !f.isGenerated && !f.isTest && !f.isDoc,
    );
  }

  /**
   * Regex search across the repository.
   *
   * The pattern is executed per line, so `^`/`$` anchor to lines and callers
   * do not need the `m` flag. Always pass a non-global regex.
   */
  search(pattern: RegExp, options: SearchOptions = {}): SearchMatch[] {
    const {
      languages,
      pathFilter,
      skipTests = true,
      skipVendor = true,
      skipGenerated = true,
      maxMatches = 400,
      maxPerFile = 12,
      joinLines = 1,
    } = options;

    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const langSet = languages ? new Set(languages) : null;
    const span = Math.max(1, joinLines);
    const out: SearchMatch[] = [];

    for (const file of this.files) {
      if (out.length >= maxMatches) break;
      if (skipVendor && file.isVendor) continue;
      if (skipGenerated && file.isGenerated) continue;
      if (skipTests && file.isTest) continue;
      if (langSet && !langSet.has(file.language)) continue;
      if (pathFilter && !pathFilter(file.path)) continue;
      if (!file.content) continue;

      let perFile = 0;
      // The same match is reachable from several window offsets; report once.
      const reported = new Set<string>();

      for (let i = 0; i < file.lines.length; i += 1) {
        if (perFile >= maxPerFile || out.length >= maxMatches) break;
        const window = span === 1 ? file.lines[i]! : file.lines.slice(i, i + span).join('\n');
        if (window.length > 2_000 * span) continue; // minified or data line

        const re = new RegExp(pattern.source, flags);
        let match: RegExpExecArray | null;
        while ((match = re.exec(window)) !== null) {
          const before = window.slice(0, match.index);
          const lineOffset = before.split('\n').length - 1;
          const line = i + 1 + lineOffset;
          const column = match.index - (before.lastIndexOf('\n') + 1) + 1;
          const key = `${line}:${column}`;

          if (!reported.has(key)) {
            reported.add(key);
            const matchLines = match[0].split('\n').length;
            out.push({
              file,
              line,
              column,
              text: file.lines.slice(line - 1, line - 1 + matchLines).join(' '),
              match: match[0],
              groups: match.slice(1).map((g) => g ?? ''),
            });
            perFile += 1;
          }
          if (match[0].length === 0) re.lastIndex += 1;
          if (perFile >= maxPerFile || out.length >= maxMatches) break;
        }
      }
    }
    return out;
  }

  /** Does any file contain this pattern? Cheaper than a full search. */
  exists(pattern: RegExp, options: SearchOptions = {}): boolean {
    return this.search(pattern, { ...options, maxMatches: 1, maxPerFile: 1 }).length > 0;
  }

  /** Lines around `line`, ready to drop into a code viewer. */
  snippet(path: string, line: number | undefined, radius = 3): CodeLocation {
    const file = this.byPath.get(path);
    if (!file || !line) {
      return { path, ...(file ? { language: file.language } : {}) };
    }
    const start = Math.max(1, line - radius);
    const end = Math.min(file.lines.length, line + radius);
    return {
      path,
      startLine: line,
      endLine: line,
      snippet: file.lines.slice(start - 1, end).join('\n'),
      snippetStartLine: start,
      language: file.language,
    };
  }

  /** Directory listing one level deep, used by the architecture mapper. */
  topLevelDirs(): string[] {
    const dirs = new Set<string>();
    for (const file of this.files) {
      if (file.isVendor) continue;
      const first = file.path.split('/')[0];
      if (first && first !== file.path) dirs.add(first);
    }
    return [...dirs].sort();
  }
}

/** Decodes archive entries into the indexable file model. */
export function buildRepoFile(path: string, bytes: Uint8Array): RepoFile | null {
  // A NUL byte in the first kilobyte means binary; skip it entirely.
  const probe = bytes.subarray(0, 1024);
  for (const byte of probe) {
    if (byte === 0) return null;
  }

  const content = Buffer.from(bytes).toString('utf8');
  const lines = content.split('\n');
  const language = detectLanguage(path);
  const slash = path.lastIndexOf('/');

  let loc = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;
    loc += 1;
  }

  return {
    path,
    dir: slash === -1 ? '' : path.slice(0, slash),
    base: path.slice(slash + 1),
    ext: extensionOf(path),
    language,
    size: bytes.byteLength,
    content,
    lines,
    loc,
    isTest: isTestPath(path),
    isConfig: isConfigPath(path),
    isGenerated: isGeneratedPath(path),
    isVendor: isVendorPath(path),
    isDoc: isDocPath(path),
    isCode: CODE_LANGUAGES.has(language),
  };
}
