import type { Finding } from '@/types';
import type { RepoIndex } from './repo-index';

/**
 * Suppressions.
 *
 * Every static analyser needs one of these, and running Sentinel over its own
 * repository is what proved it: this project ships a deliberately vulnerable
 * sample repository as a TypeScript string, and the secret scanner is right to
 * flag it. Without a way to say "these are fixtures", the only options are a
 * permanently red report or weakening the detector — both worse.
 *
 * Two mechanisms, both conventional:
 *
 *   `.sentinelignore`   gitignore-style globs, optionally scoped to rules:
 *                         tests/fixtures/**
 *                         src/demo/*.ts  sec.secret.*
 *                         !tests/fixtures/real-config.ts
 *
 *   inline comments     on or above the line:
 *                         // sentinel-disable-next-line sec.sql-injection
 *                         // sentinel-disable-file
 *
 * Suppressed findings are counted and reported. They are never silently
 * dropped — a report that hides how much it was told to ignore is not an
 * honest report.
 */

export const IGNORE_FILE = '.sentinelignore';

interface IgnoreRule {
  pattern: RegExp;
  /** Rule-id prefixes this line applies to. Empty means every rule. */
  rules: string[];
  negated: boolean;
  source: string;
}

/** Translates one gitignore-style glob into an anchored regular expression. */
export function globToRegExp(glob: string): RegExp {
  let pattern = glob.trim();
  const directoryOnly = pattern.endsWith('/');
  if (directoryOnly) pattern = pattern.slice(0, -1);
  // A pattern without a slash matches at any depth, like gitignore.
  const anchored = pattern.startsWith('/');
  if (anchored) pattern = pattern.slice(1);

  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]!;
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` matches zero or more directories; bare `**` matches anything.
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }

  const prefix = anchored || pattern.includes('/') ? '^' : '^(?:.*/)?';
  const suffix = directoryOnly ? '(?:/.*)?$' : '(?:/.*)?$';
  return new RegExp(prefix + out + suffix);
}

export function parseIgnoreFile(content: string, source = IGNORE_FILE): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const negated = line.startsWith('!');
    const body = negated ? line.slice(1).trim() : line;
    // `path/glob   rule.id another.rule` — whitespace separates the scope.
    const [glob, ...ruleScope] = body.split(/\s+/);
    if (!glob) continue;

    rules.push({
      pattern: globToRegExp(glob),
      rules: ruleScope.filter(Boolean),
      negated,
      source,
    });
  }
  return rules;
}

/**
 * Scope entries are exact rule ids, or prefixes.
 *
 * Both `sec.*` and `sec.` read naturally as "everything under sec", and
 * people write both, so both are accepted as prefixes.
 */
function ruleMatches(scope: string[], ruleId: string): boolean {
  if (scope.length === 0) return true;
  return scope.some((entry) => {
    if (entry.endsWith('*')) return ruleId.startsWith(entry.slice(0, -1));
    if (entry.endsWith('.')) return ruleId.startsWith(entry);
    return entry === ruleId;
  });
}

export interface SuppressionMatcher {
  /** True when this finding should be withheld from the report. */
  suppresses(finding: Pick<Finding, 'ruleId' | 'location'>): boolean;
  readonly configured: boolean;
  readonly ruleCount: number;
}

const INLINE_NEXT_LINE = /sentinel-disable-next-line(?:\s+([\w.*,\s-]+))?/;
const INLINE_SAME_LINE = /sentinel-disable-line(?:\s+([\w.*,\s-]+))?/;
const INLINE_FILE = /sentinel-disable-file(?:\s+([\w.*,\s-]+))?/;

function scopeFrom(match: RegExpExecArray | null): string[] {
  const raw = match?.[1];
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Builds the matcher for an indexed repository: the ignore file plus every
 * inline comment found in the source.
 */
export function buildSuppressions(index: RepoIndex): SuppressionMatcher {
  const fileRules = index.file(IGNORE_FILE)
    ? parseIgnoreFile(index.file(IGNORE_FILE)!.content)
    : [];

  // path -> line -> rule scope. Line 0 means the whole file.
  const inline = new Map<string, Map<number, string[]>>();

  for (const file of index.files) {
    if (!file.content || file.isVendor) continue;
    if (!file.content.includes('sentinel-disable')) continue;

    const lines = new Map<number, string[]>();
    for (let i = 0; i < file.lines.length; i += 1) {
      const text = file.lines[i]!;
      if (!text.includes('sentinel-disable')) continue;

      const fileMatch = INLINE_FILE.exec(text);
      if (fileMatch) {
        lines.set(0, scopeFrom(fileMatch));
        continue;
      }
      const nextMatch = INLINE_NEXT_LINE.exec(text);
      if (nextMatch) {
        lines.set(i + 2, scopeFrom(nextMatch));
        continue;
      }
      const sameMatch = INLINE_SAME_LINE.exec(text);
      if (sameMatch) lines.set(i + 1, scopeFrom(sameMatch));
    }
    if (lines.size > 0) inline.set(file.path, lines);
  }

  const configured = fileRules.length > 0 || inline.size > 0;

  return {
    configured,
    ruleCount: fileRules.length + inline.size,
    suppresses(finding) {
      const { path } = finding.location;

      // Inline comments win: they are the most local statement of intent.
      const fileInline = inline.get(path);
      if (fileInline) {
        const whole = fileInline.get(0);
        if (whole && ruleMatches(whole, finding.ruleId)) return true;
        const line = finding.location.startLine;
        if (line !== undefined) {
          const scope = fileInline.get(line);
          if (scope && ruleMatches(scope, finding.ruleId)) return true;
        }
      }

      // Later lines in the ignore file override earlier ones, so walk the
      // whole list and keep the last decision — that is what makes `!` work.
      let decision = false;
      for (const rule of fileRules) {
        if (!rule.pattern.test(path)) continue;
        if (!ruleMatches(rule.rules, finding.ruleId)) continue;
        decision = !rule.negated;
      }
      return decision;
    },
  };
}

export interface SuppressionResult {
  kept: Finding[];
  suppressed: Finding[];
}

export function applySuppressions(
  findings: Finding[],
  matcher: SuppressionMatcher,
): SuppressionResult {
  if (!matcher.configured) return { kept: findings, suppressed: [] };
  const kept: Finding[] = [];
  const suppressed: Finding[] = [];
  for (const finding of findings) {
    if (matcher.suppresses(finding)) suppressed.push(finding);
    else kept.push(finding);
  }
  return { kept, suppressed };
}
