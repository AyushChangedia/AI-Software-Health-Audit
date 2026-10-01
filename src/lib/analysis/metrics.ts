import { createHash } from 'node:crypto';
import type { CodebaseMetrics } from '@/types';
import type { RepoFile, RepoIndex } from './repo-index';

/**
 * AST-lite structural metrics.
 *
 * A real parser per language would be better, but it would also mean a
 * toolchain per language. This pass gets cyclomatic-style complexity, nesting
 * depth, function length and cross-file duplication from the token stream
 * alone, which works uniformly on every repository Sentinel can read.
 */

export interface FunctionMetric {
  name: string;
  path: string;
  startLine: number;
  endLine: number;
  lines: number;
  /** Decision points + 1, in the spirit of cyclomatic complexity. */
  complexity: number;
  maxNesting: number;
  parameters: number;
}

const BRACE_FN_RE =
  /^\s*(?:export\s+)?(?:public\s+|private\s+|protected\s+|static\s+)*(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=>]+)?=>)|(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>[\],\s|]+)?\s*\{)/;
const PY_FN_RE = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/;

const DECISION_RE =
  /\b(?:if|else\s+if|elif|for|while|case|catch|except|switch)\b|\?\?|\?\.|&&|\|\||(?<![=!<>])\?(?!\.)/g;

function countDecisions(text: string): number {
  const matches = text.match(DECISION_RE);
  return matches ? matches.length : 0;
}

function countParameters(line: string): number {
  const open = line.indexOf('(');
  if (open === -1) return 0;
  let depth = 0;
  let params = 0;
  let sawContent = false;
  for (let i = open; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) break;
    } else if (char === ',' && depth === 1) params += 1;
    else if (depth === 1 && char.trim()) sawContent = true;
  }
  return sawContent ? params + 1 : 0;
}

/** Strips strings and comments so braces inside them do not skew depth. */
function stripLiterals(line: string): string {
  return line
    .replace(/\\./g, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/\/\/.*$/, '')
    .replace(/#.*$/, '');
}

export function analyzeFunctions(file: RepoFile): FunctionMetric[] {
  if (file.lines.length > 8_000) return [];
  return file.language === 'Python' ? analyzePython(file) : analyzeBraceLanguage(file);
}

function analyzeBraceLanguage(file: RepoFile): FunctionMetric[] {
  const out: FunctionMetric[] = [];

  for (let i = 0; i < file.lines.length; i += 1) {
    const raw = file.lines[i]!;
    if (raw.length > 500) continue;
    const match = BRACE_FN_RE.exec(raw);
    if (!match) continue;
    const name = match[1] ?? match[2] ?? match[3];
    if (!name || ['if', 'for', 'while', 'switch', 'catch', 'return'].includes(name)) continue;

    // Walk forward tracking brace depth until the body closes.
    let depth = 0;
    let started = false;
    let maxNesting = 0;
    let complexity = 1;
    let end = i;

    for (let j = i; j < Math.min(file.lines.length, i + 500); j += 1) {
      const line = stripLiterals(file.lines[j]!);
      complexity += countDecisions(line);
      for (const char of line) {
        if (char === '{') {
          depth += 1;
          started = true;
          maxNesting = Math.max(maxNesting, depth);
        } else if (char === '}') {
          depth -= 1;
        }
      }
      end = j;
      if (started && depth <= 0) break;
    }

    const lines = end - i + 1;
    if (lines < 2) continue;
    out.push({
      name,
      path: file.path,
      startLine: i + 1,
      endLine: end + 1,
      lines,
      complexity,
      maxNesting,
      parameters: countParameters(raw),
    });
    i = end;
  }
  return out;
}

function analyzePython(file: RepoFile): FunctionMetric[] {
  const out: FunctionMetric[] = [];

  for (let i = 0; i < file.lines.length; i += 1) {
    const raw = file.lines[i]!;
    const match = PY_FN_RE.exec(raw);
    if (!match) continue;
    const indent = match[1]!.length;
    const name = match[2]!;

    let end = i;
    let complexity = 1;
    let maxNesting = 0;
    for (let j = i + 1; j < file.lines.length; j += 1) {
      const line = file.lines[j]!;
      if (line.trim()) {
        const lineIndent = line.length - line.trimStart().length;
        if (lineIndent <= indent) break;
        maxNesting = Math.max(maxNesting, Math.floor((lineIndent - indent) / 4));
        complexity += countDecisions(stripLiterals(line));
      }
      end = j;
    }

    const lines = end - i + 1;
    if (lines < 2) continue;
    out.push({
      name,
      path: file.path,
      startLine: i + 1,
      endLine: end + 1,
      lines,
      complexity,
      maxNesting,
      parameters: countParameters(raw),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Duplication                                                         */
/* ------------------------------------------------------------------ */

export interface DuplicateBlock {
  fingerprint: string;
  lineCount: number;
  occurrences: { path: string; startLine: number }[];
  sample: string;
}

const WINDOW = 6;

/** Normalises a line so that formatting and identifier noise do not hide clones. */
function normalizeLine(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length < 12) return null;
  if (/^(?:\/\/|#|\*|\/\*)/.test(trimmed)) return null;
  if (/^(?:import|from|export|package|using)\b/.test(trimmed)) return null;
  if (/^[{}()[\];,]+$/.test(trimmed)) return null;
  return trimmed.replace(/\s+/g, ' ').replace(/['"][^'"]*['"]/g, 'S').replace(/\b\d+\b/g, 'N');
}

/**
 * Sliding-window fingerprinting. Blocks of `WINDOW` significant lines that hash
 * identically in two or more places are reported as duplication.
 */
export function findDuplicateBlocks(index: RepoIndex, maxBlocks = 40): DuplicateBlock[] {
  const buckets = new Map<string, { path: string; startLine: number; sample: string }[]>();

  for (const file of index.sources) {
    if (file.lines.length > 6_000) continue;
    const significant: { text: string; line: number }[] = [];
    for (let i = 0; i < file.lines.length; i += 1) {
      const normalized = normalizeLine(file.lines[i]!);
      if (normalized) significant.push({ text: normalized, line: i + 1 });
    }
    for (let i = 0; i + WINDOW <= significant.length; i += WINDOW) {
      const slice = significant.slice(i, i + WINDOW);
      const fingerprint = createHash('sha1')
        .update(slice.map((s) => s.text).join('\n'))
        .digest('hex')
        .slice(0, 16);
      const bucket = buckets.get(fingerprint) ?? [];
      bucket.push({
        path: file.path,
        startLine: slice[0]!.line,
        sample: file.lines
          .slice(slice[0]!.line - 1, slice[0]!.line + 3)
          .join('\n')
          .slice(0, 300),
      });
      buckets.set(fingerprint, bucket);
    }
  }

  const blocks: DuplicateBlock[] = [];
  for (const [fingerprint, occurrences] of buckets) {
    if (occurrences.length < 2) continue;
    blocks.push({
      fingerprint,
      lineCount: WINDOW,
      occurrences: occurrences.map(({ path, startLine }) => ({ path, startLine })),
      sample: occurrences[0]!.sample,
    });
  }

  return blocks
    .sort((a, b) => b.occurrences.length - a.occurrences.length)
    .slice(0, maxBlocks);
}

/* ------------------------------------------------------------------ */
/* Repository-level metrics                                            */
/* ------------------------------------------------------------------ */

export interface StructuralAnalysis {
  functions: FunctionMetric[];
  duplicates: DuplicateBlock[];
  metrics: CodebaseMetrics;
}

export function analyzeStructure(index: RepoIndex, deadCodeCount: number): StructuralAnalysis {
  const functions: FunctionMetric[] = [];
  for (const file of index.sources) {
    functions.push(...analyzeFunctions(file));
  }

  const duplicates = findDuplicateBlocks(index);
  const duplicatedLines = duplicates.reduce(
    (sum, block) => sum + block.lineCount * (block.occurrences.length - 1),
    0,
  );

  const complexities = functions.map((f) => f.complexity);
  const avgComplexity =
    complexities.length > 0 ? complexities.reduce((a, b) => a + b, 0) / complexities.length : 0;

  const largestFiles = [...index.sources]
    .sort((a, b) => b.loc - a.loc)
    .slice(0, 8)
    .map((f) => ({ path: f.path, loc: f.loc }));

  const coverage = readCoverage(index);

  const metrics: CodebaseMetrics = {
    files: index.stats.totalFiles,
    analyzedFiles: index.files.length,
    loc: index.loc,
    languages: index.languages.slice(0, 8),
    testFiles: index.testFiles,
    testRatio: index.sourceFiles > 0 ? index.testFiles / index.sourceFiles : 0,
    ...(coverage !== null ? { coverage } : {}),
    avgComplexity: Number(avgComplexity.toFixed(1)),
    maxComplexity: complexities.length ? Math.max(...complexities) : 0,
    duplication: index.loc > 0 ? Math.min(1, duplicatedLines / index.loc) : 0,
    deadCodeCount,
    largestFiles,
    skippedFiles: index.stats.skippedFiles,
    truncated: index.stats.truncated,
  };

  return { functions, duplicates, metrics };
}

/** Reads a committed coverage summary when the project publishes one. */
function readCoverage(index: RepoIndex): number | null {
  const candidates = ['coverage/coverage-summary.json', 'coverage-summary.json', '.nyc_output/coverage-summary.json'];
  for (const path of candidates) {
    const file = index.file(path);
    if (!file) continue;
    try {
      const json = JSON.parse(file.content) as {
        total?: { lines?: { pct?: number }; statements?: { pct?: number } };
      };
      const pct = json.total?.lines?.pct ?? json.total?.statements?.pct;
      if (typeof pct === 'number') return pct / 100;
    } catch {
      // Not fatal — coverage is a bonus signal.
    }
  }
  return null;
}
