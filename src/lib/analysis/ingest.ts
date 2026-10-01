import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { downloadTarball, fetchRepoMeta, GitHubError } from '@/lib/github/client';
import type { RepoRef } from '@/types';
import { isBinaryPath } from './languages';
import { buildRepoFile, RepoIndex, type RepoFile } from './repo-index';
import { readTarGz } from './tar';

const logger = createLogger('ingest');

export interface IngestProgress {
  (message: string, progress: number): void;
}

/**
 * Turns a repository reference into an in-memory index.
 *
 * Security posture (see SECURITY.md):
 *   - the archive is fetched over HTTPS from a hard-coded GitHub host
 *   - it is decompressed with a hard output cap
 *   - nothing is written to disk and nothing is executed
 *   - only regular text files under the per-file cap are decoded
 */
export async function ingestRepository(
  ref: RepoRef,
  onProgress: IngestProgress = () => {},
): Promise<RepoIndex> {
  const e = env();

  onProgress(`Resolving github.com/${ref.slug}`, 0.05);
  const meta = await fetchRepoMeta(ref);

  const branch = ref.ref ?? meta.defaultBranch ?? 'HEAD';
  onProgress(`Fetching ${meta.slug}@${branch}`, 0.15);
  const archive = await downloadTarball(meta, branch);

  onProgress('Unpacking archive', 0.45);
  let result;
  try {
    result = readTarGz(archive, {
      maxTotalBytes: e.SCAN_MAX_TOTAL_BYTES,
      maxFileBytes: e.SCAN_MAX_FILE_BYTES,
      maxFiles: e.SCAN_MAX_FILES,
      accept: (path) => !isBinaryPath(path),
    });
  } catch (error) {
    throw new GitHubError({
      code: 'repo_too_large',
      message: error instanceof Error ? error.message : 'The archive could not be read.',
      hint: 'Raise SCAN_MAX_TOTAL_BYTES for very large repositories.',
      retryable: false,
    });
  }

  onProgress(`Indexing ${result.entries.length} files`, 0.7);

  const files: RepoFile[] = [];
  let skipped = result.skipped;
  let totalBytes = 0;

  for (const entry of result.entries) {
    const file = buildRepoFile(entry.path, entry.bytes);
    if (!file) {
      skipped += 1;
      continue;
    }
    totalBytes += file.size;
    files.push(file);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  const index = new RepoIndex(meta, 'live', files, {
    totalFiles: files.length + skipped,
    skippedFiles: skipped,
    truncated: result.truncated,
    totalBytes,
  });

  logger.info('ingest.complete', {
    repo: meta.slug,
    files: files.length,
    skipped,
    loc: index.loc,
    truncated: result.truncated,
  });

  onProgress(`Indexed ${files.length} files`, 1);
  return index;
}
