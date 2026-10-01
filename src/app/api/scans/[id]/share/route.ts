import { getStore } from '@/lib/db';
import { apiError, assertSameOrigin, json, notFound, unexpected } from '@/lib/http/api';
import { getWorkspace } from '@/lib/http/session';
import { randomToken } from '@/lib/id';
import { appUrl } from '@/lib/env';
import { createLogger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const logger = createLogger('api:share');

/**
 * POST /api/scans/:id/share — mint a public link for a finished report.
 *
 * Sharing is opt-in and explicit: a scan is private to the workspace that ran
 * it until someone asks for a link. The id is unguessable, and a report for a
 * private repository never gets one.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  try {
    const { id } = await params;
    const store = getStore();
    const scan = await store.getScan(id);
    if (!scan) return notFound('That scan does not exist, or it has expired.');

    const session = await getWorkspace();
    // Only the workspace that ran the scan may publish it.
    if (scan.workspaceId !== session.id) {
      return notFound('That scan does not exist, or it has expired.');
    }

    if (scan.repo.isPrivate) {
      return apiError({
        code: 'unsupported',
        message: 'Reports for private repositories cannot be shared publicly.',
        hint: 'Export the report as JSON or SARIF and share that through a channel you control.',
        retryable: false,
      });
    }

    if (scan.state !== 'complete') {
      return apiError({
        code: 'unsupported',
        message: 'Only a finished report can be shared.',
        hint: `Current state: ${scan.state}.`,
        retryable: true,
      });
    }

    const shareId = scan.shareId ?? randomToken(12);
    if (!scan.shareId) {
      await store.updateScan(id, { shareId });
      logger.info('share.created', { scanId: id });
    }

    return json({ shareId, url: `${appUrl()}/s/${shareId}` });
  } catch (error) {
    return unexpected('POST /api/scans/:id/share', error);
  }
}

/** DELETE /api/scans/:id/share — revoke the link. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  try {
    const { id } = await params;
    const store = getStore();
    const scan = await store.getScan(id);
    if (!scan) return notFound('That scan does not exist, or it has expired.');

    const session = await getWorkspace();
    if (scan.workspaceId !== session.id) {
      return notFound('That scan does not exist, or it has expired.');
    }

    await store.updateScan(id, { shareId: undefined });
    logger.info('share.revoked', { scanId: id });
    return json({ shareId: null });
  } catch (error) {
    return unexpected('DELETE /api/scans/:id/share', error);
  }
}
