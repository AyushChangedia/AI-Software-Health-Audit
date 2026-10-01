import type { ScanEvent, SequencedEvent } from '@/types';
import { getStore } from '@/lib/db';
import { createLogger } from '@/lib/logger';

const logger = createLogger('events');

type Handler = (event: SequencedEvent) => void;

interface Channel {
  seq: number;
  handlers: Set<Handler>;
  /** Events waiting to be written to the store. */
  pending: SequencedEvent[];
  flushTimer: NodeJS.Timeout | null;
  closed: boolean;
}

const globalRef = globalThis as typeof globalThis & {
  __sentinelBus?: Map<string, Channel>;
};

function channels(): Map<string, Channel> {
  globalRef.__sentinelBus ??= new Map();
  return globalRef.__sentinelBus;
}

function channel(scanId: string): Channel {
  const map = channels();
  let chan = map.get(scanId);
  if (!chan) {
    chan = { seq: 0, handlers: new Set(), pending: [], flushTimer: null, closed: false };
    map.set(scanId, chan);
  }
  return chan;
}

/** Writes buffered events to the store without blocking the producer. */
function scheduleFlush(scanId: string, chan: Channel) {
  if (chan.pending.length === 0) return;
  const run = () => {
    if (chan.flushTimer) {
      clearTimeout(chan.flushTimer);
      chan.flushTimer = null;
    }
    const batch = chan.pending.splice(0, chan.pending.length);
    if (batch.length === 0) return;
    void getStore()
      .appendEvents(scanId, batch)
      .catch((error: unknown) => {
        logger.warn('event.persist_failed', {
          scanId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };
  // A large burst is written immediately, even if a timer is already pending.
  if (chan.pending.length >= 25) {
    run();
    return;
  }
  if (chan.flushTimer) return;
  chan.flushTimer = setTimeout(run, 200);
  chan.flushTimer.unref?.();
}

/**
 * Publishes an event for a scan.
 *
 * Events are assigned a monotonic sequence number so a reconnecting client can
 * resume with `Last-Event-ID` and miss nothing.
 */
export function publish(scanId: string, event: ScanEvent): SequencedEvent {
  const chan = channel(scanId);
  chan.seq += 1;
  const sequenced: SequencedEvent = { seq: chan.seq, event };
  chan.pending.push(sequenced);
  scheduleFlush(scanId, chan);

  for (const handler of chan.handlers) {
    try {
      handler(sequenced);
    } catch (error) {
      logger.warn('subscriber.threw', {
        scanId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return sequenced;
}

export function subscribe(scanId: string, handler: Handler): () => void {
  const chan = channel(scanId);
  chan.handlers.add(handler);
  return () => {
    chan.handlers.delete(handler);
  };
}

/**
 * Replays everything already emitted, then streams new events.
 * Returns an unsubscribe function.
 */
export async function replayAndSubscribe(
  scanId: string,
  sinceSeq: number,
  handler: Handler,
): Promise<() => void> {
  const stored = await getStore().getEvents(scanId, sinceSeq);

  // Events are written to the store on a short debounce, so a subscriber that
  // connects mid-scan would otherwise miss everything still buffered. The
  // buffer is in this process, so read it directly and merge.
  const buffered = (channels().get(scanId)?.pending ?? []).filter((e) => e.seq > sinceSeq);
  const history = [...stored, ...buffered].sort((a, b) => a.seq - b.seq);

  // Attach the live handler first so nothing emitted during replay is lost,
  // then de-duplicate by sequence number.
  const seen = new Set<number>();
  const guarded: Handler = (event) => {
    if (seen.has(event.seq)) return;
    seen.add(event.seq);
    handler(event);
  };
  const unsubscribe = subscribe(scanId, guarded);
  for (const event of history) guarded(event);
  return unsubscribe;
}

/** Ensures a restarted process does not restart sequence numbers at 1. */
export async function primeSequence(scanId: string): Promise<void> {
  const chan = channel(scanId);
  if (chan.seq > 0) return;
  const existing = await getStore().getEvents(scanId);
  const last = existing.at(-1);
  if (last) chan.seq = last.seq;
}

/**
 * Forces buffered events to the store.
 *
 * Called when a scan reaches a terminal state so that a client connecting
 * immediately afterwards replays the whole run rather than an empty log.
 */
export async function flushEvents(scanId: string): Promise<void> {
  const chan = channels().get(scanId);
  if (!chan) return;
  if (chan.flushTimer) {
    clearTimeout(chan.flushTimer);
    chan.flushTimer = null;
  }
  const batch = chan.pending.splice(0, chan.pending.length);
  if (batch.length === 0) return;
  await getStore()
    .appendEvents(scanId, batch)
    .catch((error: unknown) => {
      logger.warn('event.persist_failed', {
        scanId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export function closeChannel(scanId: string) {
  const chan = channels().get(scanId);
  if (!chan) return;
  chan.closed = true;
  if (chan.flushTimer) {
    clearTimeout(chan.flushTimer);
    chan.flushTimer = null;
  }
  const batch = chan.pending.splice(0, chan.pending.length);
  if (batch.length) void getStore().appendEvents(scanId, batch).catch(() => undefined);
  chan.handlers.clear();
  // Keep the channel entry so the sequence counter survives a late reconnect.
}

export function subscriberCount(scanId: string): number {
  return channels().get(scanId)?.handlers.size ?? 0;
}
