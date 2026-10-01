import { getStore } from '@/lib/db';
import { apiError, notFound, unexpected } from '@/lib/http/api';
import { getWorkspace } from '@/lib/http/session';
import { toSarif } from '@/lib/export/sarif';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/scans/:id/export?format=json|sarif
 *
 * SARIF is the one that matters: it is what GitHub code scanning ingests, so
 * a Sentinel run can become an annotation on a pull request.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
        message: 'That scan has not produced a report yet.',
        retryable: scan.state !== 'failed',
      });
    }

    const format = new URL(request.url).searchParams.get('format') ?? 'json';
    const base = `sentinel-${report.repo.owner}-${report.repo.name}`;

    if (format === 'sarif') {
      return new Response(JSON.stringify(toSarif(report), null, 2), {
        headers: {
          'content-type': 'application/sarif+json',
          'content-disposition': `attachment; filename="${base}.sarif"`,
          'cache-control': 'no-store',
        },
      });
    }

    if (format !== 'json') {
      return apiError({
        code: 'unsupported',
        message: `Unknown export format "${format}".`,
        hint: 'Supported formats: json, sarif.',
        retryable: false,
      });
    }

    return new Response(JSON.stringify(report, null, 2), {
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="${base}.json"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return unexpected('GET /api/scans/:id/export', error);
  }
}
