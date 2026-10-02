import { getStore } from '@/lib/db';
import { replayAndSubscribe } from '@/lib/events/bus';
import { executeScanJob } from '@/lib/queue';
import { notFound, unexpected } from '@/lib/http/api';
import { getWorkspace } from '@/lib/http/session';
import { scanFromTicket } from '@/lib/scan-token';
import { createLogger } from '@/lib/logger';
import type { ScanEvent, SequencedEvent } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Serverless platforms kill a function at a fixed ceiling, and this route can
 * be the one running the analysis rather than merely reporting on it. 60s is
 * the ceiling the smallest Vercel plan allows; asking for more fails the
 * deployment there, so raise it only alongside the plan.
 */
export const maxDuration = 60;

const logger = createLogger('api:events');

/** Keep-alive comment interval. Proxies commonly idle-out a stream at 60s. */
const HEARTBEAT_MS = 20_000;

function frame(event: SequencedEvent): string {
  // `id:` lets the browser resume with Last-Event-ID after a dropped connection.
  //
  // Deliberately NOT a named event: naming it (`event: agent_finding`) means
  // `EventSource.onmessage` never fires and the client has to register a
  // listener per event type. The discriminator is already in the payload, so
  // the default `message` event keeps one handler for the whole stream.
  return `id: ${event.seq}\ndata: ${JSON.stringify(event.event)}\n\n`;
}

/**
 * GET /api/scans/:id/events — Server-Sent Events.
 *
 * Chosen over WebSockets because the stream is strictly one-way, it survives
 * ordinary HTTP infrastructure, and the browser reconnects on its own. The
 * client sends `Last-Event-ID` and the server replays from the durable event
 * log, so a reconnection loses nothing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = getStore();
    const session = await getWorkspace();

    let scan = await store.getScan(id);

    // Without a durable store the scan was never written down: `POST /api/scans`
    // ran on a different instance with its own memory. A signed ticket id says
    // what to analyse, so this request can do the work itself — and it is the
    // only request that can, because it is the one holding the stream open.
    let runHere = false;
    if (!scan) {
      const pending = scanFromTicket(id, session.id);
      if (!pending) return notFound('That scan does not exist, or it has expired.');
      scan = await store.createScan(pending);
      runHere = true;
    }

    if (scan.workspaceId !== session.id && !scan.shareId) {
      return notFound('That scan does not exist, or it has expired.');
    }

    const lastEventId = Number(
      request.headers.get('last-event-id') ?? new URL(request.url).searchParams.get('since') ?? 0,
    );
    const since = Number.isFinite(lastEventId) && lastEventId > 0 ? lastEventId : 0;

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeat: NodeJS.Timeout | null = null;
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (text: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            closed = true;
          }
        };

        // Tell proxies not to buffer; without this nginx holds the whole stream.
        send(`: connected\nretry: 2000\n\n`);

        unsubscribe = await replayAndSubscribe(id, since, (event) => {
          send(frame(event));
          if (event.event.type === 'scan_complete' || event.event.type === 'scan_failed') {
            // Terminal: let the client close rather than reconnecting forever.
            send('event: done\ndata: {}\n\n');
            setTimeout(() => {
              if (!closed) {
                closed = true;
                unsubscribe?.();
                try {
                  controller.close();
                } catch {
                  /* already closed */
                }
              }
            }, 100);
          }
        });

        if (runHere) {
          // Deliberately not awaited: the analysis publishes through the bus
          // the subscription above is already listening to, and the response
          // must start streaming now. The function stays alive because the
          // stream does.
          void executeScanJob(id).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.error('inline.failed', { scanId: id, error: message });
            // The orchestrator reports its own failures. Reaching here means it
            // could not, so close the stream rather than leave the client
            // watching a spinner that will never move.
            const failure: ScanEvent = {
              type: 'scan_failed',
              at: new Date().toISOString(),
              scanId: id,
              error: {
                code: 'internal',
                message: 'The analysis stopped unexpectedly.',
                retryable: true,
              },
            };
            send(`data: ${JSON.stringify(failure)}\n\n`);
            send('event: done\ndata: {}\n\n');
            closed = true;
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          });
        }

        heartbeat = setInterval(() => send(': keep-alive\n\n'), HEARTBEAT_MS);
        heartbeat.unref?.();

        request.signal.addEventListener('abort', () => {
          closed = true;
          unsubscribe?.();
          if (heartbeat) clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
      },
      cancel() {
        closed = true;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        logger.debug('stream.cancelled', { scanId: id });
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    });
  } catch (error) {
    return unexpected('GET /api/scans/:id/events', error);
  }
}
