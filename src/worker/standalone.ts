/**
 * Standalone scan worker.
 *
 * Repository analysis is the part of Sentinel that touches untrusted input, so
 * in any serious deployment it should not share a process with the web server.
 * Run this alongside the app with `REDIS_URL` set and the web tier stops
 * executing analysis entirely:
 *
 *   REDIS_URL=redis://localhost:6379 npm run worker
 *
 * Requires `npm install bullmq ioredis`. Without `REDIS_URL` the web process
 * runs scans in-process, which is fine for a single instance and for local
 * development — see SECURITY.md for what that trade means.
 */
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { executeScanJob } from '@/lib/queue';
import { registerRunner } from '@/agents/orchestrator';

const logger = createLogger('worker');

interface BullJob {
  id?: string;
  data: { scanId: string };
}

interface BullWorkerLike {
  on(event: string, handler: (...args: unknown[]) => void): void;
  close(): Promise<void>;
}

async function main() {
  const url = env().REDIS_URL;
  if (!url) {
    process.stderr.write(
      'REDIS_URL is not set. The standalone worker needs a queue to pull from;\n' +
        'without one the web process runs scans itself and this worker has nothing to do.\n',
    );
    process.exit(1);
  }

  registerRunner();

  let bullmq: {
    Worker: new (
      name: string,
      processor: (job: BullJob) => Promise<void>,
      opts: { connection: { url: string }; concurrency: number },
    ) => BullWorkerLike;
  };
  try {
    const specifier = 'bullmq';
    bullmq = (await import(/* webpackIgnore: true */ specifier)) as unknown as typeof bullmq;
  } catch {
    process.stderr.write('bullmq is not installed. Run `npm install bullmq ioredis`.\n');
    process.exit(1);
    return;
  }

  const concurrency = env().SCAN_CONCURRENCY;
  const worker = new bullmq.Worker(
    'sentinel:scans',
    async (job) => {
      logger.info('job.start', { jobId: job.id, scanId: job.data.scanId });
      await executeScanJob(job.data.scanId);
      logger.info('job.done', { jobId: job.id, scanId: job.data.scanId });
    },
    { connection: { url }, concurrency },
  );

  worker.on('failed', (...args) => {
    const [job, error] = args as [BullJob | undefined, Error | undefined];
    logger.error('job.failed', { scanId: job?.data.scanId, error: error?.message });
  });

  logger.info('worker.ready', { concurrency });

  const shutdown = async (signal: string) => {
    logger.info('worker.stopping', { signal });
    await worker.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
