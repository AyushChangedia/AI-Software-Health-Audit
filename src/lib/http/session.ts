import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { newId } from '@/lib/id';
import { env, sessionSecret } from '@/lib/env';

/**
 * Workspace session.
 *
 * Sentinel does not require an account to audit a public repository, but scans
 * still need to belong to someone so the dashboard and history work. Every
 * visitor gets an opaque, signed workspace id in an httpOnly cookie.
 *
 * The cookie carries no personal data and no privileges — it is a namespace
 * key. It is signed so a visitor cannot type another workspace's id and read
 * its scans.
 */

const COOKIE = 'sentinel_ws';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function sign(value: string): string {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

export function serializeWorkspace(id: string): string {
  return `${id}.${sign(id)}`;
}

export function parseWorkspace(raw: string | undefined): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const expected = sign(id);
  if (signature.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return /^ws_[A-Za-z0-9]+$/.test(id) ? id : null;
}

export interface WorkspaceSession {
  id: string;
  /** True when this request minted a new workspace. */
  isNew: boolean;
}

/** Reads the workspace from the request cookie, minting one when absent. */
export async function getWorkspace(): Promise<WorkspaceSession> {
  const jar = await cookies();
  const existing = parseWorkspace(jar.get(COOKIE)?.value);
  if (existing) return { id: existing, isNew: false };
  return { id: newId('ws'), isNew: true };
}

/** Attaches the workspace cookie to a response. */
export function withWorkspaceCookie(response: Response, session: WorkspaceSession): Response {
  if (!session.isNew) return response;
  const secure = env().NODE_ENV === 'production';
  response.headers.append(
    'set-cookie',
    [
      `${COOKIE}=${serializeWorkspace(session.id)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${MAX_AGE_SECONDS}`,
      secure ? 'Secure' : '',
    ]
      .filter(Boolean)
      .join('; '),
  );
  return response;
}

export const WORKSPACE_COOKIE = COOKIE;
