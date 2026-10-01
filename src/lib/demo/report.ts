import type { Report } from '@/types';
import { getStore } from '@/lib/db';
import { DEMO_REPO } from './acme-commerce';
import { createLogger } from '@/lib/logger';

const logger = createLogger('demo:preview');

/**
 * The report shown in the landing page's "example report" section.
 *
 * It is produced by running the real pipeline over the bundled sample
 * repository — the same code path a visitor's scan takes — so the numbers on
 * the marketing page are numbers Sentinel actually computed, and they change
 * when the engine changes. Computed once per process and memoised.
 */
const PREVIEW_SCAN_ID = 'scn_demo_preview';
const PREVIEW_WORKSPACE = 'ws_demopreview';

const globalRef = globalThis as typeof globalThis & {
  __sentinelDemoReport?: Promise<Report | null>;
};

export function getDemoReport(): Promise<Report | null> {
  globalRef.__sentinelDemoReport ??= (async () => {
    const store = getStore();
    try {
      const existing = await store.getReport(PREVIEW_SCAN_ID);
      if (existing) return existing;

      await store.createScan({
        id: PREVIEW_SCAN_ID,
        workspaceId: PREVIEW_WORKSPACE,
        repo: DEMO_REPO,
        state: 'queued',
        mode: 'demo',
        progress: 0,
        statusMessage: 'Queued',
        createdAt: new Date().toISOString(),
        agents: [],
      });

      // Imported lazily so the landing page does not pull the agent graph into
      // its module tree unless the preview is actually rendered.
      const { runScan } = await import('@/agents/orchestrator');
      await runScan(PREVIEW_SCAN_ID, { pace: 0 });
      return await store.getReport(PREVIEW_SCAN_ID);
    } catch (error) {
      // A missing preview degrades the landing page; it must never break it.
      logger.warn('preview.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  })();
  return globalRef.__sentinelDemoReport;
}
