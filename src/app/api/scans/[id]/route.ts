import { getStore } from '@/lib/db';
import { json, notFound, unexpected } from '@/lib/http/api';
import { getWorkspace } from '@/lib/http/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/scans/:id — current state of one scan. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const scan = await getStore().getScan(id);
    if (!scan) return notFound('That scan does not exist, or it has expired.');

    // A scan belongs to the workspace that started it, unless it was shared.
    const session = await getWorkspace();
    if (scan.workspaceId !== session.id && !scan.shareId) {
      return notFound('That scan does not exist, or it has expired.');
    }

    return json({ scan });
  } catch (error) {
    return unexpected('GET /api/scans/:id', error);
  }
}
