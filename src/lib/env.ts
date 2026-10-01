import { z } from 'zod';

/**
 * Server-side environment. Parsed once, lazily, so that importing this module
 * from a client component boundary never throws at build time.
 *
 * Every variable is optional: Sentinel is designed to boot with an empty
 * environment and fall back to demo mode rather than crash.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Absolute origin, used for share links and OAuth callbacks. */
  APP_URL: z.string().url().optional(),

  /** Persistence. Falls back to an on-disk JSON store under `.sentinel/`. */
  DATABASE_URL: z.string().optional(),

  /** Job queue. Falls back to an in-process queue with bounded concurrency. */
  REDIS_URL: z.string().optional(),

  /** Signing key for the session cookie. A dev key is derived when absent. */
  SENTINEL_SECRET: z.string().min(16).optional(),

  /** Raises the GitHub API rate limit from 60/h to 5000/h. */
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  /** AI provider abstraction — see `lib/ai/provider.ts`. */
  AI_PROVIDER: z.enum(['anthropic', 'openai', 'google', 'openai-compatible', 'mock']).optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_BASE_URL: z.string().url().optional(),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(32_000).optional(),

  /** Analysis guard rails. */
  SCAN_MAX_FILES: z.coerce.number().int().positive().default(6_000),
  SCAN_MAX_FILE_BYTES: z.coerce.number().int().positive().default(512_000),
  SCAN_MAX_TOTAL_BYTES: z.coerce.number().int().positive().default(80_000_000),
  SCAN_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  SCAN_CONCURRENCY: z.coerce.number().int().positive().max(16).default(2),
  /** Presentation pacing for the live agent view. 0 disables it. */
  SCAN_PACE_MS: z.coerce.number().int().min(0).max(2_000).default(170),

  /** Force demo mode even when credentials exist (useful for public demos). */
  SENTINEL_DEMO_ONLY: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),

  /** Per-IP scan creations allowed per hour. */
  RATE_LIMIT_SCANS_PER_HOUR: z.coerce.number().int().positive().default(20),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    // Never hard-fail the process on a malformed optional variable; log and
    // fall back to defaults so the app still serves demo analyses.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    console.warn(`[sentinel] invalid environment, falling back to defaults — ${issues}`);
    cached = serverSchema.parse({ NODE_ENV: process.env.NODE_ENV });
    return cached;
  }
  cached = parsed.data;
  return cached;
}

/** Test seam — clears the memoised parse. */
export function resetEnvCache() {
  cached = null;
}

/* ------------------------------------------------------------------ */
/* Derived capability flags                                            */
/* ------------------------------------------------------------------ */

export interface Capabilities {
  /** A real AI provider is configured. */
  ai: boolean;
  aiProvider: string;
  /** GitHub reads will be authenticated (higher rate limit, same scope). */
  githubToken: boolean;
  /** GitHub sign-in is available. */
  githubOAuth: boolean;
  /** A durable database is configured. */
  database: boolean;
  /** A distributed queue is configured. */
  queue: boolean;
  /** Live repository ingestion is possible at all. */
  liveAnalysis: boolean;
  /** Everything runs against the bundled sample repository. */
  demoOnly: boolean;
}

export function capabilities(): Capabilities {
  const e = env();
  const aiConfigured = Boolean(e.AI_API_KEY && e.AI_PROVIDER && e.AI_PROVIDER !== 'mock');
  const demoOnly = e.SENTINEL_DEMO_ONLY;
  return {
    ai: aiConfigured && !demoOnly,
    aiProvider: aiConfigured ? (e.AI_PROVIDER ?? 'mock') : 'heuristic',
    githubToken: Boolean(e.GITHUB_TOKEN),
    githubOAuth: Boolean(e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET),
    database: Boolean(e.DATABASE_URL),
    queue: Boolean(e.REDIS_URL),
    liveAnalysis: !demoOnly,
    demoOnly,
  };
}

/** The signing key. In development a stable key is derived from the cwd. */
export function sessionSecret(): string {
  const configured = env().SENTINEL_SECRET;
  if (configured) return configured;
  if (env().NODE_ENV === 'production') {
    console.warn(
      '[sentinel] SENTINEL_SECRET is not set. Sessions will not survive a restart. ' +
        'Set it before deploying.',
    );
  }
  return `sentinel-dev-key:${process.cwd()}`;
}

export function appUrl(): string {
  return env().APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';
}
