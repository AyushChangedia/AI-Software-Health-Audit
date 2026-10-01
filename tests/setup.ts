import { beforeEach } from 'vitest';
import { setStore, MemoryStore } from '@/lib/db';
import { setAIProvider } from '@/lib/ai';
import { resetEnvCache } from '@/lib/env';

process.env.SENTINEL_SECRET = 'test-secret-key-at-least-16-chars';

beforeEach(() => {
  // Every test starts against a clean, non-persisted store.
  setStore(new MemoryStore(null));
  setAIProvider(null);
  resetEnvCache();
});
