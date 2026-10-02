import { z } from 'zod';
import { parseRepoUrl } from '@/lib/github/url';
import { getStore, isEphemeral } from '@/lib/db';
import { getQueue } from '@/lib/queue';
import { newId, randomToken } from '@/lib/id';
import { encodeScanTicket } from '@/lib/scan-token';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { DEMO_REPO, isDemoSlug } from '@/lib/demo';
import {
  apiError,
  assertSameOrigin,
  clientKey,
  json,
  rateLimit,
  rateLimitError,
  unexpected,
} from '@/lib/http/api';
import { getWorkspace, withWorkspaceCookie } from '@/lib/http/session';
import type { Scan } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const logger = createLogger('api:scans');

const createSchema = z.object({
  /** Anything `parseRepoUrl` accepts, or omitted entirely for a demo scan. */
  url: z.string().max(500).optional(),
  mode: z.enum(['live', 'demo']).optional(),
  /** Opt in to a shareable public report URL. */
  share: z.boolean().optional(),
});

/**
 * POST /api/scans — start an audit.
 *
 * Returns immediately with the queued scan; progress arrives over
 * `GET /api/scans/:id/events`.
 */
export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  try {
    const limit = rateLimit(`scan:${clientKey(request)}`, env().RATE_LIMIT_SCANS_PER_HOUR);
    if (!limit.allowed) return apiError(rateLimitError(limit));

    const body = await request.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return apiError({
        code: 'invalid_url',
        message: 'That request body is not valid.',
        hint: parsed.error.issues[0]?.message,
        retryable: false,
      });
    }

    const { url, share } = parsed.data;
    const demoOnly = env().SENTINEL_DEMO_ONLY;

    let repo = DEMO_REPO;
    let mode: Scan['mode'] = 'demo';

    if (url && parsed.data.mode !== 'demo') {
      const result = parseRepoUrl(url);
      if (!result.ok) {
        return apiError({
          code: 'invalid_url',
          message: result.message,
          hint:
            result.reason === 'not_github'
              ? 'Only GitHub repositories are supported today.'
              : 'The expected shape is https://github.com/owner/repository',
          retryable: false,
        });
      }

      if (isDemoSlug(result.repo.slug)) {
        repo = DEMO_REPO;
        mode = 'demo';
      } else if (demoOnly) {
        // This instance is pinned to demo mode; say so rather than pretending.
        return apiError({
          code: 'unsupported',
          message: 'This instance runs in demo mode and cannot analyse live repositories.',
          hint: 'Start a demo analysis to see the full report, or run your own instance.',
          retryable: false,
        });
      } else {
        repo = { ...result.repo, slug: result.repo.slug };
        mode = 'live';
      }
    }

    const session = await getWorkspace();
    const store = getStore();
    const ephemeral = isEphemeral();

    if (ephemeral && share) {
      // A share link is a promise that the report will still be there later.
      // Without a durable store it would not be, so refuse rather than mint a
      // URL that 404s the moment this instance goes away.
      return apiError({
        code: 'unsupported',
        message: 'This instance cannot publish share links.',
        hint: 'Share links need a database — set DATABASE_URL. You can still export the finished report as JSON or SARIF.',
        retryable: false,
      });
    }

    // Without a durable store the id has to carry the request: the next
    // request lands on a different instance, which has never heard of it.
    const id = ephemeral
      ? encodeScanTicket({
          repo: { owner: repo.owner, name: repo.name, slug: repo.slug, url: repo.url },
          mode,
          workspaceId: session.id,
          iat: Math.floor(Date.now() / 1000),
        })
      : newId('scn');

    const scan: Scan = {
      id,
      workspaceId: session.id,
      repo,
      state: 'queued',
      mode,
      progress: 0,
      statusMessage: mode === 'demo' ? 'Queued — demo analysis' : `Queued — github.com/${repo.slug}`,
      createdAt: new Date().toISOString(),
      ...(share ? { shareId: randomToken(12) } : {}),
      agents: [],
    };

    if (ephemeral) {
      // Nothing to persist and nothing to enqueue: the event stream runs the
      // analysis itself, in the one request that can deliver the result.
      logger.info('scan.created', { scanId: scan.id, repo: repo.slug, mode, ephemeral: true });
    } else {
      await store.createScan(scan);
      await getQueue().enqueue({ scanId: scan.id });
      logger.info('scan.created', { scanId: scan.id, repo: repo.slug, mode });
    }

    const response = json({ scan }, { status: 202 });
    return withWorkspaceCookie(response, session);
  } catch (error) {
    return unexpected('POST /api/scans', error);
  }
}

/** GET /api/scans — the current workspace's recent scans. */
export async function GET(request: Request) {
  try {
    const session = await getWorkspace();
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 25)));
    const scans = await getStore().listScans(session.id, limit);
    return withWorkspaceCookie(json({ scans }), session);
  } catch (error) {
    return unexpected('GET /api/scans', error);
  }
}
