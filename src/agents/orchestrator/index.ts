import type {
  AgentId,
  AgentRun,
  AgentState,
  Scan,
  ScanError,
  ScanState,
} from '@/types';
import { AGENTS, WORKER_AGENT_IDS } from '@/lib/constants';
import { getStore, isEphemeral } from '@/lib/db';
import { publish, primeSequence, closeChannel, flushEvents } from '@/lib/events/bus';
import { getAIProvider } from '@/lib/ai';
import { createLogger, recordScanTelemetry } from '@/lib/logger';
import { env } from '@/lib/env';
import { registerScanRunner } from '@/lib/queue';
import { ingestRepository } from '@/lib/analysis/ingest';
import { GitHubError } from '@/lib/github/client';
import { analyzeIndex, type PipelineHooks } from '@/lib/analysis/pipeline';
import { buildDemoIndex, isDemoSlug } from '@/lib/demo';
import type { AgentEmitter } from '../types';
import { AgentAborted } from '../types';

const logger = createLogger('orchestrator');

/**
 * The web orchestrator.
 *
 * Ingests the repository, runs the shared analysis pipeline, and translates
 * everything the pipeline reports into events on the scan's stream and rows in
 * the store. The analysis itself lives in `lib/analysis/pipeline` so the CLI
 * and this both produce the same report for the same repository.
 */

/* ------------------------------------------------------------------ */
/* Progress model                                                      */
/* ------------------------------------------------------------------ */

/** Weight of each phase in the overall progress bar. */
const PHASE_WEIGHT: Record<ScanState, [start: number, end: number]> = {
  queued: [0, 0.02],
  cloning: [0.02, 0.18],
  indexing: [0.18, 0.34],
  analyzing: [0.34, 0.76],
  validating: [0.76, 0.92],
  generating_report: [0.92, 0.99],
  complete: [1, 1],
  failed: [1, 1],
};

function phaseProgress(state: ScanState, within: number): number {
  const [start, end] = PHASE_WEIGHT[state];
  return Number((start + (end - start) * Math.min(1, Math.max(0, within))).toFixed(4));
}

/* ------------------------------------------------------------------ */
/* Scan run                                                            */
/* ------------------------------------------------------------------ */

class ScanRun {
  private agents = new Map<AgentId, AgentRun>();
  private readonly startedAt = Date.now();

  constructor(private readonly scan: Scan) {
    for (const id of [...WORKER_AGENT_IDS, 'validator', 'orchestrator'] as AgentId[]) {
      this.agents.set(id, {
        agentId: id,
        state: 'idle',
        activity: id === 'validator' ? 'Waiting for findings' : 'Awaiting assignment',
        filesScanned: 0,
        findingCount: 0,
        progress: 0,
      });
    }
  }

  snapshot(): AgentRun[] {
    return [...this.agents.values()];
  }

  get elapsed(): number {
    return Date.now() - this.startedAt;
  }

  async setState(state: ScanState, message: string, within = 0) {
    const progress = phaseProgress(state, within);
    await getStore().updateScan(this.scan.id, {
      state,
      progress,
      statusMessage: message,
      agents: this.snapshot(),
    });
    publish(this.scan.id, {
      type: 'scan_state',
      at: new Date().toISOString(),
      state,
      progress,
      message,
    });
  }

  progressWithin(state: ScanState, within: number, message: string) {
    const progress = phaseProgress(state, within);
    publish(this.scan.id, {
      type: 'scan_progress',
      at: new Date().toISOString(),
      progress,
      message,
    });
    void getStore().updateScan(this.scan.id, {
      progress,
      statusMessage: message,
      agents: this.snapshot(),
    });
  }

  agentState(id: AgentId, state: AgentState) {
    const run = this.agents.get(id);
    if (!run) return;
    run.state = state;
    if (state === 'scanning' && !run.startedAt) run.startedAt = new Date().toISOString();
    if (state === 'complete' || state === 'error') run.finishedAt = new Date().toISOString();
  }

  /** Builds the emitter an agent reports through. */
  emitterFor(id: AgentId): AgentEmitter {
    const run = this.agents.get(id)!;
    const scanId = this.scan.id;

    return {
      activity: (message, progress, filesScanned) => {
        run.activity = message;
        if (progress !== undefined) run.progress = progress;
        if (filesScanned !== undefined) run.filesScanned = filesScanned;
        if (run.state === 'idle') run.state = 'scanning';
        publish(scanId, {
          type: 'agent_progress',
          at: new Date().toISOString(),
          agentId: id,
          activity: message,
          filesScanned: run.filesScanned,
          progress: run.progress,
          state: run.state,
        });
      },
      log: (message) => {
        publish(scanId, { type: 'log', at: new Date().toISOString(), agentId: id, message });
      },
      finding: (finding) => {
        run.findingCount += 1;
        run.state = 'found';
        publish(scanId, {
          type: 'agent_finding',
          at: new Date().toISOString(),
          agentId: id,
          finding: {
            id: `${id}-${run.findingCount}`,
            title: finding.title,
            severity: finding.severity,
            category: finding.category,
            confidence: finding.confidence,
            path: finding.location.path,
            ...(finding.location.startLine ? { line: finding.location.startLine } : {}),
          },
        });
      },
    };
  }
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

function toScanError(error: unknown): ScanError {
  if (error instanceof GitHubError) return error.scanError;
  if (error instanceof AgentAborted) {
    return {
      code: 'timeout',
      message: 'The analysis ran out of time before it finished.',
      hint: 'Large repositories may need a higher SCAN_TIMEOUT_MS.',
      retryable: true,
    };
  }
  logger.error('scan.unexpected', {
    error: error instanceof Error ? error.message : String(error),
  });
  return {
    code: 'internal',
    message: 'Something went wrong while analysing this repository.',
    hint: 'The error has been logged. Retrying often works if the cause was transient.',
    retryable: true,
  };
}

export interface RunScanOptions {
  /**
   * Overrides the presentation pace. The landing page's example report runs
   * with `pace: 0` because nobody is watching it stream.
   */
  pace?: number;
}

export async function runScan(scanId: string, options: RunScanOptions = {}): Promise<void> {
  const store = getStore();
  const scan = await store.getScan(scanId);
  if (!scan) {
    logger.warn('scan.missing', { scanId });
    return;
  }
  if (scan.state !== 'queued') {
    logger.warn('scan.not_queued', { scanId, state: scan.state });
    return;
  }

  await primeSequence(scanId);
  const run = new ScanRun(scan);
  const controller = new AbortController();
  const budget = setTimeout(() => controller.abort(), env().SCAN_TIMEOUT_MS);
  const ai = getAIProvider();
  const pace = options.pace ?? env().SCAN_PACE_MS;

  await store.updateScan(scanId, { startedAt: new Date().toISOString() });

  try {
    /* ---------------- Ingestion ---------------- */
    await run.setState('cloning', `Resolving github.com/${scan.repo.slug}`, 0);

    let index;
    let mode = scan.mode;
    let caveatPrefix: string | undefined;

    if (mode === 'demo' || isDemoSlug(scan.repo.slug)) {
      mode = 'demo';
      run.progressWithin('cloning', 0.5, 'Loading the bundled sample repository');
      index = buildDemoIndex();
    } else {
      try {
        index = await ingestRepository(scan.repo, (message, progress) => {
          run.progressWithin('cloning', progress, message);
        });
      } catch (error) {
        // Network-class failures fall back to the demo so the product always
        // has a working path — but the report says so, loudly and everywhere.
        const scanError = toScanError(error);
        if (scanError.code === 'network' || scanError.code === 'timeout') {
          logger.warn('ingest.fallback_to_demo', { scanId, reason: scanError.code });
          mode = 'demo';
          caveatPrefix = `Live ingestion was unavailable (${scanError.message}) so Sentinel analysed its bundled sample repository instead.`;
          index = buildDemoIndex();
        } else {
          throw error;
        }
      }
    }

    await store.updateScan(scanId, { mode, repo: index.repo });
    await run.setState('indexing', `Indexing ${index.files.length} files`, 0.1);

    /* ---------------- Pipeline ---------------- */
    // The pipeline reports a phase and a position within it; the scan record
    // needs a state transition the first time each phase is entered, and a
    // progress update for everything after that.
    let currentPhase: ScanState = 'indexing';
    let toValidate = 0;
    let validated = 0;

    const hooks: PipelineHooks = {
      phase: (phase, message, within) => {
        const state: ScanState =
          phase === 'reporting' ? 'generating_report' : (phase as ScanState);
        if (state !== currentPhase) {
          currentPhase = state;
          void run.setState(state, message, within);
          return;
        }
        run.progressWithin(state, within, message);
      },
      note: (agentId, message) => {
        publish(scanId, { type: 'log', at: new Date().toISOString(), agentId, message });
      },
      agentStarted: (agentId) => {
        run.agentState(agentId, 'scanning');
        publish(scanId, {
          type: 'agent_started',
          at: new Date().toISOString(),
          agentId,
          activity: AGENTS[agentId].role,
        });
      },
      emitterFor: (agentId) => run.emitterFor(agentId),
      agentCompleted: (agentId, result) => {
        run.agentState(agentId, 'complete');
        publish(scanId, {
          type: 'agent_complete',
          at: new Date().toISOString(),
          agentId,
          findingCount: result.findings.length,
          filesScanned: result.filesScanned,
        });
      },
      agentFailed: (agentId) => {
        run.agentState(agentId, 'error');
        publish(scanId, {
          type: 'agent_error',
          at: new Date().toISOString(),
          agentId,
          message: 'This agent could not finish. Its partial findings are included.',
        });
      },
      aggregated: (_raw, deduped) => {
        toValidate = deduped;
      },
      validationStarted: (finding) => {
        run.agentState('validator', 'validating');
        publish(scanId, {
          type: 'validation_started',
          at: new Date().toISOString(),
          findingId: finding.id,
          title: finding.title,
        });
      },
      validationCompleted: (finding, status, confidence) => {
        publish(scanId, {
          type: 'validation_complete',
          at: new Date().toISOString(),
          findingId: finding.id,
          status,
          confidence,
        });
        // Validation is the longest phase on a large report; without this the
        // overall bar would sit still while the validator worked.
        validated += 1;
        if (toValidate > 0) {
          run.progressWithin(
            'validating',
            validated / toValidate,
            `Validated ${validated} of ${toValidate} findings`,
          );
        }
      },
      debateRecorded: (debate) => {
        publish(scanId, { type: 'agent_debate', at: new Date().toISOString(), debate });
      },
    };

    const { report, agents, telemetry } = await analyzeIndex(index, {
      scanId,
      mode,
      ai,
      pace,
      signal: controller.signal,
      hooks,
      ...(caveatPrefix ? { caveatPrefix } : {}),
    });
    run.agentState('validator', 'complete');

    /* ---------------- Persist ---------------- */
    const durationMs = run.elapsed;
    const finalReport = { ...report, durationMs };
    await store.saveReport(finalReport);
    await store.updateScan(scanId, {
      state: 'complete',
      progress: 1,
      statusMessage: 'Analysis complete',
      score: report.score.overall,
      finishedAt: new Date().toISOString(),
      durationMs,
      agents,
      mode,
    });

    publish(scanId, {
      type: 'scan_complete',
      at: new Date().toISOString(),
      scanId,
      score: report.score.overall,
      // Where the next request lands on another instance, `saveReport` above
      // wrote to memory nothing else can read. The stream is then the only way
      // the report reaches the browser, so it travels with the event. On a
      // single server the page re-renders from the store as usual, and
      // inlining it here would needlessly bloat the event log.
      ...(isEphemeral() ? { report: finalReport } : {}),
    });

    const usage = ai.usage();
    recordScanTelemetry({
      scanId,
      mode,
      durationMs,
      agentDurations: telemetry.agentDurations,
      agentFailures: telemetry.agentFailures,
      aiCalls: usage.calls,
      aiInputTokens: usage.inputTokens,
      aiOutputTokens: usage.outputTokens,
      toolRuns: {
        'secret-scanner': 1,
        'pattern-rules': 1,
        'module-graph': 1,
        'ast-lite': 1,
        dependencies: telemetry.dependencyCount,
      },
      findingsRaw: telemetry.rawFindings,
      findingsDeduped: telemetry.dedupedFindings,
      validated: telemetry.validated,
      dismissed: telemetry.dismissed,
    });
  } catch (error) {
    const scanError = toScanError(error);
    await store.updateScan(scanId, {
      state: 'failed',
      progress: 1,
      statusMessage: scanError.message,
      error: scanError,
      finishedAt: new Date().toISOString(),
      durationMs: run.elapsed,
      agents: run.snapshot(),
    });
    publish(scanId, {
      type: 'scan_failed',
      at: new Date().toISOString(),
      scanId,
      error: scanError,
    });
    logger.warn('scan.failed', { scanId, code: scanError.code });
  } finally {
    clearTimeout(budget);
    // Persist the tail of the event log so a client connecting after the scan
    // finished still replays the whole run.
    await flushEvents(scanId);
    // Give live SSE subscribers a moment to receive the terminal event.
    setTimeout(() => closeChannel(scanId), 2_000).unref?.();
  }
}

/** Called by the queue to wire the runner without a circular import. */
export function registerRunner() {
  registerScanRunner(runScan);
}

registerRunner();
