import { NextResponse } from 'next/server';
import type { ScanError, ScanErrorCode } from '@/types';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api');

/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: { 'cache-control': 'no-store', ...(init?.headers ?? {}) },
  });
}

const STATUS_FOR: Record<ScanErrorCode, number> = {
  invalid_url: 400,
  repo_not_found: 404,
  repo_private: 403,
  repo_too_large: 413,
  rate_limited: 429,
  network: 502,
  ai_unavailable: 503,
  timeout: 504,
  tool_unavailable: 503,
  worker_failure: 500,
  unsupported: 422,
  internal: 500,
};

/**
 * Error responses carry the same shape the UI renders on the scan screen, so
 * an API consumer and a human see the same explanation. Stack traces never
 * cross this boundary.
 */
export function apiError(error: ScanError, extraHeaders?: HeadersInit): NextResponse {
  const status = STATUS_FOR[error.code];
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (error.retryAfterSeconds) headers['retry-after'] = String(error.retryAfterSeconds);
  return NextResponse.json(
    { error },
    { status, headers: { ...headers, ...(extraHeaders as Record<string, string>) } },
  );
}

export function notFound(message = 'Not found'): NextResponse {
  return apiError({ code: 'repo_not_found', message, retryable: false });
}

/** Converts an unexpected throw into a safe response, logging the detail. */
export function unexpected(scope: string, error: unknown): NextResponse {
  logger.error('route.unexpected', {
    scope,
    error: error instanceof Error ? error.message : String(error),
  });
  return apiError({
    code: 'internal',
    message: 'Something went wrong handling that request.',
    hint: 'The error has been logged.',
    retryable: true,
  });
}

/* ------------------------------------------------------------------ */
/* Origin checking (CSRF)                                              */
/* ------------------------------------------------------------------ */

/**
 * State-changing routes must come from this origin.
 *
 * The session cookie is `SameSite=Lax`, which already blocks cross-site POSTs
 * from carrying it. This is the second lock: it rejects the request outright
 * rather than processing it without a session.
 */
export function assertSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get('origin');
  // Same-origin fetches from a browser always send this; server-to-server
  // callers (curl, CI) send neither and are allowed through to the API.
  if (!origin) return null;

  const host = request.headers.get('host');
  const configured = env().APP_URL;

  const allowed = new Set<string>();
  if (host) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }
  if (configured) allowed.add(configured.replace(/\/$/, ''));

  if (allowed.has(origin.replace(/\/$/, ''))) return null;

  logger.warn('origin.rejected', { origin, host });
  return apiError({
    code: 'unsupported',
    message: 'Cross-origin requests are not accepted on this endpoint.',
    retryable: false,
  });
}

/* ------------------------------------------------------------------ */
/* Rate limiting                                                       */
/* ------------------------------------------------------------------ */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const globalRef = globalThis as typeof globalThis & {
  __sentinelRateLimit?: Map<string, Bucket>;
};

function buckets(): Map<string, Bucket> {
  globalRef.__sentinelRateLimit ??= new Map();
  return globalRef.__sentinelRateLimit;
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return ip;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limit: number;
}

/**
 * Token bucket, refilled continuously over the window.
 *
 * In-process by design: a single instance is the default deployment. With
 * `REDIS_URL` set you would move this to a shared counter — the interface is
 * the same, which is why it returns a result rather than a response.
 */
export function rateLimit(key: string, limit: number, windowSeconds = 3_600): RateLimitResult {
  const now = Date.now();
  const map = buckets();
  const bucket = map.get(key) ?? { tokens: limit, updatedAt: now };

  const refill = ((now - bucket.updatedAt) / (windowSeconds * 1_000)) * limit;
  bucket.tokens = Math.min(limit, bucket.tokens + refill);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    const secondsPerToken = windowSeconds / limit;
    const retryAfterSeconds = Math.ceil((1 - bucket.tokens) * secondsPerToken);
    map.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterSeconds, limit };
  }

  bucket.tokens -= 1;
  map.set(key, bucket);

  // Keep the map from growing without bound on a long-lived process.
  if (map.size > 10_000) {
    for (const [k, v] of map) {
      if (now - v.updatedAt > windowSeconds * 1_000) map.delete(k);
    }
  }

  return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0, limit };
}

export function rateLimitError(result: RateLimitResult): ScanError {
  const minutes = Math.ceil(result.retryAfterSeconds / 60);
  return {
    code: 'rate_limited',
    message: `That is more than ${result.limit} scans in an hour from this address.`,
    hint:
      minutes <= 1
        ? 'Try again in about a minute.'
        : `Try again in about ${minutes} minutes, or raise RATE_LIMIT_SCANS_PER_HOUR on your own instance.`,
    retryable: true,
    retryAfterSeconds: result.retryAfterSeconds,
  };
}
