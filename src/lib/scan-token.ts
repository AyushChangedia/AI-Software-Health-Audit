import { createHmac, timingSafeEqual } from 'node:crypto';
import { sessionSecret } from '@/lib/env';
import { EPHEMERAL_SCAN_PREFIX } from '@/lib/constants';
import type { AnalysisMode, RepoRef, Scan } from '@/types';

/**
 * A scan id that carries its own instructions.
 *
 * On a serverless platform every route is a separate function with its own
 * memory. A scan created by `POST /api/scans` is therefore invisible to the
 * request that renders `/scan/<id>` a moment later, and with no shared
 * database there is nowhere to write the pending scan down in between.
 *
 * So the id *is* the record: a signed description of what to analyse, which
 * any instance can verify and act on without having seen it before. The
 * signature only proves Sentinel minted the ticket — it grants nothing. The
 * workspace the ticket is bound to still has to match the caller's session
 * cookie, so one visitor cannot replay another's ticket.
 */

const PREFIX = EPHEMERAL_SCAN_PREFIX.replace(/_$/, '');

/** An unstarted ticket is worthless after an hour; expiry bounds replay. */
const TTL_SECONDS = 60 * 60;

export interface ScanTicket {
  repo: RepoRef;
  mode: AnalysisMode;
  workspaceId: string;
  /** Minted at, epoch seconds. */
  iat: number;
}

function sign(value: string): string {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

/** Cheap shape test — does not prove the signature. */
export function looksLikeTicket(id: string): boolean {
  return id.startsWith(`${PREFIX}_`);
}

export function encodeScanTicket(ticket: ScanTicket): string {
  const payload = Buffer.from(JSON.stringify(ticket), 'utf8').toString('base64url');
  const body = `${PREFIX}_${payload}`;
  return `${body}.${sign(body)}`;
}

export function decodeScanTicket(id: string): ScanTicket | null {
  if (!looksLikeTicket(id)) return null;

  const dot = id.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = id.slice(0, dot);
  const signature = id.slice(dot + 1);
  const expected = sign(body);
  if (signature.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    const json = Buffer.from(body.slice(PREFIX.length + 1), 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  // A valid signature proves provenance, not shape. Check the shape anyway:
  // the signing key is also used elsewhere, and a decoder that trusts its
  // input because the HMAC matched is one key-reuse bug away from a crash.
  const t = parsed as Partial<ScanTicket> | null;
  if (
    !t ||
    typeof t.workspaceId !== 'string' ||
    typeof t.iat !== 'number' ||
    (t.mode !== 'live' && t.mode !== 'demo') ||
    typeof t.repo !== 'object' ||
    t.repo === null ||
    typeof t.repo.slug !== 'string' ||
    typeof t.repo.owner !== 'string' ||
    typeof t.repo.name !== 'string' ||
    typeof t.repo.url !== 'string'
  ) {
    return null;
  }

  if (Date.now() / 1000 - t.iat > TTL_SECONDS) return null;

  return t as ScanTicket;
}

/**
 * Rebuilds the queued scan a ticket stands for.
 *
 * Returns null when the ticket is invalid, expired, or belongs to a different
 * workspace — all of which the caller should treat as "no such scan".
 */
export function scanFromTicket(id: string, workspaceId: string): Scan | null {
  const ticket = decodeScanTicket(id);
  if (!ticket) return null;
  if (ticket.workspaceId !== workspaceId) return null;

  return {
    id,
    workspaceId,
    repo: ticket.repo,
    state: 'queued',
    mode: ticket.mode,
    progress: 0,
    statusMessage:
      ticket.mode === 'demo' ? 'Queued — demo analysis' : `Queued — github.com/${ticket.repo.slug}`,
    createdAt: new Date(ticket.iat * 1000).toISOString(),
    agents: [],
  };
}
