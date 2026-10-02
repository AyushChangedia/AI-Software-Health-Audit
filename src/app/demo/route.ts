import { NextResponse } from 'next/server';
import { getStore, isEphemeral } from '@/lib/db';
import { getQueue } from '@/lib/queue';
import { newId } from '@/lib/id';
import { encodeScanTicket } from '@/lib/scan-token';
import { DEMO_REPO } from '@/lib/demo';
import { getWorkspace, withWorkspaceCookie } from '@/lib/http/session';
import { appUrl } from '@/lib/env';
import type { Scan } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /demo — start a demo analysis and watch it run.
 *
 * A route handler rather than a page so the workspace cookie can be set on the
 * redirect; the scan has to belong to someone before it starts.
 */
export async function GET(request: Request) {
  const session = await getWorkspace();
  const ephemeral = isEphemeral();

  // Same split as `POST /api/scans`: with no durable store the id has to carry
  // the request, because the redirect lands on an instance that has never
  // heard of this scan.
  const id = ephemeral
    ? encodeScanTicket({
        repo: {
          owner: DEMO_REPO.owner,
          name: DEMO_REPO.name,
          slug: DEMO_REPO.slug,
          url: DEMO_REPO.url,
        },
        mode: 'demo',
        workspaceId: session.id,
        iat: Math.floor(Date.now() / 1000),
      })
    : newId('scn');

  if (!ephemeral) {
    const scan: Scan = {
      id,
      workspaceId: session.id,
      repo: DEMO_REPO,
      state: 'queued',
      mode: 'demo',
      progress: 0,
      statusMessage: 'Queued — demo analysis',
      createdAt: new Date().toISOString(),
      agents: [],
    };
    await getStore().createScan(scan);
    await getQueue().enqueue({ scanId: scan.id });
  }

  const base = new URL(request.url).origin || appUrl();
  const response = NextResponse.redirect(new URL(`/scan/${id}`, base), 303);
  return withWorkspaceCookie(response, session);
}
