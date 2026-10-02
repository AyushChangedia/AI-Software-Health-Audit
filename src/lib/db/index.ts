import path from 'node:path';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { MemoryStore } from './memory';
import { PostgresStore } from './postgres';
import type { Store } from './types';

export type { Store } from './types';
export { MemoryStore } from './memory';
export { PostgresStore } from './postgres';

const logger = createLogger('store');

/**
 * True when the platform runs each route as its own short-lived function.
 *
 * Two consequences the app has to respect: nothing held in module scope is
 * visible to the next request, and the filesystem outside `/tmp` is read-only.
 */
export function isServerless(): boolean {
  return Boolean(
    process.env.VERCEL ??
      process.env.AWS_LAMBDA_FUNCTION_NAME ??
      process.env.FUNCTIONS_WORKER_RUNTIME ??
      process.env.K_SERVICE,
  );
}

/**
 * True when a scan cannot be written anywhere the next request will find it.
 *
 * Sentinel still runs in this mode — see `src/lib/scan-token.ts` — but the
 * scan has to carry its own state, and anything that outlives the request
 * (share links, history) is honestly unavailable.
 */
export function isEphemeral(): boolean {
  return isServerless() && !getStore().durable;
}

/**
 * Next.js re-evaluates modules across HMR boundaries and route handlers, so the
 * singleton is parked on `globalThis` to survive that.
 */
const globalRef = globalThis as typeof globalThis & { __sentinelStore?: Store };

export function getStore(): Store {
  if (globalRef.__sentinelStore) return globalRef.__sentinelStore;

  const url = env().DATABASE_URL;
  let store: Store;
  if (url) {
    store = new PostgresStore(url);
    logger.info('using postgres store');
  } else {
    // `.sentinel/` keeps dashboards alive across restarts in development.
    // Not on a serverless platform: the filesystem there is read-only outside
    // `/tmp`, and a per-instance `/tmp` would buy nothing anyway.
    const dir =
      env().NODE_ENV === 'test' || isServerless() ? null : path.join(process.cwd(), '.sentinel');
    store = new MemoryStore(dir);
    logger.info('using in-process store', { persist: Boolean(dir) });
  }

  globalRef.__sentinelStore = store;
  return store;
}

/** Test seam. */
export function setStore(store: Store) {
  globalRef.__sentinelStore = store;
}
