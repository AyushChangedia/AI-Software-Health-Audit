import type { RepoRef } from '@/types';

/**
 * GitHub repository URL parsing.
 *
 * This is the first thing every user touches, so it is deliberately generous
 * about input shape and deliberately strict about what it accepts as a repo.
 */

export type ParseFailureReason =
  | 'empty'
  | 'not_github'
  | 'not_a_repository'
  | 'reserved_path'
  | 'invalid_owner'
  | 'invalid_repo'
  | 'malformed';

export interface ParseSuccess {
  ok: true;
  repo: RepoRef;
  /** True when the user pasted a deep link (tree/blob/issues/...). */
  normalized: boolean;
}

export interface ParseFailure {
  ok: false;
  reason: ParseFailureReason;
  message: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com', 'gist.github.com']);

/**
 * Top-level GitHub paths that are never repositories. Without this,
 * `github.com/settings` parses as the repo `github/settings`.
 */
const RESERVED_OWNERS = new Set([
  'about',
  'account',
  'admin',
  'apps',
  'blog',
  'collections',
  'contact',
  'customer-stories',
  'dashboard',
  'enterprise',
  'events',
  'explore',
  'features',
  'home',
  'issues',
  'join',
  'login',
  'logout',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'organizations',
  'pricing',
  'pulls',
  'readme',
  'search',
  'security',
  'sessions',
  'settings',
  'signup',
  'site',
  'sponsors',
  'stars',
  'topics',
  'trending',
  'users',
  'watching',
]);

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Sub-paths after `owner/repo` that we strip and remember. */
const REF_SEGMENTS = new Set(['tree', 'blob', 'commit', 'commits', 'releases', 'tags']);

function fail(reason: ParseFailureReason, message: string): ParseFailure {
  return { ok: false, reason, message };
}

/**
 * Accepts, in order of how often people actually paste them:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/main/src
 *   github.com/owner/repo
 *   git@github.com:owner/repo.git
 *   owner/repo
 */
export function parseRepoUrl(input: string): ParseResult {
  const raw = input.trim();
  if (!raw) return fail('empty', 'Paste a GitHub repository URL to begin.');

  let pathname: string;
  const normalized = false;

  // `owner/repo` shorthand. Checked before URL parsing because `next.js` and
  // friends contain a dot, which makes `new URL('https://owner/next.js')`
  // parse as a hostname.
  const shorthand = /^([A-Za-z0-9][\w.-]*)\/([\w.-]+)$/.exec(raw);
  if (shorthand && !raw.includes('://') && !/^(?:www\.)?github\.com/i.test(raw)) {
    return finish(shorthand[1]!, shorthand[2]!, [], false);
  }

  const scpMatch = /^git@([^:]+):(.+)$/.exec(raw);
  if (scpMatch) {
    const host = scpMatch[1]!.toLowerCase();
    if (!GITHUB_HOSTS.has(host)) {
      return fail('not_github', `${host} is not supported yet. Sentinel analyses GitHub repositories.`);
    }
    pathname = scpMatch[2]!;
  } else {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      return fail('malformed', 'That does not look like a URL. Try https://github.com/owner/repo');
    }

    const host = url.hostname.toLowerCase();
    if (!GITHUB_HOSTS.has(host)) {
      return fail(
        'not_github',
        `${host} is not supported yet. Sentinel analyses public GitHub repositories.`,
      );
    } else if (host === 'gist.github.com') {
      return fail('not_a_repository', 'Gists cannot be audited. Paste a repository URL instead.');
    } else {
      pathname = url.pathname;
    }
  }

  const segments = pathname
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));

  if (segments.length < 2) {
    return fail(
      'not_a_repository',
      'That URL points at a GitHub account, not a repository. Add the repository name.',
    );
  }

  return finish(segments[0]!, segments[1]!, segments.slice(2), normalized || segments.length > 2);
}

/** Shared validation and normalisation for every accepted input shape. */
function finish(
  owner: string,
  rawName: string,
  rest: string[],
  normalized: boolean,
): ParseResult {
  let name = rawName;
  let ref: string | undefined;

  if (RESERVED_OWNERS.has(owner.toLowerCase())) {
    return fail('reserved_path', 'That is a GitHub page, not a repository.');
  }

  if (name.toLowerCase().endsWith('.git')) name = name.slice(0, -4);

  if (!OWNER_RE.test(owner)) {
    return fail('invalid_owner', `"${owner}" is not a valid GitHub username or organisation.`);
  }
  if (!REPO_RE.test(name) || name === '.' || name === '..') {
    return fail('invalid_repo', `"${name}" is not a valid repository name.`);
  }

  if (rest.length > 0) {
    const kind = rest[0]!.toLowerCase();
    if (REF_SEGMENTS.has(kind) && rest[1]) ref = rest[1];
  }

  const slug = `${owner}/${name}`;
  return {
    ok: true,
    normalized,
    repo: {
      owner,
      name,
      slug,
      url: `https://github.com/${slug}`,
      ...(ref ? { ref } : {}),
    },
  };
}

/** Convenience predicate for optimistic UI states. */
export function isProbablyRepoUrl(input: string): boolean {
  return parseRepoUrl(input).ok;
}

export function repoSlug(repo: { owner: string; name: string }): string {
  return `${repo.owner}/${repo.name}`;
}

/** `/s/github.com/owner/repo` share path used for public reports. */
export function sharePath(repo: { owner: string; name: string }, shareId: string): string {
  return `/s/${shareId}/${repo.owner}/${repo.name}`;
}
