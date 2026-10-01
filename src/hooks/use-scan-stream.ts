'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type {
  AgentId,
  AgentRun,
  Debate,
  FindingPreview,
  Scan,
  ScanError,
  ScanEvent,
  ScanState,
  Severity,
  ValidationStatus,
} from '@/types';
import { AGENTS, WORKER_AGENT_IDS } from '@/lib/constants';

/**
 * Live scan state, assembled from the server event stream.
 *
 * Transport is Server-Sent Events with the browser's own reconnection, resumed
 * from the durable event log via `Last-Event-ID`. If the stream cannot be
 * established at all — a proxy that buffers, a runtime without streaming — the
 * hook falls back to polling the scan resource so the page still progresses.
 */

export interface ConsoleEntry {
  id: number;
  at: string;
  agentId: AgentId;
  message: string;
  kind: 'log' | 'finding' | 'validation' | 'state' | 'error';
  severity?: Severity;
}

export interface ValidationEntry {
  findingId: string;
  title: string;
  status?: ValidationStatus;
  confidence?: number;
}

export interface ScanStreamState {
  transport: 'connecting' | 'stream' | 'polling' | 'closed';
  state: ScanState;
  progress: number;
  message: string;
  agents: Record<AgentId, AgentRun>;
  console: ConsoleEntry[];
  findings: (FindingPreview & { agentId: AgentId })[];
  debates: Debate[];
  validations: ValidationEntry[];
  error: ScanError | null;
  score: number | null;
  lastSeq: number;
}

const CONSOLE_LIMIT = 220;
const FINDING_LIMIT = 120;

function initialAgents(): Record<AgentId, AgentRun> {
  const entries = (Object.keys(AGENTS) as AgentId[]).map<[AgentId, AgentRun]>((id) => [
    id,
    {
      agentId: id,
      state: 'idle',
      activity: id === 'validator' ? 'Waiting for findings' : 'Awaiting assignment',
      filesScanned: 0,
      findingCount: 0,
      progress: 0,
    },
  ]);
  return Object.fromEntries(entries) as Record<AgentId, AgentRun>;
}

export function initialState(scan?: Scan | null): ScanStreamState {
  const agents = initialAgents();
  if (scan?.agents?.length) {
    for (const run of scan.agents) agents[run.agentId] = run;
  }
  return {
    transport: 'connecting',
    state: scan?.state ?? 'queued',
    progress: scan?.progress ?? 0,
    message: scan?.statusMessage ?? 'Queued',
    agents,
    console: [],
    findings: [],
    debates: [],
    validations: [],
    error: scan?.error ?? null,
    score: scan?.score ?? null,
    lastSeq: 0,
  };
}

type Action =
  | { type: 'event'; seq: number; event: ScanEvent }
  | { type: 'transport'; value: ScanStreamState['transport'] }
  | { type: 'poll'; scan: Scan };

let consoleCounter = 0;

function pushConsole(state: ScanStreamState, entry: Omit<ConsoleEntry, 'id'>): ConsoleEntry[] {
  consoleCounter += 1;
  const next = [...state.console, { ...entry, id: consoleCounter }];
  return next.length > CONSOLE_LIMIT ? next.slice(next.length - CONSOLE_LIMIT) : next;
}

function reducer(state: ScanStreamState, action: Action): ScanStreamState {
  if (action.type === 'transport') return { ...state, transport: action.value };

  if (action.type === 'poll') {
    const agents = { ...state.agents };
    for (const run of action.scan.agents) agents[run.agentId] = run;
    return {
      ...state,
      state: action.scan.state,
      progress: Math.max(state.progress, action.scan.progress),
      message: action.scan.statusMessage,
      agents,
      error: action.scan.error ?? state.error,
      score: action.scan.score ?? state.score,
    };
  }

  const { event, seq } = action;
  // Out-of-order or duplicate delivery is possible across a reconnect.
  if (seq <= state.lastSeq) return state;
  const next: ScanStreamState = { ...state, lastSeq: seq };

  switch (event.type) {
    case 'scan_state':
      return {
        ...next,
        state: event.state,
        progress: Math.max(next.progress, event.progress),
        message: event.message,
        console: pushConsole(next, {
          at: event.at,
          agentId: 'orchestrator',
          message: event.message,
          kind: 'state',
        }),
      };

    case 'scan_progress':
      return { ...next, progress: Math.max(next.progress, event.progress), message: event.message };

    case 'agent_started': {
      const agents = { ...next.agents };
      const current = agents[event.agentId];
      agents[event.agentId] = {
        ...current,
        state: 'scanning',
        activity: event.activity,
        startedAt: event.at,
      };
      return {
        ...next,
        agents,
        console: pushConsole(next, {
          at: event.at,
          agentId: event.agentId,
          message: 'Deployed',
          kind: 'state',
        }),
      };
    }

    case 'agent_progress': {
      const agents = { ...next.agents };
      const current = agents[event.agentId];
      agents[event.agentId] = {
        ...current,
        state: event.state,
        activity: event.activity,
        filesScanned: event.filesScanned,
        progress: event.progress,
      };
      return { ...next, agents };
    }

    case 'agent_finding': {
      const agents = { ...next.agents };
      const current = agents[event.agentId];
      agents[event.agentId] = {
        ...current,
        state: 'found',
        findingCount: current.findingCount + 1,
      };
      const findings = [...next.findings, { ...event.finding, agentId: event.agentId }];
      return {
        ...next,
        agents,
        findings: findings.length > FINDING_LIMIT ? findings.slice(-FINDING_LIMIT) : findings,
        console: pushConsole(next, {
          at: event.at,
          agentId: event.agentId,
          message: event.finding.title,
          kind: 'finding',
          severity: event.finding.severity,
        }),
      };
    }

    case 'agent_complete': {
      const agents = { ...next.agents };
      agents[event.agentId] = {
        ...agents[event.agentId],
        state: 'complete',
        progress: 1,
        filesScanned: event.filesScanned,
        finishedAt: event.at,
      };
      return { ...next, agents };
    }

    case 'agent_error': {
      const agents = { ...next.agents };
      agents[event.agentId] = {
        ...agents[event.agentId],
        state: 'error',
        activity: event.message,
        error: event.message,
        finishedAt: event.at,
      };
      return {
        ...next,
        agents,
        console: pushConsole(next, {
          at: event.at,
          agentId: event.agentId,
          message: event.message,
          kind: 'error',
        }),
      };
    }

    case 'agent_debate':
      return {
        ...next,
        debates: [...next.debates, event.debate],
        console: pushConsole(next, {
          at: event.at,
          agentId: 'validator',
          message: `Debate resolved — ${event.debate.topic}`,
          kind: 'validation',
        }),
      };

    case 'validation_started': {
      const agents = { ...next.agents };
      agents.validator = {
        ...agents.validator,
        state: 'validating',
        activity: `Testing: ${event.title}`,
      };
      return {
        ...next,
        agents,
        validations: [
          ...next.validations.filter((v) => v.findingId !== event.findingId),
          { findingId: event.findingId, title: event.title },
        ].slice(-40),
      };
    }

    case 'validation_complete': {
      const agents = { ...next.agents };
      agents.validator = { ...agents.validator, findingCount: agents.validator.findingCount + 1 };
      return {
        ...next,
        agents,
        validations: next.validations.map((entry) =>
          entry.findingId === event.findingId
            ? { ...entry, status: event.status, confidence: event.confidence }
            : entry,
        ),
      };
    }

    case 'log':
      return {
        ...next,
        console: pushConsole(next, {
          at: event.at,
          agentId: event.agentId,
          message: event.message,
          kind: 'log',
        }),
      };

    case 'scan_complete': {
      const agents = { ...next.agents };
      for (const id of [...WORKER_AGENT_IDS, 'validator'] as AgentId[]) {
        if (agents[id].state !== 'error') agents[id] = { ...agents[id], state: 'complete', progress: 1 };
      }
      return {
        ...next,
        agents,
        state: 'complete',
        progress: 1,
        score: event.score,
        message: 'Analysis complete',
        transport: 'closed',
      };
    }

    case 'scan_failed':
      return {
        ...next,
        state: 'failed',
        progress: 1,
        error: event.error,
        message: event.error.message,
        transport: 'closed',
        console: pushConsole(next, {
          at: event.at,
          agentId: 'orchestrator',
          message: event.error.message,
          kind: 'error',
        }),
      };

    default:
      return next;
  }
}

const TERMINAL: ScanState[] = ['complete', 'failed'];

export function useScanStream(scanId: string, initialScan?: Scan | null) {
  const [state, dispatch] = useReducer(reducer, initialScan, initialState);
  const seqRef = useRef(0);
  const finishedRef = useRef(TERMINAL.includes(initialScan?.state ?? 'queued'));

  useEffect(() => {
    seqRef.current = state.lastSeq;
  }, [state.lastSeq]);

  useEffect(() => {
    if (finishedRef.current) return;

    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let failures = 0;
    let cancelled = false;

    /** Last resort: poll the scan resource so progress still advances. */
    function startPolling() {
      if (pollTimer || cancelled) return;
      dispatch({ type: 'transport', value: 'polling' });
      pollTimer = setInterval(async () => {
        try {
          const response = await fetch(`/api/scans/${scanId}`, { cache: 'no-store' });
          if (!response.ok) return;
          const body = (await response.json()) as { scan: Scan };
          dispatch({ type: 'poll', scan: body.scan });
          if (TERMINAL.includes(body.scan.state)) {
            finishedRef.current = true;
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = null;
          }
        } catch {
          // Keep polling; the next tick may succeed.
        }
      }, 2_000);
    }

    function connect() {
      if (cancelled) return;
      const since = seqRef.current;
      source = new EventSource(`/api/scans/${scanId}/events${since ? `?since=${since}` : ''}`);

      source.onopen = () => {
        failures = 0;
        dispatch({ type: 'transport', value: 'stream' });
      };

      source.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as ScanEvent;
          const seq = Number(message.lastEventId) || seqRef.current + 1;
          seqRef.current = seq;
          dispatch({ type: 'event', seq, event });
          if (event.type === 'scan_complete' || event.type === 'scan_failed') {
            finishedRef.current = true;
            source?.close();
            dispatch({ type: 'transport', value: 'closed' });
          }
        } catch {
          // A malformed frame is not worth tearing the stream down for.
        }
      };

      source.addEventListener('done', () => {
        finishedRef.current = true;
        source?.close();
        dispatch({ type: 'transport', value: 'closed' });
      });

      source.onerror = () => {
        source?.close();
        if (finishedRef.current || cancelled) return;
        failures += 1;
        // EventSource retries on its own, but only for transport hiccups.
        // Repeated failures mean streaming is not viable here.
        if (failures >= 3) {
          startPolling();
          return;
        }
        setTimeout(connect, 600 * failures);
      };
    }

    // `EventSource` is absent in a few embedded webviews.
    if (typeof EventSource === 'undefined') startPolling();
    else connect();

    return () => {
      cancelled = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [scanId]);

  const isTerminal = TERMINAL.includes(state.state);

  const reset = useCallback(() => {
    finishedRef.current = false;
    seqRef.current = 0;
  }, []);

  return { ...state, isTerminal, reset };
}
