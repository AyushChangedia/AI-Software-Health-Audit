import type {
  AgentId,
  CategoryId,
  Evidence,
  ExternalReference,
  FlowStep,
  Patch,
  RawFinding,
  Severity,
} from '@/types';
import type { RepoIndex, SearchMatch } from './repo-index';

export interface RuleContext {
  match: SearchMatch;
  index: RepoIndex;
  /** Lines around the match, already extracted. */
  window: string;
}

export interface PatternRule {
  id: string;
  title: string | ((ctx: RuleContext) => string);
  category: CategoryId;
  agent: AgentId;
  severity: Severity | ((ctx: RuleContext) => Severity);
  /** Detector confidence before validation, 0..1. */
  confidence: number;
  pattern: RegExp;
  languages?: string[];
  pathFilter?: (path: string) => boolean;
  skipTests?: boolean;
  /** Drop the match when the same line matches this (a mitigation is present). */
  excludeLine?: RegExp;
  /**
   * Look at the surrounding lines. `mustExist: false` is the common case:
   * "flag this call only when there is no `try` within 6 lines above".
   */
  nearby?: { pattern: RegExp; before?: number; after?: number; mustExist: boolean };
  cwe?: string;
  owasp?: string;
  rootCauseId: string;
  effortMinutes: number;
  summary: (ctx: RuleContext) => string;
  impact: string;
  recommendation: string;
  evidence?: (ctx: RuleContext) => Evidence[];
  dataFlow?: (ctx: RuleContext) => FlowStep[];
  patch?: (ctx: RuleContext) => Patch | undefined;
  references?: ExternalReference[];
  /** Cap so one pathological file cannot dominate the report. */
  maxMatches?: number;
  /**
   * Search across this many consecutive lines. Use it for call shapes that
   * conventionally wrap, such as a query call with its template literal on the
   * following line.
   */
  joinLines?: number;
}

function windowAround(match: SearchMatch, before: number, after: number): string {
  const start = Math.max(0, match.line - 1 - before);
  const end = Math.min(match.file.lines.length, match.line + after);
  return match.file.lines.slice(start, end).join('\n');
}

function resolve<T>(value: T | ((ctx: RuleContext) => T), ctx: RuleContext): T {
  return typeof value === 'function' ? (value as (c: RuleContext) => T)(ctx) : value;
}

export interface RuleRunResult {
  findings: RawFinding[];
  /** Rule id → number of raw matches, for the "show your work" panel. */
  matchCounts: Record<string, number>;
}

/**
 * Runs a set of pattern rules over the index.
 *
 * This is the deterministic half of Sentinel. Every finding it emits points at
 * a concrete line that a human can open, which is what lets the validator argue
 * about it later rather than taking a model's word for anything.
 */
export function runPatternRules(index: RepoIndex, rules: PatternRule[]): RuleRunResult {
  const findings: RawFinding[] = [];
  const matchCounts: Record<string, number> = {};

  for (const rule of rules) {
    const matches = index.search(rule.pattern, {
      ...(rule.languages ? { languages: rule.languages } : {}),
      ...(rule.pathFilter ? { pathFilter: rule.pathFilter } : {}),
      skipTests: rule.skipTests ?? true,
      maxMatches: rule.maxMatches ?? 40,
      maxPerFile: 4,
      ...(rule.joinLines ? { joinLines: rule.joinLines } : {}),
    });

    let kept = 0;
    for (const match of matches) {
      if (rule.excludeLine?.test(match.text)) continue;

      const ctx: RuleContext = {
        match,
        index,
        window: windowAround(match, rule.nearby?.before ?? 4, rule.nearby?.after ?? 4),
      };

      if (rule.nearby) {
        const scope = windowAround(match, rule.nearby.before ?? 6, rule.nearby.after ?? 6);
        const present = rule.nearby.pattern.test(scope);
        if (present !== rule.nearby.mustExist) continue;
      }

      kept += 1;
      const severity = resolve(rule.severity, ctx);
      const location = index.snippet(match.file.path, match.line, 3);

      findings.push({
        ruleId: rule.id,
        title: resolve(rule.title, ctx),
        category: rule.category,
        severity,
        confidence: rule.confidence,
        detectedBy: rule.agent,
        detectors: ['pattern-rules'],
        location,
        summary: rule.summary(ctx),
        impact: rule.impact,
        evidence: rule.evidence?.(ctx) ?? [
          {
            kind: 'code',
            label: 'Matched source',
            detail: match.text.trim().slice(0, 240),
            path: match.file.path,
            line: match.line,
            source: 'pattern-rules',
          },
        ],
        ...(rule.dataFlow ? { dataFlow: rule.dataFlow(ctx) } : {}),
        recommendation: rule.recommendation,
        ...(rule.patch ? { patch: rule.patch(ctx) ?? undefined } : {}),
        rootCauseId: rule.rootCauseId,
        ...(rule.cwe ? { cwe: rule.cwe } : {}),
        ...(rule.owasp ? { owasp: rule.owasp } : {}),
        references: rule.references ?? [],
        effortMinutes: rule.effortMinutes,
      });
    }
    if (kept > 0) matchCounts[rule.id] = kept;
  }

  return { findings, matchCounts };
}

/* ------------------------------------------------------------------ */
/* Shared helpers used by rule definitions                             */
/* ------------------------------------------------------------------ */

export const JS_LANGS = ['TypeScript', 'JavaScript', 'Vue', 'Svelte', 'Astro'];
export const PY_LANGS = ['Python'];
export const BACKEND_LANGS = [...JS_LANGS, ...PY_LANGS, 'Go', 'Ruby', 'Java', 'PHP', 'C#'];

/** Heuristic: does this path look like a request handler? */
export function isServerPath(path: string): boolean {
  return /(^|\/)(api|routes?|controllers?|handlers?|server|endpoints?|views|resolvers?)(\/|$)/i.test(
    path,
  ) || /\/route\.(ts|js)$/.test(path);
}

/** Heuristic: does this path look security-relevant? */
export function isAuthPath(path: string): boolean {
  return /(auth|login|session|token|permission|role|acl|guard|middleware)/i.test(path);
}

export function isDataAccessPath(path: string): boolean {
  return /(repositor|model|dao|db|database|prisma|query|store|persistence)/i.test(path);
}

/** Indicates the expression is influenced by request input. */
export const USER_INPUT = /\b(req\.(body|query|params|headers|cookies)|request\.(body|query|args|form|GET|POST|json)|ctx\.request|searchParams|params\.|formData|event\.body|input\.|userInput|user_input)\b/;
