import { randomUUID, createHash, randomBytes } from 'node:crypto';

/** URL-safe, sortable-ish identifier used for scans and workspaces. */
export function newId(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = randomUUID().replace(/-/g, '').slice(0, 10);
  return `${prefix}_${stamp}${rand}`;
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Deterministic identifier. Two scans of the same repository produce the same
 * finding ids for the same underlying issue, which is what makes history
 * ("is this finding still open?") possible.
 */
export function stableId(prefix: string, ...parts: (string | number | undefined)[]): string {
  const material = parts.filter((p) => p !== undefined).join('|#|');
  const hash = createHash('sha256').update(material).digest('hex');
  return `${prefix}_${hash.slice(0, 16)}`;
}

export function shortHash(input: string, length = 8): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}
