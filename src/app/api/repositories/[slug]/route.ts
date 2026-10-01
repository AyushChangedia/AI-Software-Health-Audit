import { getStore } from '@/lib/db';
import { json, notFound, unexpected } from '@/lib/http/api';
import { getWorkspace } from '@/lib/http/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/repositories/:slug — one repository with its scan history.
 * `slug` is `owner%2Fname`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug: raw } = await params;
    const slug = decodeURIComponent(raw);
    const session = await getWorkspace();
    const store = getStore();

    const repository = await store.getRepository(session.id, slug);
    if (!repository) return notFound('This workspace has not audited that repository.');

    const [history, scans] = await Promise.all([
      store.history(session.id, slug),
      store.listScansForRepo(session.id, slug, 25),
    ]);

    return json({ repository, history, scans });
  } catch (error) {
    return unexpected('GET /api/repositories/:slug', error);
  }
}
