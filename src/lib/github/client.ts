import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import type { RepoMeta, RepoRef, ScanError } from '@/types';

const logger = createLogger('github');

/**
 * GitHub REST client.
 *
 * Only two hosts are ever contacted, and both are hard-coded. Repository input
 * is attacker-controlled, so the client must not be able to be pointed at an
 * internal address (SSRF).
 */
const API_HOST = 'https://api.github.com';
const CODELOAD_HOST = 'https://codeload.github.com';

export class GitHubError extends Error {
  constructor(
    readonly scanError: ScanError,
    readonly status?: number,
  ) {
    super(scanError.message);
    this.name = 'GitHubError';
  }
}

function headers(withToken = true): Record<string, string> {
  const token = withToken ? env().GITHUB_TOKEN : undefined;
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'sentinel-health-auditor',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * A 401 means the configured token is wrong, not that the repository is
 * unreachable. Public repositories need no token at all, so the honest
 * response is to drop the credential and try again — and to say so in the
 * log, because the operator has a misconfiguration worth fixing.
 */
let tokenRejected = false;

function tokenUsable(): boolean {
  return !tokenRejected;
}

function rateLimitError(response: Response): ScanError {
  const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0);
  const seconds = reset ? Math.max(0, reset * 1000 - Date.now()) / 1000 : 900;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return {
    code: 'rate_limited',
    message: 'GitHub rate limit reached.',
    hint: env().GITHUB_TOKEN
      ? `Try again in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
      : `Try again in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, or set GITHUB_TOKEN to raise the limit from 60 to 5,000 requests per hour.`,
    retryable: true,
    retryAfterSeconds: Math.ceil(seconds),
  };
}

async function apiFetch(path: string, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetch(`${API_HOST}${path}`, {
      headers: headers(tokenUsable()),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (response.status === 401 && tokenUsable()) {
      tokenRejected = true;
      logger.warn('github.token_rejected', {
        detail: 'GITHUB_TOKEN was rejected with 401. Retrying without it; public repositories do not need one. Fix or unset the token to restore the higher rate limit.',
      });
      response = await fetch(`${API_HOST}${path}`, {
        headers: headers(false),
        signal: controller.signal,
        cache: 'no-store',
      });
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GitHubError({
        code: 'timeout',
        message: 'GitHub did not respond in time.',
        hint: 'This is usually transient.',
        retryable: true,
      });
    }
    throw new GitHubError({
      code: 'network',
      message: 'Could not reach GitHub from this environment.',
      hint: 'Check the network policy or outbound proxy configuration.',
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

interface RepoApiResponse {
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  default_branch: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  license: { spdx_id: string | null; name: string } | null;
  pushed_at: string;
  size: number;
  private: boolean;
  fork: boolean;
  archived: boolean;
}

export async function fetchRepoMeta(ref: RepoRef): Promise<RepoMeta> {
  const response = await apiFetch(`/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`);

  if (response.status === 404) {
    throw new GitHubError(
      {
        code: 'repo_not_found',
        message: `We could not find github.com/${ref.slug}.`,
        hint: 'Check the spelling, or confirm the repository is public. Private repositories need GitHub sign-in.',
        retryable: false,
      },
      404,
    );
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining === '0') throw new GitHubError(rateLimitError(response), response.status);
    throw new GitHubError(
      {
        code: 'repo_private',
        message: `github.com/${ref.slug} is not publicly readable.`,
        hint: 'Sign in with GitHub to audit private repositories.',
        retryable: false,
      },
      response.status,
    );
  }
  if (response.status === 401) {
    throw new GitHubError(
      {
        code: 'tool_unavailable',
        message: 'GitHub rejected this instance credentials.',
        hint: 'GITHUB_TOKEN is set but invalid or expired. Unset it to analyse public repositories anonymously, or replace it.',
        retryable: false,
      },
      401,
    );
  }
  if (!response.ok) {
    throw new GitHubError(
      {
        code: 'network',
        message: `GitHub returned an unexpected response (${response.status}).`,
        retryable: true,
      },
      response.status,
    );
  }

  const body = (await response.json()) as RepoApiResponse;

  if (body.private) {
    throw new GitHubError({
      code: 'repo_private',
      message: `github.com/${ref.slug} is private.`,
      hint: 'Connect GitHub to audit private repositories. Their source is never made public.',
      retryable: false,
    });
  }

  const sizeKb = body.size;
  const maxKb = env().SCAN_MAX_TOTAL_BYTES / 1024;
  if (sizeKb > maxKb) {
    throw new GitHubError({
      code: 'repo_too_large',
      message: `${ref.slug} is ${(sizeKb / 1024).toFixed(0)} MB, above the ${(maxKb / 1024).toFixed(0)} MB limit for a single scan.`,
      hint: 'Raise SCAN_MAX_TOTAL_BYTES, or scan a subdirectory-focused fork.',
      retryable: false,
    });
  }

  return {
    owner: body.owner.login,
    name: body.name,
    slug: body.full_name,
    url: `https://github.com/${body.full_name}`,
    ...(ref.ref ? { ref: ref.ref } : {}),
    ...(body.description ? { description: body.description } : {}),
    defaultBranch: body.default_branch,
    stars: body.stargazers_count,
    forks: body.forks_count,
    openIssues: body.open_issues_count,
    ...(body.language ? { primaryLanguage: body.language } : {}),
    ...(body.license?.spdx_id && body.license.spdx_id !== 'NOASSERTION'
      ? { license: body.license.spdx_id }
      : {}),
    pushedAt: body.pushed_at,
    sizeKb,
    isPrivate: body.private,
    isFork: body.fork,
    archived: body.archived,
  };
}

/**
 * Downloads the repository tarball.
 *
 * Returns the raw gzip bytes; extraction happens in the analysis sandbox, never
 * here. The URL is constructed from validated owner/name segments only.
 */
export async function downloadTarball(
  repo: RepoMeta,
  ref: string,
  timeoutMs = 60_000,
): Promise<Uint8Array> {
  const url = `${CODELOAD_HOST}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/tar.gz/${encodeURIComponent(ref)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response = await fetch(url, { headers: headers(tokenUsable()), signal: controller.signal });
    if (response.status === 401 && tokenUsable()) {
      tokenRejected = true;
      response = await fetch(url, { headers: headers(false), signal: controller.signal });
    }
    if (!response.ok) {
      throw new GitHubError({
        code: response.status === 404 ? 'repo_not_found' : 'network',
        message:
          response.status === 404
            ? `Branch "${ref}" does not exist in ${repo.slug}.`
            : `GitHub refused the download (${response.status}).`,
        retryable: response.status >= 500,
      });
    }

    const max = env().SCAN_MAX_TOTAL_BYTES;
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > max) {
      throw new GitHubError({
        code: 'repo_too_large',
        message: `The archive is ${(declared / 1e6).toFixed(0)} MB, above this instance's limit.`,
        retryable: false,
      });
    }

    // Stream so a lying `content-length` cannot exhaust memory.
    const reader = response.body?.getReader();
    if (!reader) throw new GitHubError({ code: 'network', message: 'Empty response from GitHub.', retryable: true });

    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        throw new GitHubError({
          code: 'repo_too_large',
          message: 'The archive exceeded this instance size limit while downloading.',
          hint: 'Raise SCAN_MAX_TOTAL_BYTES if you trust the source.',
          retryable: false,
        });
      }
      chunks.push(value);
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    logger.debug('tarball.downloaded', { repo: repo.slug, bytes: total });
    return out;
  } catch (error) {
    if (error instanceof GitHubError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GitHubError({
        code: 'timeout',
        message: 'Downloading the repository took too long.',
        retryable: true,
      });
    }
    throw new GitHubError({
      code: 'network',
      message: 'Could not download the repository archive.',
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort language breakdown straight from GitHub. Never fatal. */
export async function fetchLanguages(repo: RepoRef): Promise<Record<string, number> | null> {
  try {
    const response = await apiFetch(`/repos/${repo.owner}/${repo.name}/languages`, 8_000);
    if (!response.ok) return null;
    return (await response.json()) as Record<string, number>;
  } catch {
    return null;
  }
}
