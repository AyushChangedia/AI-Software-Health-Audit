/**
 * Structured logging.
 *
 * Emits one JSON object per line in production so log pipelines can index it,
 * and a compact human-readable line in development.
 *
 * Never log repository source, secrets or tokens. `redact()` is applied to
 * every field as a backstop.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{16,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9-_]{16,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}/g,
];

export function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    let out = value;
    for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]');
    return out.length > 2000 ? `${out.slice(0, 2000)}…[truncated]` : out;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Only string values can carry a credential. Numeric fields with
      // credential-shaped names (`aiInputTokens`, `toolRuns['secret-scanner']`)
      // are counts, and redacting them loses real telemetry.
      const sensitiveName = /token|secret|password|authorization|api_?key|credential/i.test(k);
      out[k] = sensitiveName && typeof v === 'string' ? '[redacted]' : redact(v);
    }
    return out;
  }
  return value;
}

function minLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL as LogLevel | undefined;
  if (raw && raw in LEVEL_RANK) return raw;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

export interface LogFields {
  [key: string]: unknown;
}

function emit(level: LogLevel, scope: string, message: string, fields?: LogFields) {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel()]) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg: message,
    ...(fields ? (redact(fields) as LogFields) : {}),
  };
  const line =
    process.env.NODE_ENV === 'production'
      ? JSON.stringify(record)
      : `${level.toUpperCase().padEnd(5)} ${scope.padEnd(18)} ${message}` +
        (fields ? ` ${JSON.stringify(redact(fields))}` : '');
  if (level === 'error') console.error(line);
  else console.warn(line);
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(scope: string): Logger;
  /** Times an async operation and logs its duration. */
  time<T>(message: string, fn: () => Promise<T>, fields?: LogFields): Promise<T>;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, f) => emit('debug', scope, m, f),
    info: (m, f) => emit('info', scope, m, f),
    warn: (m, f) => emit('warn', scope, m, f),
    error: (m, f) => emit('error', scope, m, f),
    child: (sub) => createLogger(`${scope}:${sub}`),
    async time(message, fn, fields) {
      const start = Date.now();
      try {
        const result = await fn();
        emit('info', scope, message, { ...fields, durationMs: Date.now() - start, ok: true });
        return result;
      } catch (error) {
        emit('error', scope, message, {
          ...fields,
          durationMs: Date.now() - start,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}

export const log = createLogger('sentinel');

/* ------------------------------------------------------------------ */
/* Lightweight in-process metrics                                      */
/* ------------------------------------------------------------------ */

export interface ScanTelemetry {
  scanId: string;
  mode: string;
  durationMs: number;
  agentDurations: Record<string, number>;
  agentFailures: string[];
  aiCalls: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  toolRuns: Record<string, number>;
  findingsRaw: number;
  findingsDeduped: number;
  validated: number;
  dismissed: number;
}

const telemetry: ScanTelemetry[] = [];
const TELEMETRY_LIMIT = 200;

export function recordScanTelemetry(entry: ScanTelemetry) {
  telemetry.push(entry);
  if (telemetry.length > TELEMETRY_LIMIT) telemetry.shift();
  log.info('scan.telemetry', { ...entry });
}

export function recentTelemetry(limit = 20): ScanTelemetry[] {
  return telemetry.slice(-limit).reverse();
}
