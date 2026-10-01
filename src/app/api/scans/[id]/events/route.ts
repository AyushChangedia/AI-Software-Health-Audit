import { getStore } from '@/lib/db';
import { replayAndSubscribe } from '@/lib/events/bus';
import { notFound, unexpected } from '@/lib/http/api';
import { getWorkspace } from '@/lib/http/session';
import { createLogger } from '@/lib/logger';
import type { SequencedEvent } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
    const scan = await store.getScan(id);
    if (!scan) return notFound('That scan does not exist, or it has expired.');

    const session = await getWorkspace();
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
