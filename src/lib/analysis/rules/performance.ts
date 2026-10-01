import type { PatternRule } from '../rule-engine';
import { BACKEND_LANGS, JS_LANGS } from '../rule-engine';

/** Performance rules — work per request and how it scales with data. */
export const PERFORMANCE_RULES: PatternRule[] = [
  {
    id: 'perf.n-plus-one',
    title: 'Database query inside a loop (N+1)',
    category: 'performance',
    agent: 'performance',
    severity: 'high',
    confidence: 0.72,
    languages: BACKEND_LANGS,
    pattern:
      /(?:for\s*\(|forEach\s*\(|\.map\s*\(\s*async|while\s*\()[^\n]*$/,
    nearby: {
      pattern:
        /await\s+(?:\w+\.)*(?:findUnique|findFirst|findOne|findById|find|query|select|get|fetchOne|execute)\s*\(/,
      before: 0,
      after: 6,
      mustExist: true,
    },
    maxMatches: 20,
    rootCauseId: 'n-plus-one-access',
    effortMinutes: 60,
    summary: (ctx) =>
      `The loop starting at \`${ctx.match.file.path}:${ctx.match.line}\` issues a database query per iteration.`,
    impact:
      'Latency grows linearly with the result set. A page that is fast with 10 rows in development takes seconds with 500 rows in production, and the database sees N round trips instead of one.',
    recommendation:
      'Collect the identifiers first and issue a single `WHERE id IN (...)` query (or use your ORM include/join), then index the results in a map for lookup inside the loop.',
    references: [],
    evidence: (ctx) => [
      {
        kind: 'code',
        label: 'Loop body',
        detail: ctx.window.slice(0, 400),
        path: ctx.match.file.path,
        line: ctx.match.line,
        source: 'pattern-rules',
      },
      {
        kind: 'reasoning',
        label: 'Scaling',
        detail:
          'Each iteration performs a round trip. With a 2 ms query and 500 rows this is one second of pure wait time before any work happens.',
      },
    ],
  },
  {
    id: 'perf.sync-io-in-handler',
    title: 'Synchronous file I/O on a request path',
    category: 'performance',
    agent: 'performance',
    severity: 'medium',
    confidence: 0.78,
    languages: JS_LANGS,
    pattern: /\b(?:readFileSync|writeFileSync|readdirSync|existsSync|execSync)\s*\(/,
    pathFilter: (p) =>
      /(^|\/)(api|routes?|controllers?|handlers?|server|middleware)(\/|$)/i.test(p) ||
      /\/route\.(ts|js)$/.test(p),
    rootCauseId: 'blocking-event-loop',
    effortMinutes: 25,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` performs blocking I/O inside request-handling code.`,
    impact:
      'Node runs handlers on a single thread. A synchronous read blocks every concurrent request, not just this one — throughput collapses under load even though CPU is idle.',
    recommendation:
      'Use the promise API (`fs/promises`). If the data is static, read it once at module load and cache it.',
    references: [],
  },
  {
    id: 'perf.unbounded-query',
    joinLines: 2,
    title: 'Query with no result limit',
    category: 'performance',
    agent: 'performance',
    severity: 'medium',
    confidence: 0.6,
    languages: BACKEND_LANGS,
    pattern: /findMany\s*\(\s*\)|\.find\s*\(\s*\{?\s*\}?\s*\)|SELECT\s+\*\s+FROM\s+\w+\s*(?:;|['"`])/i,
    excludeLine: /take|limit|first|LIMIT|\.count/i,
    rootCauseId: 'unbounded-data-access',
    effortMinutes: 30,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` fetches an entire table with no limit.`,
    impact:
      'Memory use and response time are proportional to table size, which only ever grows. This is the classic query that works for a year and then takes the service down.',
    recommendation:
      'Add pagination (`take`/`limit` plus a cursor) and select only the columns the caller needs.',
    references: [],
  },
  {
    id: 'perf.nested-linear-search',
    title: 'Linear search nested inside a loop (quadratic)',
    category: 'performance',
    agent: 'performance',
    severity: 'medium',
    confidence: 0.65,
    languages: JS_LANGS,
    pattern: /(?:for\s*\(|\.forEach\s*\(|\.map\s*\()[^\n]*$/,
    nearby: {
      pattern: /\.(?:find|filter|includes|indexOf|some)\s*\(/,
      before: 0,
      after: 4,
      mustExist: true,
    },
    maxMatches: 15,
    rootCauseId: 'quadratic-algorithms',
    effortMinutes: 30,
    summary: (ctx) =>
      `The loop at \`${ctx.match.file.path}:${ctx.match.line}\` performs a linear scan of another collection on every iteration.`,
    impact:
      'Cost is O(n×m). At 1,000 items on each side that is a million comparisons for work a hash lookup does in 1,000.',
    recommendation:
      'Build a `Map` or `Set` from the inner collection once before the loop, then look up by key inside it.',
    references: [],
  },
  {
    id: 'perf.barrel-import',
    title: 'Whole-library import where a named import would do',
    category: 'performance',
    agent: 'performance',
    severity: 'low',
    confidence: 0.8,
    languages: JS_LANGS,
    pattern: /import\s+(?:\*\s+as\s+\w+|_|moment)\s+from\s+['"](?:lodash|moment|rxjs|date-fns|@aws-sdk\/client-\w+)['"]/,
    rootCauseId: 'bundle-weight',
    effortMinutes: 15,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` imports an entire library namespace.`,
    impact:
      'Namespace imports defeat tree-shaking in several bundlers, shipping the whole library to every visitor. `moment` alone is roughly 70 KB gzipped with locales.',
    recommendation:
      'Import the specific functions you use (`import { debounce } from "lodash-es"`), or move to a smaller modern alternative.',
    references: [],
  },
  {
    id: 'perf.missing-react-memo-key',
    title: 'List rendered with array index as the React key',
    category: 'performance',
    agent: 'performance',
    severity: 'low',
    confidence: 0.82,
    languages: JS_LANGS,
    pattern: /key\s*=\s*\{\s*(?:index|i|idx)\s*\}/,
    rootCauseId: 'react-reconciliation',
    effortMinutes: 10,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` keys a list by array index.`,
    impact:
      'When the list reorders, React reuses the wrong DOM nodes: component state (focus, input text, animation) attaches to the wrong row, and the diff is larger than it needs to be.',
    recommendation: 'Key by a stable identifier from the data itself.',
    references: [],
  },
];
