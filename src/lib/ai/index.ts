import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { UnavailableProvider, type AIProvider } from './provider';
import { AnthropicProvider, GoogleProvider, OpenAICompatibleProvider } from './http-providers';

export * from './provider';

const logger = createLogger('ai');

/**
 * Builds the provider from the environment.
 *
 * Three things must all be present — provider, key and model. We deliberately
 * do not ship a default model id: model names change, and silently calling the
 * wrong one is worse than telling the operator to pick.
 */
export function createAIProvider(): AIProvider {
  const e = env();

  if (e.SENTINEL_DEMO_ONLY) {
    return new UnavailableProvider('Demo mode is forced on by SENTINEL_DEMO_ONLY.');
  }

  const provider = e.AI_PROVIDER;
  if (!provider || provider === 'mock') {
    return new UnavailableProvider();
  }
  if (!e.AI_API_KEY) {
    return new UnavailableProvider(`AI_PROVIDER is "${provider}" but AI_API_KEY is not set.`);
  }
  if (!e.AI_MODEL) {
    return new UnavailableProvider(
      `AI_PROVIDER is "${provider}" but AI_MODEL is not set. Pick the model you want Sentinel to reason with.`,
    );
  }

  const maxTokens = e.AI_MAX_OUTPUT_TOKENS ?? 2_048;

  switch (provider) {
    case 'anthropic':
      return new AnthropicProvider(e.AI_API_KEY, e.AI_MODEL, maxTokens, e.AI_BASE_URL);
    case 'openai':
      return new OpenAICompatibleProvider(e.AI_API_KEY, e.AI_MODEL, maxTokens, e.AI_BASE_URL);
    case 'openai-compatible':
      if (!e.AI_BASE_URL) {
        return new UnavailableProvider(
          'AI_PROVIDER is "openai-compatible" but AI_BASE_URL is not set.',
        );
      }
      return new OpenAICompatibleProvider(
        e.AI_API_KEY,
        e.AI_MODEL,
        maxTokens,
        e.AI_BASE_URL,
        'openai-compatible',
      );
    case 'google':
      return new GoogleProvider(e.AI_API_KEY, e.AI_MODEL, maxTokens, e.AI_BASE_URL);
    default:
      return new UnavailableProvider(`Unknown AI_PROVIDER "${String(provider)}".`);
  }
}

const globalRef = globalThis as typeof globalThis & { __sentinelAI?: AIProvider };

export function getAIProvider(): AIProvider {
  if (!globalRef.__sentinelAI) {
    globalRef.__sentinelAI = createAIProvider();
    logger.info('ai.provider', {
      name: globalRef.__sentinelAI.name,
      available: globalRef.__sentinelAI.available,
    });
  }
  return globalRef.__sentinelAI;
}

/** Test seam. */
export function setAIProvider(provider: AIProvider | null) {
  if (provider) globalRef.__sentinelAI = provider;
  else delete globalRef.__sentinelAI;
}
