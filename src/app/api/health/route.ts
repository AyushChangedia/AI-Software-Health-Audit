import { capabilities } from '@/lib/env';
import { getStore, isEphemeral, isServerless } from '@/lib/db';
import { getQueue } from '@/lib/queue';
import { json } from '@/lib/http/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/health — what this instance can actually do.
 *
 * Deliberately explicit about degraded capabilities rather than a bare "ok":
 * an operator should be able to see at a glance that AI reasoning is off or
 * that scans are running in-process.
 */
export function GET() {
  const caps = capabilities();
  const ephemeral = isEphemeral();
  return json({
    status: 'ok',
    version: process.env.npm_package_version ?? '0.1.0',
    capabilities: caps,
    store: getStore().kind,
    serverless: isServerless(),
    ephemeral,
    queue: { kind: getQueue().kind, depth: getQueue().depth() },
    notes: [
      caps.ai ? null : 'AI reasoning is disabled; analysis is deterministic only.',
      ephemeral
        ? 'No DATABASE_URL on a serverless platform — scans run inside the event stream and reports are not stored. History and share links are unavailable; set DATABASE_URL to enable them.'
        : caps.database
          ? null
          : 'No DATABASE_URL — scan state is per-instance.',
      caps.queue ? null : 'No REDIS_URL — scans run in this process.',
      caps.demoOnly ? 'SENTINEL_DEMO_ONLY is set; live repositories are refused.' : null,
    ].filter(Boolean),
  });
}
