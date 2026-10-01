import type { z } from 'zod';

/**
 * Provider-agnostic AI surface.
 *
 * Sentinel never depends on a specific vendor: the analysis engine asks for a
 * provider, and if none is configured every agent falls back to its
 * deterministic path. That is the whole reason demo mode works.
 */

export interface AIRequest {
  /** Short label used for logging and token accounting, e.g. `validate-finding`. */
  purpose: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /** Hard ceiling; the provider aborts the request when exceeded. */
  timeoutMs?: number;
}

export interface AIResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AIUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  failures: number;
}

export interface AIProvider {
  readonly name: string;
  /** False when no credentials are configured. Call sites must check. */
  readonly available: boolean;
  /** Human-readable reason shown in the toolchain panel when unavailable. */
  readonly unavailableReason?: string;

  complete(request: AIRequest): Promise<AIResponse>;

  /**
   * Asks for JSON matching `schema`. Returns `null` rather than throwing when
   * the model answers with something unparseable — callers degrade gracefully.
   */
  structured<T>(request: AIRequest & { schema: z.ZodType<T> }): Promise<T | null>;

  usage(): AIUsage;
}

/* ------------------------------------------------------------------ */
/* Helpers shared by every HTTP-backed provider                        */
/* ------------------------------------------------------------------ */

export class AIError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AIError';
  }
}

/**
 * Models wrap JSON in prose or fences more often than anyone would like.
 * Pull out the first balanced object or array.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall through to bracket scanning.
  }

  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  const open = candidate[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i += 1) {
    const char = candidate[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Rough token estimate for providers that do not report usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AIError(`AI request timed out after ${timeoutMs}ms`, undefined, true);
    }
    throw new AIError(error instanceof Error ? error.message : 'Network error', undefined, true);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* The no-credentials provider                                         */
/* ------------------------------------------------------------------ */

/**
 * Used whenever no API key is configured.
 *
 * It deliberately produces nothing. Agents keep the deterministic findings they
 * derived from the source, and the report's toolchain panel states plainly that
 * AI reasoning was unavailable. We never fabricate model output and present it
 * as analysis.
 */
export class UnavailableProvider implements AIProvider {
  readonly name = 'none';
  readonly available = false;
  readonly unavailableReason: string;
  private counters: AIUsage = { calls: 0, inputTokens: 0, outputTokens: 0, failures: 0 };

  constructor(reason = 'No AI provider configured (set AI_PROVIDER, AI_API_KEY and AI_MODEL).') {
    this.unavailableReason = reason;
  }

  async complete(): Promise<AIResponse> {
    throw new AIError(this.unavailableReason);
  }

  async structured<T>(): Promise<T | null> {
    return null;
  }

  usage(): AIUsage {
    return { ...this.counters };
  }
}
