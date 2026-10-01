import { getStore } from '@/lib/db';
import { apiError, json, notFound, unexpected } from '@/lib/http/api';
import { getWorkspace } from '@/lib/http/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/scans/:id/report — the finished report. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = getStore();
    const scan = await store.getScan(id);
    if (!scan) return notFound('That scan does not exist, or it has expired.');

    const session = await getWorkspace();
    if (scan.workspaceId !== session.id && !scan.shareId) {
      return notFound('That scan does not exist, or it has expired.');
    }

    const report = await store.getReport(id);
    if (!report) {
      return apiError({
        code: 'unsupported',
        message:
          scan.state === 'failed'
            ? 'That scan failed before a report was produced.'
            : 'That scan has not finished yet.',
        hint: scan.state === 'failed' ? scan.error?.hint : `Current state: ${scan.state}.`,
        retryable: scan.state !== 'failed',
      });
    }

    return json({ report, scan });
  } catch (error) {
    return unexpected('GET /api/scans/:id/report', error);
  }
}
