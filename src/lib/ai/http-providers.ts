import type { z } from 'zod';
import {
  AIError,
  estimateTokens,
  extractJson,
  fetchWithTimeout,
  type AIProvider,
  type AIRequest,
  type AIResponse,
  type AIUsage,
} from './provider';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ai');

const DEFAULT_TIMEOUT_MS = 45_000;

abstract class BaseProvider implements AIProvider {
  abstract readonly name: string;
  readonly available = true;
  protected counters: AIUsage = { calls: 0, inputTokens: 0, outputTokens: 0, failures: 0 };

  constructor(
    protected readonly apiKey: string,
    protected readonly model: string,
    protected readonly maxOutputTokens: number,
  ) {}

  protected abstract send(request: AIRequest): Promise<AIResponse>;

  async complete(request: AIRequest): Promise<AIResponse> {
    const started = Date.now();
    try {
      const response = await this.send(request);
      this.counters.calls += 1;
      this.counters.inputTokens += response.inputTokens;
      this.counters.outputTokens += response.outputTokens;
      logger.debug('ai.call', {
        provider: this.name,
        purpose: request.purpose,
        durationMs: Date.now() - started,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
      });
      return response;
    } catch (error) {
      this.counters.failures += 1;
      logger.warn('ai.call_failed', {
        provider: this.name,
        purpose: request.purpose,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async structured<T>(request: AIRequest & { schema: z.ZodType<T> }): Promise<T | null> {
    const instruction =
      '\n\nRespond with a single JSON value and nothing else. No prose, no code fences.';
    try {
      const response = await this.complete({
        ...request,
        prompt: request.prompt + instruction,
        temperature: request.temperature ?? 0,
      });
      const json = extractJson(response.text);
      if (json === null) return null;
      const parsed = request.schema.safeParse(json);
      if (!parsed.success) {
        logger.warn('ai.schema_mismatch', {
          purpose: request.purpose,
          issues: parsed.error.issues.slice(0, 3).map((i) => i.message),
        });
        return null;
      }
      return parsed.data;
    } catch {
      // The caller's deterministic path takes over.
      return null;
    }
  }

  usage(): AIUsage {
    return { ...this.counters };
  }
}

/* ------------------------------------------------------------------ */
/* Anthropic Messages API                                              */
/* ------------------------------------------------------------------ */

export class AnthropicProvider extends BaseProvider {
  readonly name = 'anthropic';

  constructor(
    apiKey: string,
    model: string,
    maxOutputTokens: number,
    private readonly baseUrl = 'https://api.anthropic.com',
  ) {
    super(apiKey, model, maxOutputTokens);
  }

  protected async send(request: AIRequest): Promise<AIResponse> {
    const response = await fetchWithTimeout(
      `${this.baseUrl}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens ?? this.maxOutputTokens,
          temperature: request.temperature ?? 0,
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
        }),
      },
      request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new AIError(
        `Anthropic API returned ${response.status}`,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }

    const body = (await response.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    const text = (body.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');

    return {
      text,
      model: body.model ?? this.model,
      inputTokens: body.usage?.input_tokens ?? estimateTokens(request.system + request.prompt),
      outputTokens: body.usage?.output_tokens ?? estimateTokens(text),
    };
  }
}

/* ------------------------------------------------------------------ */
/* OpenAI (and any OpenAI-compatible endpoint)                         */
/* ------------------------------------------------------------------ */

export class OpenAICompatibleProvider extends BaseProvider {
  readonly name: string;

  constructor(
    apiKey: string,
    model: string,
    maxOutputTokens: number,
    private readonly baseUrl = 'https://api.openai.com/v1',
    name = 'openai',
  ) {
    super(apiKey, model, maxOutputTokens);
    this.name = name;
  }

  protected async send(request: AIRequest): Promise<AIResponse> {
    const response = await fetchWithTimeout(
      `${this.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_completion_tokens: request.maxTokens ?? this.maxOutputTokens,
          temperature: request.temperature ?? 0,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
        }),
      },
      request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new AIError(
        `${this.name} API returned ${response.status}`,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    const text = body.choices?.[0]?.message?.content ?? '';

    return {
      text,
      model: body.model ?? this.model,
      inputTokens: body.usage?.prompt_tokens ?? estimateTokens(request.system + request.prompt),
      outputTokens: body.usage?.completion_tokens ?? estimateTokens(text),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Google Generative Language API                                      */
/* ------------------------------------------------------------------ */

export class GoogleProvider extends BaseProvider {
  readonly name = 'google';

  constructor(
    apiKey: string,
    model: string,
    maxOutputTokens: number,
    private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  ) {
    super(apiKey, model, maxOutputTokens);
  }

  protected async send(request: AIRequest): Promise<AIResponse> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`;
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          generationConfig: {
            temperature: request.temperature ?? 0,
            maxOutputTokens: request.maxTokens ?? this.maxOutputTokens,
          },
        }),
      },
      request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new AIError(
        `Google API returned ${response.status}`,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }

    const body = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text =
      body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';

    return {
      text,
      model: this.model,
      inputTokens:
        body.usageMetadata?.promptTokenCount ?? estimateTokens(request.system + request.prompt),
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? estimateTokens(text),
    };
  }
}
