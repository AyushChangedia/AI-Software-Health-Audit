import { describe, expect, it } from 'vitest';
import { isProbablyRepoUrl, parseRepoUrl, sharePath } from '@/lib/github/url';

describe('parseRepoUrl', () => {
  const accepted: [string, string][] = [
    ['https://github.com/vercel/next.js', 'vercel/next.js'],
    ['http://github.com/vercel/next.js', 'vercel/next.js'],
    ['https://www.github.com/vercel/next.js', 'vercel/next.js'],
    ['github.com/vercel/next.js', 'vercel/next.js'],
    ['https://github.com/vercel/next.js/', 'vercel/next.js'],
    ['https://github.com/vercel/next.js.git', 'vercel/next.js'],
    ['git@github.com:vercel/next.js.git', 'vercel/next.js'],
    ['vercel/next.js', 'vercel/next.js'],
    ['  https://github.com/vercel/next.js  ', 'vercel/next.js'],
    ['https://github.com/vercel/next.js?tab=readme', 'vercel/next.js'],
    ['https://github.com/vercel/next.js#readme', 'vercel/next.js'],
    ['https://github.com/a-b/c_d.e-f', 'a-b/c_d.e-f'],
  ];

  it.each(accepted)('accepts %s', (input, slug) => {
    const result = parseRepoUrl(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.repo.slug).toBe(slug);
  });

  it('extracts the branch from a tree URL', () => {
    const result = parseRepoUrl('https://github.com/vercel/next.js/tree/canary/packages/next');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repo.slug).toBe('vercel/next.js');
    expect(result.repo.ref).toBe('canary');
    expect(result.normalized).toBe(true);
  });

  it('extracts the ref from a blob URL', () => {
    const result = parseRepoUrl('https://github.com/owner/repo/blob/main/src/index.ts');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.repo.ref).toBe('main');
  });

  it('does not treat issues as a ref', () => {
    const result = parseRepoUrl('https://github.com/owner/repo/issues/42');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.repo.ref).toBeUndefined();
  });

  const rejected: [string, string][] = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['https://gitlab.com/owner/repo', 'not_github'],
    ['https://bitbucket.org/owner/repo', 'not_github'],
    ['https://github.com/vercel', 'not_a_repository'],
    ['https://github.com', 'not_a_repository'],
    ['https://gist.github.com/owner/abc123', 'not_a_repository'],
    ['https://github.com/settings/profile', 'reserved_path'],
    ['https://github.com/marketplace/actions/x', 'reserved_path'],
    ['https://github.com/-bad-/repo', 'invalid_owner'],
    ['git@gitlab.com:owner/repo.git', 'not_github'],
  ];

  it.each(rejected)('rejects %s as %s', (input, reason) => {
    const result = parseRepoUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(reason);
      // Every rejection must be explainable to a human.
      expect(result.message.length).toBeGreaterThan(10);
    }
  });

  it('rejects a repository name that would escape a path', () => {
    expect(parseRepoUrl('https://github.com/owner/..').ok).toBe(false);
    expect(parseRepoUrl('https://github.com/owner/.').ok).toBe(false);
  });

  it('rejects an owner longer than GitHub allows', () => {
    const result = parseRepoUrl(`https://github.com/${'a'.repeat(40)}/repo`);
    expect(result.ok).toBe(false);
  });

  it('always produces a canonical https URL', () => {
    const result = parseRepoUrl('git@github.com:Owner/Repo.git');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.repo.url).toBe('https://github.com/Owner/Repo');
  });

  it('is usable as a predicate', () => {
    expect(isProbablyRepoUrl('github.com/a/b')).toBe(true);
    expect(isProbablyRepoUrl('nonsense')).toBe(false);
  });
});

describe('sharePath', () => {
  it('includes the unguessable id before the repository name', () => {
    expect(sharePath({ owner: 'acme', name: 'app' }, 'abc123')).toBe('/s/abc123/acme/app');
  });
});
