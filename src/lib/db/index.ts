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
    // In production without a DATABASE_URL the app still works, but state is
    // per-instance — the README says so out loud.
    const dir = env().NODE_ENV === 'test' ? null : path.join(process.cwd(), '.sentinel');
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
