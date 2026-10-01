import { NextResponse } from 'next/server';
import { getStore } from '@/lib/db';
import { getQueue } from '@/lib/queue';
import { newId } from '@/lib/id';
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

  const scan: Scan = {
    id: newId('scn'),
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

  const base = new URL(request.url).origin || appUrl();
  const response = NextResponse.redirect(new URL(`/scan/${scan.id}`, base), 303);
  return withWorkspaceCookie(response, session);
}
