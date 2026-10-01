import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RepoMeta } from '@/types';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { isBinaryPath, isVendorPath } from './languages';
import { buildRepoFile, RepoIndex, type RepoFile } from './repo-index';

const logger = createLogger('ingest:local');

/**
 * Indexes a directory already on disk.
 *
 * This is the path the CLI and the GitHub Action use: in CI the checkout is
 * right there, so downloading an archive from GitHub would be slower, would
 * need a token for private repositories, and would analyse a different commit
 * from the one being built.
 *
 * The same caps apply as for a downloaded archive, and nothing is executed.
 */

/** Directories never worth walking into. */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  'vendor',
  '.yarn',
  '.pnpm-store',
  'Pods',
]);

export interface LocalIngestOptions {
  /** Overrides the inferred repository identity. */
  repo?: Partial<RepoMeta>;
  maxFiles?: number;
  maxFileBytes?: number;
  onProgress?: (message: string, progress: number) => void;
}

/** Best-effort repository identity from the git remote, then the folder name. */
async function inferRepo(root: string, override?: Partial<RepoMeta>): Promise<RepoMeta> {
  let owner = 'local';
  let name = path.basename(path.resolve(root)) || 'repository';

  try {
    const config = await readFile(path.join(root, '.git', 'config'), 'utf8');
    const match = /url\s*=\s*(?:https:\/\/github\.com\/|git@github\.com:)([^/\s]+)\/([^\s.]+)/.exec(
      config,
    );
    if (match?.[1] && match[2]) {
      owner = match[1];
      name = match[2];
    }
  } catch {
    // No git metadata: the folder name is a perfectly good identity.
  }

  const slug = `${owner}/${name}`;
  return {
    owner,
    name,
    slug,
    url: owner === 'local' ? `file://${path.resolve(root)}` : `https://github.com/${slug}`,
    ...override,
  };
}

async function walk(
  root: string,
  maxFiles: number,
): Promise<{ paths: string[]; skipped: number; truncated: boolean }> {
  const paths: string[] = [];
  let skipped = 0;
  let truncated = false;
  const queue: string[] = [''];

  while (queue.length > 0) {
    const relative = queue.shift()!;
    let entries;
    try {
      entries = await readdir(path.join(root, relative), { withFileTypes: true });
    } catch {
      skipped += 1;
      continue;
    }

    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;

      if (entry.isSymbolicLink()) {
        // Never follow links out of the tree; a symlink to / would walk the host.
        skipped += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        queue.push(childRelative);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isBinaryPath(childRelative) || isVendorPath(childRelative)) {
        skipped += 1;
        continue;
      }
      if (paths.length >= maxFiles) {
        truncated = true;
        skipped += 1;
        continue;
      }
      paths.push(childRelative);
    }
  }

  return { paths, skipped, truncated };
}

export async function ingestLocalDirectory(
  root: string,
  options: LocalIngestOptions = {},
): Promise<RepoIndex> {
  const e = env();
  const maxFiles = options.maxFiles ?? e.SCAN_MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? e.SCAN_MAX_FILE_BYTES;
  const report = options.onProgress ?? (() => {});

  const resolved = path.resolve(root);
  const rootStat = await stat(resolved);
  if (!rootStat.isDirectory()) throw new Error(`${resolved} is not a directory`);

  report(`Walking ${resolved}`, 0.1);
  const { paths, skipped: walkSkipped, truncated } = await walk(resolved, maxFiles);

  report(`Reading ${paths.length} files`, 0.4);
  const files: RepoFile[] = [];
  let skipped = walkSkipped;
  let totalBytes = 0;

  for (const relative of paths) {
    try {
      const absolute = path.join(resolved, relative);
      const info = await stat(absolute);
      if (info.size > maxFileBytes) {
        skipped += 1;
        continue;
      }
      const bytes = await readFile(absolute);
      const file = buildRepoFile(relative, new Uint8Array(bytes));
      if (!file) {
        skipped += 1;
        continue;
      }
      totalBytes += file.size;
      files.push(file);
    } catch {
      skipped += 1;
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const repo = await inferRepo(resolved, options.repo);

  logger.info('local.indexed', { root: resolved, files: files.length, skipped });
  report(`Indexed ${files.length} files`, 1);

  return new RepoIndex(repo, 'live', files, {
    totalFiles: files.length + skipped,
    skippedFiles: skipped,
    truncated,
    totalBytes,
  });
}
