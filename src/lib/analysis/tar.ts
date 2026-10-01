import { gunzipSync } from 'node:zlib';

/**
 * Minimal, defensive tar reader.
 *
 * Sentinel never writes repository contents to disk and never executes them.
 * The archive is decompressed in memory, walked, and only regular files under
 * the configured caps are kept. That removes an entire class of risk:
 *
 *   - path traversal (`../../etc/passwd`) — rejected outright
 *   - symlink / hardlink escapes            — entry types are skipped
 *   - decompression bombs                   — `maxOutputLength` caps gunzip
 *   - device nodes, FIFOs, setuid bits      — never materialised
 */

export interface TarEntry {
  /** Path with the archive's top-level directory stripped. */
  path: string;
  bytes: Uint8Array;
}

export interface TarReadOptions {
  /** Hard cap on the decompressed archive. */
  maxTotalBytes: number;
  /** Files larger than this are skipped (counted in `skipped`). */
  maxFileBytes: number;
  /** Stop after this many files. */
  maxFiles: number;
  /** Return false to skip an entry before its body is copied. */
  accept?: (path: string, size: number) => boolean;
}

export interface TarReadResult {
  entries: TarEntry[];
  skipped: number;
  truncated: boolean;
  /** Top-level directory GitHub wraps the archive in, e.g. `owner-repo-abc123`. */
  root: string | null;
}

const BLOCK = 512;

function readString(buf: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = offset + length;
  while (end < limit && buf[end] !== 0) end += 1;
  return Buffer.from(buf.subarray(offset, end)).toString('utf8');
}

function readOctal(buf: Uint8Array, offset: number, length: number): number {
  const raw = readString(buf, offset, length).trim().replace(/\0+$/, '');
  if (!raw) return 0;
  // GNU base-256 encoding for large sizes: high bit of the first byte set.
  if ((buf[offset]! & 0x80) !== 0) {
    let value = 0;
    for (let i = offset + 1; i < offset + length; i += 1) value = value * 256 + buf[i]!;
    return value;
  }
  const parsed = Number.parseInt(raw, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Rejects anything that could escape a target directory if it were written. */
export function isSafeEntryPath(path: string): boolean {
  if (!path) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  const segments = path.split('/');
  return !segments.some((segment) => segment === '..' || segment === '.' || segment.includes('\0'));
}

export function stripRoot(path: string, root: string | null): string {
  if (!root) return path;
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

export function readTarGz(gzip: Uint8Array, options: TarReadOptions): TarReadResult {
  let buf: Buffer;
  try {
    buf = gunzipSync(gzip, { maxOutputLength: options.maxTotalBytes });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/maxOutputLength|buffer|length/i.test(message)) {
      throw new Error('Archive expands beyond the configured size limit.');
    }
    throw new Error('Archive is not a valid gzip stream.');
  }

  const entries: TarEntry[] = [];
  let skipped = 0;
  let truncated = false;
  let root: string | null = null;
  let offset = 0;
  /** Set by a GNU long-name (`L`) header for the entry that follows it. */
  let pendingLongName: string | null = null;

  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);

    // Two consecutive zero blocks terminate the archive.
    if (header.every((byte) => byte === 0)) break;

    const rawName = pendingLongName ?? readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const size = readOctal(header, 124, 12);
    const typeFlagByte = header[156]!;
    const typeFlag = typeFlagByte === 0 ? '0' : String.fromCharCode(typeFlagByte);
    pendingLongName = null;

    const dataStart = offset + BLOCK;
    const dataBlocks = Math.ceil(size / BLOCK);
    offset = dataStart + dataBlocks * BLOCK;

    if (typeFlag === 'L') {
      // GNU long name: the body is the real path of the *next* entry.
      pendingLongName = Buffer.from(buf.subarray(dataStart, dataStart + size))
        .toString('utf8')
        .replace(/\0+$/, '');
      continue;
    }
    // pax headers ('x'/'g'), directories ('5'), symlinks ('1'/'2'), devices and
    // FIFOs are all ignored — we only ever read regular file bodies.
    if (typeFlag !== '0') continue;

    const fullPath = prefix ? `${prefix}/${rawName}` : rawName;
    if (!isSafeEntryPath(fullPath)) {
      skipped += 1;
      continue;
    }

    if (root === null) {
      const first = fullPath.split('/')[0];
      root = fullPath.includes('/') && first ? first : '';
    }

    const relative = stripRoot(fullPath, root || null);
    if (!relative) continue;

    if (entries.length >= options.maxFiles) {
      truncated = true;
      skipped += 1;
      continue;
    }
    if (size > options.maxFileBytes) {
      skipped += 1;
      continue;
    }
    if (options.accept && !options.accept(relative, size)) {
      skipped += 1;
      continue;
    }
    if (dataStart + size > buf.length) {
      skipped += 1;
      continue;
    }

    entries.push({
      path: relative,
      bytes: new Uint8Array(buf.subarray(dataStart, dataStart + size)),
    });
  }

  return { entries, skipped, truncated, root: root || null };
}
