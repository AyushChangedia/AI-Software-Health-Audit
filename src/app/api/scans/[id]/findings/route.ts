import { getStore } from '@/lib/db';
import { json, notFound, unexpected } from '@/lib/http/api';
import { getWorkspace } from '@/lib/http/session';
import { countByCategory, countBySeverity, filterFindings, queryFromSearchParams } from '@/lib/findings/filter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/scans/:id/findings
 *
 * Query: ?q=&severity=critical,high&category=security&sort=severity&dismissed=true
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
    if (!report) return json({ findings: [], total: 0, counts: null });

    const query = queryFromSearchParams(new URL(request.url).searchParams);
    const findings = filterFindings(report.findings, query);

    return json({
      findings,
      total: findings.length,
      counts: {
        severity: countBySeverity(report.findings),
        category: countByCategory(report.findings),
        dismissed: report.findings.filter((f) => f.validation === 'dismissed').length,
      },
    });
  } catch (error) {
    return unexpected('GET /api/scans/:id/findings', error);
  }
}
