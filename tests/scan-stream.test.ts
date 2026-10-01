/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { initialState, useScanStream } from '@/hooks/use-scan-stream';
import type { Scan, ScanEvent } from '@/types';
import { DEMO_REPO } from '@/lib/demo';

/**
 * The live screen is a projection of the event stream, so the reducer is where
 * its correctness lives. These tests drive it through a real `EventSource`
 * stand-in rather than calling the reducer directly, which is what catches the
 * wiring bugs (named events, duplicate delivery, resume).
 */

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  readonly listeners = new Map<string, ((event: Event) => void)[]>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  close() {
    this.closed = true;
  }

  open() {
    this.onopen?.(new Event('open'));
  }

  /** Delivers a frame exactly as the server writes it: no `event:` name. */
  emit(seq: number, event: ScanEvent) {
    const message = new MessageEvent('message', {
      data: JSON.stringify(event),
      lastEventId: String(seq),
    });
    this.onmessage?.(message);
  }
}

function scan(): Scan {
  return {
    id: 'scn_test',
    workspaceId: 'ws_test',
    repo: DEMO_REPO,
    state: 'queued',
    mode: 'demo',
    progress: 0,
    statusMessage: 'Queued',
    createdAt: new Date().toISOString(),
    agents: [],
  };
}

function setup() {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  const rendered = renderHook(() => useScanStream('scn_test', scan()));
  const source = FakeEventSource.instances[0]!;
  act(() => source.open());
  return { ...rendered, source };
}

const now = () => new Date().toISOString();

describe('initialState', () => {
  it('seeds every agent as idle', () => {
    const state = initialState(scan());
    expect(state.agents.security.state).toBe('idle');
    expect(state.agents.validator.state).toBe('idle');
    expect(state.progress).toBe(0);
  });

  it('adopts an existing agent snapshot', () => {
    const state = initialState({
      ...scan(),
      state: 'analyzing',
      agents: [
        {
          agentId: 'security',
          state: 'found',
          activity: 'x',
          filesScanned: 12,
          findingCount: 3,
          progress: 0.5,
        },
      ],
    });
    expect(state.agents.security.findingCount).toBe(3);
  });
});

describe('useScanStream', () => {
  it('connects and reports the transport', () => {
    const { result, source } = setup();
    expect(source.url).toContain('/api/scans/scn_test/events');
    expect(result.current.transport).toBe('stream');
  });

  it('applies scan state and progress', () => {
    const { result, source } = setup();
    act(() =>
      source.emit(1, {
        type: 'scan_state',
        at: now(),
        state: 'indexing',
        progress: 0.25,
        message: 'Indexing 30 files',
      }),
    );
    expect(result.current.state).toBe('indexing');
    expect(result.current.progress).toBe(0.25);
    expect(result.current.message).toBe('Indexing 30 files');
  });

  it('never moves progress backwards', () => {
    const { result, source } = setup();
    act(() => source.emit(1, { type: 'scan_progress', at: now(), progress: 0.5, message: 'a' }));
    act(() => source.emit(2, { type: 'scan_progress', at: now(), progress: 0.2, message: 'b' }));
    expect(result.current.progress).toBe(0.5);
  });

  it('ignores a duplicate or out-of-order sequence', () => {
    const { result, source } = setup();
    const finding = {
      type: 'agent_finding' as const,
      at: now(),
      agentId: 'security' as const,
      finding: {
        id: 'x',
        title: 'SQL injection',
        severity: 'critical' as const,
        category: 'security' as const,
        confidence: 0.9,
        path: 'src/db.ts',
      },
    };
    act(() => source.emit(5, finding));
    act(() => source.emit(5, finding));
    act(() => source.emit(3, finding));
    expect(result.current.findings).toHaveLength(1);
    expect(result.current.agents.security.findingCount).toBe(1);
  });

  it('tracks agent lifecycle', () => {
    const { result, source } = setup();
    act(() =>
      source.emit(1, { type: 'agent_started', at: now(), agentId: 'bugs', activity: 'Reading' }),
    );
    expect(result.current.agents.bugs.state).toBe('scanning');

    act(() =>
      source.emit(2, {
        type: 'agent_progress',
        at: now(),
        agentId: 'bugs',
        activity: 'Checking error handling',
        filesScanned: 23,
        progress: 0.5,
        state: 'thinking',
      }),
    );
    expect(result.current.agents.bugs.state).toBe('thinking');
    expect(result.current.agents.bugs.filesScanned).toBe(23);

    act(() =>
      source.emit(3, {
        type: 'agent_complete',
        at: now(),
        agentId: 'bugs',
        findingCount: 2,
        filesScanned: 30,
      }),
    );
    expect(result.current.agents.bugs.state).toBe('complete');
    expect(result.current.agents.bugs.progress).toBe(1);
  });

  it('keeps a failed agent visible rather than silently dropping it', () => {
    const { result, source } = setup();
    act(() =>
      source.emit(1, {
        type: 'agent_error',
        at: now(),
        agentId: 'performance',
        message: 'This agent could not finish.',
      }),
    );
    expect(result.current.agents.performance.state).toBe('error');
    expect(result.current.console.some((e) => e.kind === 'error')).toBe(true);
  });

  it('pairs validation start with its outcome', () => {
    const { result, source } = setup();
    act(() =>
      source.emit(1, {
        type: 'validation_started',
        at: now(),
        findingId: 'f1',
        title: 'SQL injection',
      }),
    );
    expect(result.current.validations[0]!.status).toBeUndefined();

    act(() =>
      source.emit(2, {
        type: 'validation_complete',
        at: now(),
        findingId: 'f1',
        status: 'confirmed',
        confidence: 0.94,
      }),
    );
    expect(result.current.validations[0]!.status).toBe('confirmed');
    expect(result.current.validations[0]!.confidence).toBe(0.94);
  });

  it('completes, marks every agent done and closes the stream', () => {
    const { result, source } = setup();
    act(() => source.emit(1, { type: 'scan_complete', at: now(), scanId: 'scn_test', score: 82 }));
    expect(result.current.state).toBe('complete');
    expect(result.current.score).toBe(82);
    expect(result.current.progress).toBe(1);
    expect(result.current.agents.security.state).toBe('complete');
    expect(result.current.isTerminal).toBe(true);
    expect(source.closed).toBe(true);
  });

  it('surfaces a failure with its recovery hint', () => {
    const { result, source } = setup();
    act(() =>
      source.emit(1, {
        type: 'scan_failed',
        at: now(),
        scanId: 'scn_test',
        error: {
          code: 'rate_limited',
          message: 'GitHub rate limit reached.',
          hint: 'Try again in 14 minutes.',
          retryable: true,
        },
      }),
    );
    expect(result.current.state).toBe('failed');
    expect(result.current.error?.code).toBe('rate_limited');
    expect(result.current.error?.hint).toContain('14 minutes');
  });

  it('caps the console so a long scan cannot grow without bound', () => {
    const { result, source } = setup();
    act(() => {
      for (let i = 1; i <= 400; i += 1) {
        source.emit(i, { type: 'log', at: now(), agentId: 'security', message: `line ${i}` });
      }
    });
    expect(result.current.console.length).toBeLessThanOrEqual(220);
    expect(result.current.console.at(-1)!.message).toBe('line 400');
  });

  it('resumes from the last sequence after a reconnect', () => {
    FakeEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    const { unmount } = renderHook(() => useScanStream('scn_test', scan()));
    const first = FakeEventSource.instances[0]!;
    act(() => first.open());
    act(() => first.emit(7, { type: 'log', at: now(), agentId: 'security', message: 'x' }));
    unmount();
    expect(first.closed).toBe(true);
  });
});
