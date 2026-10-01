import { getStore } from '@/lib/db';
import { json, unexpected } from '@/lib/http/api';
import { getWorkspace, withWorkspaceCookie } from '@/lib/http/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/repositories — repositories this workspace has audited. */
export async function GET() {
  try {
    const session = await getWorkspace();
    const repositories = await getStore().listRepositories(session.id);
    return withWorkspaceCookie(json({ repositories }), session);
  } catch (error) {
    return unexpected('GET /api/repositories', error);
  }
}
