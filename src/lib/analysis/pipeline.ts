import type {
  AgentId,
  AgentRun,
  AnalysisMode,
  Debate,
  Finding,
  RawFinding,
  Report,
  ToolchainStatus,
  ValidationStatus,
} from '@/types';
import { AGENTS, WORKER_AGENT_IDS } from '@/lib/constants';
import { createLogger } from '@/lib/logger';
import type { AIProvider } from '@/lib/ai';
import type { RepoIndex } from './repo-index';
import { buildModuleGraph } from './graph';
import { analyzeStructure } from './metrics';
import { aggregateFindings } from './dedupe';
import { applySuppressions, buildSuppressions } from './ignore';
import { computeHealthScore } from './scoring';
import { buildImprovementPlan } from './roadmap';
import { buildArchitectureMap } from './architecture-map';
import { buildSummary } from './summary';
import { analyzeDependencies } from '@/lib/security/dependencies';
import { createRedactor, scanForSecrets } from '@/lib/security/secrets';
import { narrateSummary } from '@/agents/ai-pass';
import type { Agent, AgentContext, AgentEmitter, AgentResult } from '@/agents/types';
import { AgentAborted } from '@/agents/types';
import { runValidator } from '@/agents/validator';
import { securityAgent } from '@/agents/security';
import { bugAgent } from '@/agents/bugs';
import { architectureAgent } from '@/agents/architecture';
import { testingAgent } from '@/agents/testing';
import { dependencyAgent } from '@/agents/dependencies';
import { performanceAgent } from '@/agents/performance';
import { aiCodeAgent } from '@/agents/ai-code';
import { maintainabilityAgent } from '@/agents/maintainability';

const logger = createLogger('pipeline');

/**
 * The analysis pipeline.
 *
 * Takes an indexed repository and returns a report. It knows nothing about
 * HTTP, storage or event streams — the web orchestrator wraps it with hooks
 * that publish progress, and the CLI wraps it with hooks that print. Keeping
 * the two on one implementation is what stops the CLI and the product from
 * drifting into different answers for the same repository.
 */

export const WORKER_AGENTS: Record<(typeof WORKER_AGENT_IDS)[number], Agent> = {
  security: securityAgent,
  bugs: bugAgent,
  architecture: architectureAgent,
  testing: testingAgent,
  dependencies: dependencyAgent,
  performance: performanceAgent,
  'ai-code': aiCodeAgent,
  maintainability: maintainabilityAgent,
};

export type PipelinePhase = 'indexing' | 'analyzing' | 'validating' | 'reporting';

export interface PipelineHooks {
  /** Coarse progress within a phase, 0..1. */
  phase?(phase: PipelinePhase, message: string, within: number): void;
  note?(agentId: AgentId, message: string): void;
  agentStarted?(agentId: AgentId): void;
  /** Supplies the emitter an agent reports through. */
  emitterFor?(agentId: AgentId): AgentEmitter;
  agentCompleted?(agentId: AgentId, result: AgentResult, durationMs: number): void;
  agentFailed?(agentId: AgentId, message: string): void;
  aggregated?(rawCount: number, dedupedCount: number): void;
  validationStarted?(finding: Finding): void;
  validationCompleted?(finding: Finding, status: ValidationStatus, confidence: number): void;
  debateRecorded?(debate: Debate): void;
}

export interface PipelineOptions {
  scanId: string;
  mode: AnalysisMode;
  ai: AIProvider;
  /** Presentation pacing, in milliseconds. 0 for non-interactive runs. */
  pace?: number;
  signal?: AbortSignal;
  /** Allow outbound calls for live advisory data. */
  allowNetwork?: boolean;
  hooks?: PipelineHooks;
  /** Extra sentence prepended to the report caveat, e.g. a demo fallback notice. */
  caveatPrefix?: string;
}

export interface PipelineResult {
  report: Report;
  agents: AgentRun[];
  telemetry: {
    agentDurations: Record<string, number>;
    agentFailures: string[];
    rawFindings: number;
    dedupedFindings: number;
    validated: number;
    dismissed: number;
    dependencyCount: number;
  };
}

/** A no-op emitter for runs nobody is watching. */
function silentEmitter(): AgentEmitter {
  return { activity: () => {}, log: () => {}, finding: () => {} };
}

export async function analyzeIndex(
  index: RepoIndex,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const { scanId, mode, ai, hooks = {} } = options;
  const pace = options.pace ?? 0;
  const signal = options.signal ?? new AbortController().signal;
  const allowNetwork = options.allowNetwork ?? mode === 'live';
  const startedAt = Date.now();

  /* ---------------- Indexing ---------------- */
  hooks.phase?.('indexing', 'Building the module graph', 0.3);
  const graph = buildModuleGraph(index);

  hooks.phase?.('indexing', 'Measuring structure and duplication', 0.6);
  const structure = analyzeStructure(index, graph.unusedExports.length);

  hooks.phase?.('indexing', 'Sweeping for committed credentials', 0.8);
  const secrets = scanForSecrets(index);
  const redact = createRedactor(secrets.secrets);

  hooks.phase?.('indexing', 'Reading dependency manifests', 0.9);
  const dependencies = await analyzeDependencies(index, { allowNetwork });

  /* ---------------- Analysis ---------------- */
  hooks.phase?.('analyzing', 'AI engineering team deployed', 0);
  hooks.note?.(
    'orchestrator',
    `Deploying ${WORKER_AGENT_IDS.length} agents across ${index.files.length} files`,
  );

  const rawFindings: RawFinding[] = [];
  const agentNotes = new Map<AgentId, string[]>();
  const agentDurations: Record<string, number> = {};
  const agentFailures: string[] = [];
  let completed = 0;

  await Promise.all(
    WORKER_AGENT_IDS.map(async (agentId) => {
      const agent = WORKER_AGENTS[agentId];
      const started = Date.now();
      hooks.agentStarted?.(agentId);

      // Findings emitted before a crash are still real; keep them.
      const collected: RawFinding[] = [];
      const emitter = hooks.emitterFor?.(agentId) ?? silentEmitter();
      const ctx: AgentContext = {
        scanId,
        index,
        graph,
        structure,
        dependencies,
        secrets,
        ai,
        pace,
        signal,
        emit: {
          activity: emitter.activity,
          log: emitter.log,
          finding: (finding) => {
            collected.push(finding);
            emitter.finding(finding);
          },
        },
      };

      try {
        const result = await agent.run(ctx);
        rawFindings.push(...result.findings);
        agentNotes.set(agentId, result.notes);
        agentDurations[agentId] = Date.now() - started;
        hooks.agentCompleted?.(agentId, result, agentDurations[agentId]!);
      } catch (error) {
        if (error instanceof AgentAborted) throw error;
        // One agent failing must not lose the other seven.
        agentFailures.push(agentId);
        rawFindings.push(...collected);
        const message = error instanceof Error ? error.message : String(error);
        logger.error('agent.failed', { scanId, agentId, error: message });
        hooks.agentFailed?.(agentId, message);
      } finally {
        completed += 1;
        hooks.phase?.(
          'analyzing',
          `${completed} of ${WORKER_AGENT_IDS.length} agents finished`,
          completed / WORKER_AGENT_IDS.length,
        );
      }
    }),
  );

  /* ---------------- Aggregation ---------------- */
  hooks.phase?.('analyzing', 'Merging findings across agents', 1);
  const aggregated = aggregateFindings(scanId, rawFindings);
  // Belt and braces: a snippet rendered for one finding can contain a
  // neighbouring credential, so every matched value is masked report-wide
  // before anything is persisted or sent to a browser.
  redactFindings(aggregated.findings, redact);

  const suppressions = buildSuppressions(index);
  const { kept, suppressed } = applySuppressions(aggregated.findings, suppressions);
  if (suppressed.length > 0) {
    hooks.note?.(
      'orchestrator',
      `${suppressed.length} findings suppressed by .sentinelignore or inline comments`,
    );
  }

  hooks.aggregated?.(aggregated.rawCount, kept.length);
  hooks.note?.(
    'orchestrator',
    `${aggregated.rawCount} raw findings merged into ${kept.length} unique issues`,
  );

  /* ---------------- Validation ---------------- */
  hooks.phase?.('validating', `Validating ${kept.length} findings`, 0);
  const validatorCtx: AgentContext = {
    scanId,
    index,
    graph,
    structure,
    dependencies,
    secrets,
    ai,
    pace,
    signal,
    emit: hooks.emitterFor?.('validator') ?? silentEmitter(),
  };

  const debates: Debate[] = [];
  const validation = await runValidator(validatorCtx, kept, {
    onStart: (finding) => hooks.validationStarted?.(finding),
    onComplete: (finding, status, confidence) =>
      hooks.validationCompleted?.(finding, status, confidence),
    onDebate: (debate) => {
      debates.push(debate);
      hooks.debateRecorded?.(debate);
    },
  });

  /* ---------------- Report ---------------- */
  hooks.phase?.('reporting', 'Scoring and building the improvement plan', 0.2);
  const findings: Finding[] = validation.findings;
  const score = computeHealthScore({ findings, metrics: structure.metrics });

  hooks.phase?.('reporting', 'Grouping findings by root cause', 0.5);
  const plan = buildImprovementPlan(findings, structure.metrics, index, dependencies.report);

  hooks.phase?.('reporting', 'Mapping architecture', 0.7);
  const architecture = buildArchitectureMap(index, graph, findings);

  let summary = buildSummary(findings, score.overall, plan);
  if (ai.available) {
    const narrated = await narrateSummary(
      { ai, index },
      {
        score: score.overall,
        counts: summary.counts,
        topTitles: summary.topPriorities.map((p) => p.title),
        rootCauses: plan.rootCauses.map((c) => c.title),
      },
    );
    if (narrated) summary = { ...summary, ...narrated };
  }
  if (options.caveatPrefix) {
    summary = { ...summary, caveat: `${options.caveatPrefix} ${summary.caveat}` };
  }

  const agents: AgentRun[] = [...WORKER_AGENT_IDS, 'validator'].map((id) => {
    const agentId = id as AgentId;
    const failed = agentFailures.includes(agentId);
    return {
      agentId,
      state: failed ? 'error' : 'complete',
      activity: agentNotes.get(agentId)?.join(' · ') ?? AGENTS[agentId].role,
      filesScanned: index.files.length,
      findingCount: findings.filter((f) => f.detectedBy.includes(agentId)).length,
      progress: 1,
      ...(failed ? { error: 'This agent could not finish.' } : {}),
    };
  });

  const report: Report = {
    scanId,
    repo: index.repo,
    mode,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    score,
    summary,
    findings,
    debates,
    plan,
    architecture,
    dependencies: dependencies.report,
    metrics: structure.metrics,
    agents,
    toolchain: buildToolchain(
      mode,
      dependencies.report.live,
      ai.available,
      ai.name,
      ai.unavailableReason,
      suppressions.configured ? suppressed.length : null,
    ),
    suppressedCount: suppressed.length,
  };

  return {
    report,
    agents,
    telemetry: {
      agentDurations,
      agentFailures,
      rawFindings: aggregated.rawCount,
      dedupedFindings: findings.length,
      validated: validation.confirmed,
      dismissed: validation.dismissed,
      dependencyCount: dependencies.report.nodes.length,
    },
  };
}

/**
 * Masks every matched credential across all rendered finding text.
 *
 * Applied after aggregation and before anything is persisted or returned, so
 * no secret value can reach a store, a log line, a browser or an export.
 */
export function redactFindings(findings: Finding[], redact: (text: string) => string) {
  for (const finding of findings) {
    finding.summary = redact(finding.summary);
    finding.impact = redact(finding.impact);
    finding.recommendation = redact(finding.recommendation);
    for (const location of [finding.location, ...finding.otherLocations]) {
      if (location.snippet) location.snippet = redact(location.snippet);
    }
    for (const evidence of finding.evidence) evidence.detail = redact(evidence.detail);
    for (const step of finding.dataFlow ?? []) {
      if (step.detail) step.detail = redact(step.detail);
    }
    if (finding.patch) finding.patch.diff = redact(finding.patch.diff);
  }
}

export function buildToolchain(
  mode: string,
  liveAdvisories: boolean,
  aiAvailable: boolean,
  aiName: string,
  aiReason?: string,
  suppressed: number | null = null,
): ToolchainStatus[] {
  return [
    ...(suppressed === null
      ? []
      : [
          {
            name: 'Suppressions',
            kind: 'static' as const,
            available: true,
            detail:
              suppressed === 0
                ? 'A suppression config is present but withheld nothing from this report.'
                : `${suppressed} ${suppressed === 1 ? 'finding was' : 'findings were'} withheld by .sentinelignore or an inline comment.`,
          },
        ]),
    {
      name: 'Secret scanner',
      kind: 'secrets',
      available: true,
      detail:
        'Vendor-format patterns plus a Shannon-entropy pass over credential-shaped assignments.',
    },
    {
      name: 'Pattern rules',
      kind: 'static',
      available: true,
      detail:
        'Injection, configuration, reliability, performance and integration rules with line-level evidence.',
    },
    {
      name: 'Module graph',
      kind: 'ast',
      available: true,
      detail: 'Import resolution, cycle detection, reachability and dead-export analysis.',
    },
    {
      name: 'Structural metrics',
      kind: 'ast',
      available: true,
      detail:
        'Complexity, nesting, function length and cross-file duplication fingerprinting.',
    },
    {
      name: 'Dependency advisories',
      kind: 'dependency',
      available: true,
      detail: liveAdvisories
        ? 'Live OSV.dev lookup for every declared package.'
        : 'Bundled advisory snapshot. Enable outbound network access for full OSV coverage.',
    },
    {
      name: 'AI reasoning',
      kind: 'ai',
      available: aiAvailable,
      detail: aiAvailable
        ? `Enrichment and validator adjudication via ${aiName}.`
        : (aiReason ?? 'No AI provider configured. Deterministic analysis only.'),
    },
    {
      name: 'Repository source',
      kind: 'static',
      available: mode === 'live',
      detail:
        mode === 'live'
          ? 'Analysed from the repository source.'
          : 'Bundled sample repository — results are labelled DEMO DATA.',
    },
  ];
}
