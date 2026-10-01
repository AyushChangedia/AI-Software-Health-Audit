import type { PatternRule } from '../rule-engine';
import { BACKEND_LANGS, JS_LANGS, PY_LANGS } from '../rule-engine';

/** Reliability rules — crashes, silent failures and unhandled states. */
export const RELIABILITY_RULES: PatternRule[] = [
  {
    id: 'bug.empty-catch',
    title: 'Error swallowed by an empty handler',
    category: 'reliability',
    agent: 'bugs',
    severity: 'medium',
    confidence: 0.86,
    pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*\}|except[^:]*:\s*pass\b|catch\s*\{\s*\/\/|rescue\s*$/,
    rootCauseId: 'silent-failure-handling',
    effortMinutes: 20,
    summary: (ctx) =>
      `The handler at \`${ctx.match.file.path}:${ctx.match.line}\` catches an error and does nothing with it.`,
    impact:
      'The operation reports success while having failed. Debugging the resulting inconsistency later costs far more than handling the error here.',
    recommendation:
      'Either handle the error meaningfully (retry, fall back, surface it) or log it with enough context to be actionable, then rethrow. If it truly is safe to ignore, say why in a comment.',
    references: [],
  },
  {
    id: 'bug.unhandled-json-parse',
    title: 'JSON.parse without error handling',
    category: 'reliability',
    agent: 'bugs',
    severity: 'medium',
    confidence: 0.7,
    languages: JS_LANGS,
    pattern: /JSON\.parse\s*\(/,
    nearby: { pattern: /try\s*\{|\.catch\(|safeParse|tryParse/, before: 6, after: 2, mustExist: false },
    rootCauseId: 'missing-input-validation',
    effortMinutes: 15,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` parses JSON with no surrounding try/catch.`,
    impact:
      '`JSON.parse` throws a SyntaxError on malformed input. In a request handler that is an unhandled 500; in a background job it can kill the worker.',
    recommendation:
      'Wrap the parse and return a 400 (or a typed failure) on invalid input. A small `safeJsonParse` helper keeps call sites clean.',
    references: [],
  },
  {
    id: 'bug.missing-timeout',
    title: 'Network call without a timeout',
    category: 'reliability',
    agent: 'bugs',
    severity: 'medium',
    confidence: 0.62,
    languages: BACKEND_LANGS,
    pattern: /\b(?:await\s+)?(?:fetch|axios\.(?:get|post|put|delete)|got|requests\.(?:get|post|put))\s*\(/,
    nearby: {
      pattern: /timeout|AbortSignal|AbortController|signal\s*:|deadline/i,
      before: 4,
      after: 8,
      mustExist: false,
    },
    maxMatches: 20,
    rootCauseId: 'missing-failure-handling',
    effortMinutes: 20,
    summary: (ctx) =>
      `The outbound call at \`${ctx.match.file.path}:${ctx.match.line}\` has no timeout configured nearby.`,
    impact:
      'A dependency that stops responding without closing the socket holds your request open indefinitely. Connection pools fill, and a slow third party becomes your outage.',
    recommendation:
      'Set an explicit timeout — `AbortSignal.timeout(ms)` for fetch, the `timeout` option for axios/requests. Pick a number smaller than your own request budget.',
    references: [],
  },
  {
    id: 'bug.floating-money',
    title: 'Monetary value handled as a floating-point number',
    category: 'reliability',
    agent: 'bugs',
    severity: 'high',
    confidence: 0.6,
    pattern:
      /\b(?:price|amount|total|subtotal|balance|cost|fee|tax)\w*\s*[*+\-/]\s*\w+|parseFloat\s*\(\s*[^)]*(?:price|amount|total)/i,
    pathFilter: (p) => /(payment|billing|checkout|order|invoice|cart|price)/i.test(p),
    rootCauseId: 'money-precision',
    effortMinutes: 90,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` performs arithmetic on a monetary value using ordinary numbers.`,
    impact:
      'IEEE-754 cannot represent 0.1 exactly. Totals drift by fractions of a cent, then fail reconciliation against the payment provider — and the discrepancy grows with volume.',
    recommendation:
      'Store and calculate money in minor units (integer cents) or use a decimal library. Convert to a display string only at the edge.',
    references: [],
  },
  {
    id: 'bug.unchecked-array-index',
    title: 'First element accessed without checking the collection is non-empty',
    category: 'reliability',
    agent: 'bugs',
    severity: 'medium',
    confidence: 0.55,
    languages: JS_LANGS,
    pattern: /(?:\bfind\s*\([^)]*\)|\bfilter\s*\([^)]*\)|rows|results|items)\s*\[\s*0\s*\]\s*\./,
    excludeLine: /\?\.|\?\?|if\s*\(/,
    rootCauseId: 'missing-null-checks',
    effortMinutes: 10,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` dereferences element 0 immediately. If the collection is empty this throws.`,
    impact:
      'An empty result is a normal outcome of most queries. Treating it as impossible turns "no rows" into a 500.',
    recommendation:
      'Use optional chaining plus an explicit branch, or `.at(0)` with a null check. Handle the empty case as a first-class outcome.',
    references: [],
  },
  {
    id: 'bug.await-in-loop-no-error',
    title: 'Awaited work inside a loop with no error isolation',
    category: 'reliability',
    agent: 'bugs',
    severity: 'medium',
    confidence: 0.55,
    languages: JS_LANGS,
    pattern: /for\s*\([^)]*\)\s*\{[^}]*await\s/,
    nearby: { pattern: /try\s*\{|allSettled|\.catch\(/, before: 3, after: 12, mustExist: false },
    maxMatches: 15,
    rootCauseId: 'missing-failure-handling',
    effortMinutes: 25,
    summary: (ctx) =>
      `The loop at \`${ctx.match.file.path}:${ctx.match.line}\` awaits work per iteration with no per-item error handling.`,
    impact:
      'One failing item aborts the whole batch, and items already processed are not rolled back — a partial write with no record of where it stopped.',
    recommendation:
      'Wrap each iteration in try/catch and collect failures, or use `Promise.allSettled` and report which items failed.',
    references: [],
  },
  {
    id: 'bug.process-exit',
    title: 'Process termination inside library code',
    category: 'reliability',
    agent: 'bugs',
    severity: 'medium',
    confidence: 0.82,
    pattern: /process\.exit\s*\(|sys\.exit\s*\(|os\._exit\s*\(/,
    pathFilter: (p) => !/(^|\/)(bin|scripts?|cli|cmd|tools)(\/|$)/i.test(p) && !/main\.(ts|js|py|go)$/.test(p),
    rootCauseId: 'missing-failure-handling',
    effortMinutes: 20,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` terminates the process from inside library code.`,
    impact:
      'In a server this kills in-flight requests for every other user. Library code cannot know whether exiting is an acceptable response.',
    recommendation:
      'Throw a typed error and let the entry point decide whether that is fatal. Keep `process.exit` in CLI entry points only.',
    references: [],
  },
  {
    id: 'bug.missing-await',
    title: 'Promise-returning call with no await and no chaining',
    category: 'reliability',
    agent: 'bugs',
    severity: 'medium',
    confidence: 0.58,
    languages: JS_LANGS,
    pattern:
      /^\s*(?:this\.)?\w+(?:\.\w+)*\.(?:save|update|create|delete|insert|send|publish|emit|write|commit|flush)\s*\([^)]*\)\s*;?\s*$/,
    excludeLine: /await|return|\.then|\.catch|void\s|=\s/,
    maxMatches: 20,
    rootCauseId: 'silent-failure-handling',
    effortMinutes: 10,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` calls an operation that usually returns a promise, but the result is neither awaited nor chained.`,
    impact:
      'The function returns before the work completes. Failures surface as unhandled rejections, and in serverless runtimes the work may be cut off entirely when the handler returns.',
    recommendation:
      'Await the call, or mark it deliberately fire-and-forget with `void` plus a `.catch` that logs.',
    references: [],
  },
  {
    id: 'bug.bare-except',
    title: 'Bare except swallows every exception type',
    category: 'reliability',
    agent: 'bugs',
    severity: 'medium',
    confidence: 0.85,
    languages: PY_LANGS,
    pattern: /^\s*except\s*:\s*$|except\s+Exception\s*:\s*$/,
    rootCauseId: 'silent-failure-handling',
    effortMinutes: 15,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` catches every exception, including \`KeyboardInterrupt\` and \`SystemExit\`.`,
    impact:
      'Genuine bugs are hidden behind a generic handler, and the process becomes hard to stop cleanly.',
    recommendation: 'Catch the specific exception types you can actually handle.',
    references: [],
  },
];
