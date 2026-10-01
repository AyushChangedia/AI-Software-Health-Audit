import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const logger = createLogger('queue');

export interface ScanJob {
  scanId: string;
}

export interface Queue {
  readonly kind: 'inproc' | 'redis';
  enqueue(job: ScanJob): Promise<void>;
  /** Jobs waiting for a slot. Surfaced on the scan screen as "queued". */
  depth(): number;
}

/**
 * The unit of work. Registered by the orchestrator module so the queue does not
 * import the analysis engine (and therefore the whole agent graph) eagerly.
 */
export type ScanRunner = (scanId: string) => Promise<void>;

const globalRef = globalThis as typeof globalThis & {
  __sentinelQueue?: Queue;
  __sentinelRunner?: ScanRunner;
};

export function registerScanRunner(runner: ScanRunner) {
  globalRef.__sentinelRunner = runner;
}

async function runJob(scanId: string): Promise<void> {
  let runner = globalRef.__sentinelRunner;
  if (!runner) {
    // Lazy import breaks the cycle: orchestrator -> queue -> orchestrator.
    const mod = await import('@/agents/orchestrator');
    mod.registerRunner();
    runner = globalRef.__sentinelRunner;
  }
  if (!runner) throw new Error('No scan runner registered');
  await runner(scanId);
}

/* ------------------------------------------------------------------ */
/* In-process queue (default)                                          */
/* ------------------------------------------------------------------ */

/**
 * Bounded-concurrency FIFO. Good enough for a single instance and for local
 * development; swap in the Redis driver when you run more than one.
 */
class InProcessQueue implements Queue {
  readonly kind = 'inproc' as const;
  private active = 0;
  private waiting: ScanJob[] = [];

  constructor(private readonly concurrency: number) {}

  depth(): number {
    return this.waiting.length;
  }

  async enqueue(job: ScanJob): Promise<void> {
    this.waiting.push(job);
    this.pump();
  }

  private pump() {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift()!;
      this.active += 1;
      void runJob(job.scanId)
        .catch((error: unknown) => {
          logger.error('job.failed', {
            scanId: job.scanId,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Redis / BullMQ driver                                               */
/* ------------------------------------------------------------------ */

interface BullQueueLike {
  add(name: string, data: ScanJob, opts?: Record<string, unknown>): Promise<unknown>;
  getWaitingCount(): Promise<number>;
}

/**
 * Enabled by `REDIS_URL`. Requires `npm install bullmq ioredis`.
 *
 * The worker half lives in `src/worker/standalone.ts` so repository analysis
 * runs in a separate process from the web server — see SECURITY.md.
 */
class RedisQueue implements Queue {
  readonly kind = 'redis' as const;
  private queue: Promise<BullQueueLike> | null = null;
  private lastDepth = 0;

  constructor(private readonly url: string) {}

  private get connection() {
    if (!this.queue) {
      this.queue = (async () => {
        type BullModule = {
          Queue: new (name: string, opts: { connection: { url: string } }) => BullQueueLike;
        };
        let bullmq: BullModule;
        try {
          // Indirect specifier: optional peer dependency, resolved at runtime only.
          const specifier = 'bullmq';
          bullmq = (await import(/* webpackIgnore: true */ specifier)) as unknown as BullModule;
        } catch {
          throw new Error(
            'REDIS_URL is set but "bullmq" is not installed. Run `npm install bullmq ioredis` ' +
              'or unset REDIS_URL to use the in-process queue.',
          );
        }
        return new bullmq.Queue('sentinel:scans', { connection: { url: this.url } });
      })();
    }
    return this.queue;
  }

  depth(): number {
    void this.connection
      .then((q) => q.getWaitingCount())
      .then((n) => {
        this.lastDepth = n;
      })
      .catch(() => undefined);
    return this.lastDepth;
  }

  async enqueue(job: ScanJob): Promise<void> {
    const queue = await this.connection;
    await queue.add('scan', job, {
      removeOnComplete: 100,
      removeOnFail: 500,
      attempts: 1,
    });
  }
}

/* ------------------------------------------------------------------ */

export function getQueue(): Queue {
  if (globalRef.__sentinelQueue) return globalRef.__sentinelQueue;
  const e = env();
  const queue: Queue = e.REDIS_URL
    ? new RedisQueue(e.REDIS_URL)
    : new InProcessQueue(e.SCAN_CONCURRENCY);
  logger.info('queue.ready', { kind: queue.kind });
  globalRef.__sentinelQueue = queue;
  return queue;
}

/** Exported for the standalone worker, which processes jobs itself. */
export { runJob as executeScanJob };
