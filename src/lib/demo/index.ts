import { RepoIndex, buildRepoFile, type RepoFile } from '@/lib/analysis/repo-index';
import { DEMO_FILES, DEMO_REPO, DEMO_SLUG, demoFileEntries } from './acme-commerce';

export { DEMO_REPO, DEMO_SLUG, DEMO_FILES };

export function isDemoSlug(slug: string): boolean {
  return slug.toLowerCase() === DEMO_SLUG.toLowerCase();
}

/**
 * Builds the demo index with exactly the same code path used for a live
 * repository, so demo results and real results are produced by one engine.
 */
export function buildDemoIndex(): RepoIndex {
  const files: RepoFile[] = [];
  let totalBytes = 0;

  for (const entry of demoFileEntries()) {
    const file = buildRepoFile(entry.path, entry.bytes);
    if (!file) continue;
    totalBytes += file.size;
    files.push(file);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return new RepoIndex(DEMO_REPO, 'demo', files, {
    totalFiles: files.length,
    skippedFiles: 0,
    truncated: false,
    totalBytes,
  });
}

export const DEMO_NOTICE =
  'Demo analysis. Findings below were produced by running the real Sentinel pipeline over a ' +
  'bundled sample repository, not over your code.';
