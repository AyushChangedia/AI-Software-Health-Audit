/**
 * Sentinel domain model.
 *
 * Everything the analysis engine produces and the UI renders is described here.
 * Keep this file free of runtime imports so it can be shared by server workers,
 * API routes and client components alike.
 */

/* ------------------------------------------------------------------ */
/* Enums / unions                                                      */
/* ------------------------------------------------------------------ */

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = [
  'security',
  'reliability',
  'architecture',
  'testing',
  'dependencies',
  'performance',
  'ai-code',
  'maintainability',
] as const;
export type CategoryId = (typeof CATEGORIES)[number];

export const AGENT_IDS = [
  'orchestrator',
  'security',
  'bugs',
  'architecture',
  'testing',
  'dependencies',
  'performance',
  'ai-code',
  'maintainability',
  'validator',
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** Worker agents — everything except the orchestrator and the validator. */
export type WorkerAgentId = Exclude<AgentId, 'orchestrator' | 'validator'>;

export const AGENT_STATES = [
  'idle',
  'scanning',
  'thinking',
  'found',
  'validating',
  'complete',
  'error',
] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export const SCAN_STATES = [
  'queued',
  'cloning',
  'indexing',
  'analyzing',
  'validating',
  'generating_report',
  'complete',
  'failed',
] as const;
export type ScanState = (typeof SCAN_STATES)[number];

/**
 * How much we trust a finding after the validator has looked at it.
 *
 * `confirmed`  — reproduced against the source, evidence is direct.
 * `likely`     — strong signal, one assumption remains unproven.
 * `potential`  — pattern matched but reachability/exploitability unknown.
 * `dismissed`  — a mitigating control was found; kept for transparency.
 */
export const VALIDATION_STATUSES = ['confirmed', 'likely', 'potential', 'dismissed'] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

/** Where the analysis data came from. Surfaced prominently in the UI. */
export type AnalysisMode = 'live' | 'demo';

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

export interface RepoRef {
  owner: string;
  name: string;
  /** `owner/name` */
  slug: string;
  url: string;
  /** Branch or commit the scan targeted, when known. */
  ref?: string;
}

export interface RepoMeta extends RepoRef {
  description?: string;
  defaultBranch?: string;
  stars?: number;
  forks?: number;
  openIssues?: number;
  primaryLanguage?: string;
  license?: string;
  pushedAt?: string;
  sizeKb?: number;
  isPrivate?: boolean;
  isFork?: boolean;
  archived?: boolean;
}

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */

export interface CodeLocation {
  path: string;
  startLine?: number;
  endLine?: number;
  /** A few lines of context around the finding, already trimmed. */
  snippet?: string;
  /** Line number the `snippet` starts at, for gutter rendering. */
  snippetStartLine?: number;
  language?: string;
}

export type EvidenceKind = 'code' | 'tool' | 'reasoning' | 'dependency' | 'config' | 'absence';

export interface Evidence {
  kind: EvidenceKind;
  label: string;
  detail: string;
  path?: string;
  line?: number;
  /** Name of the deterministic tool that produced this, when applicable. */
  source?: string;
}

export interface FlowStep {
  label: string;
  detail?: string;
  path?: string;
  line?: number;
  /** Marks the step where the control breaks down. */
  vulnerable?: boolean;
}

export interface Patch {
  path: string;
  language: string;
  /** Unified-diff text. Rendered with per-line +/- highlighting. */
  diff: string;
  description: string;
  /** Patches we generated heuristically are flagged so users review them. */
  requiresReview: boolean;
}

export interface ExternalReference {
  label: string;
  url: string;
}

export interface Finding {
  id: string;
  scanId: string;
  /** Stable rule identifier, e.g. `sec.sql-injection`. Drives dedupe + patches. */
  ruleId: string;
  title: string;
  category: CategoryId;
  severity: Severity;
  /** 0..1 */
  confidence: number;
  validation: ValidationStatus;
  location: CodeLocation;
  /** Additional locations for the same issue after deduplication. */
  otherLocations: CodeLocation[];
  /** Agents that independently surfaced this finding. */
  detectedBy: AgentId[];
  /** Deterministic analyzers that contributed (e.g. `secret-scanner`, `osv`). */
  detectors: string[];
  validatedBy?: AgentId;
  /** WHAT happened. */
  summary: string;
  /** WHY it matters. */
  impact: string;
  evidence: Evidence[];
  dataFlow?: FlowStep[];
  /** HOW to fix it. */
  recommendation: string;
  patch?: Patch;
  /** Groups findings that share an underlying cause, powering the roadmap. */
  rootCauseId: string;
  cwe?: string;
  owasp?: string;
  references: ExternalReference[];
  /** Rough remediation effort in minutes. Used by the roadmap estimator. */
  effortMinutes: number;
  createdAt: string;
}

/** What a detector returns before aggregation, scoring and validation. */
export type RawFinding = Omit<
  Finding,
  'id' | 'scanId' | 'validation' | 'otherLocations' | 'detectedBy' | 'validatedBy' | 'createdAt'
> & {
  detectedBy: AgentId;
  otherLocations?: CodeLocation[];
};

/* ------------------------------------------------------------------ */
/* Debates                                                             */
/* ------------------------------------------------------------------ */

export type DebateStance = 'claim' | 'challenge' | 'rebuttal' | 'test' | 'verdict';

export interface DebateTurn {
  agent: AgentId;
  stance: DebateStance;
  message: string;
  /** The speaker's confidence at this point in the exchange, when stated. */
  confidence?: number;
  /** Evidence cited in this turn. */
  citation?: { path: string; line?: number };
}

export interface Debate {
  id: string;
  scanId: string;
  findingId: string;
  topic: string;
  turns: DebateTurn[];
  outcome: {
    status: ValidationStatus;
    confidenceBefore: number;
    confidenceAfter: number;
    rationale: string;
  };
}

/* ------------------------------------------------------------------ */
/* Agent runs and the live event stream                                */
/* ------------------------------------------------------------------ */

export interface AgentRun {
  agentId: AgentId;
  state: AgentState;
  /** Short human-readable description of what the agent is doing right now. */
  activity: string;
  filesScanned: number;
  findingCount: number;
  /** 0..1 */
  progress: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface FindingPreview {
  id: string;
  title: string;
  severity: Severity;
  category: CategoryId;
  confidence: number;
  path: string;
  line?: number;
}

export type ScanEvent =
  | { type: 'scan_state'; at: string; state: ScanState; progress: number; message: string }
  | { type: 'scan_progress'; at: string; progress: number; message: string }
  | { type: 'agent_started'; at: string; agentId: AgentId; activity: string }
  | {
      type: 'agent_progress';
      at: string;
      agentId: AgentId;
      activity: string;
      filesScanned: number;
      progress: number;
      state: AgentState;
    }
  | { type: 'agent_finding'; at: string; agentId: AgentId; finding: FindingPreview }
  | { type: 'agent_complete'; at: string; agentId: AgentId; findingCount: number; filesScanned: number }
  | { type: 'agent_error'; at: string; agentId: AgentId; message: string }
  | { type: 'agent_debate'; at: string; debate: Debate }
  | { type: 'validation_started'; at: string; findingId: string; title: string }
  | {
      type: 'validation_complete';
      at: string;
      findingId: string;
      status: ValidationStatus;
      confidence: number;
    }
  | { type: 'log'; at: string; agentId: AgentId; message: string }
  | {
      type: 'scan_complete';
      at: string;
      scanId: string;
      score: number;
      /**
       * The finished report, inlined.
       *
       * Only populated when the scan ran without a durable store, where the
       * stream is the one and only chance to hand the report to the client —
       * no later request can read it back. Omitted otherwise, so the event
       * log stays small.
       */
      report?: Report;
    }
  | { type: 'scan_failed'; at: string; scanId: string; error: ScanError };

export type ScanEventType = ScanEvent['type'];

/** Events carry a monotonically increasing sequence number over the wire. */
export interface SequencedEvent {
  seq: number;
  event: ScanEvent;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type ScanErrorCode =
  | 'invalid_url'
  | 'repo_not_found'
  | 'repo_private'
  | 'repo_too_large'
  | 'rate_limited'
  | 'network'
  | 'ai_unavailable'
  | 'timeout'
  | 'tool_unavailable'
  | 'worker_failure'
  | 'unsupported'
  | 'internal';

export interface ScanError {
  code: ScanErrorCode;
  /** User-facing, never a stack trace. */
  message: string;
  /** Optional recovery hint, e.g. "Try again in 14 minutes". */
  hint?: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export interface CategoryScore {
  category: CategoryId;
  /** 0..100 */
  score: number;
  /** 0..1, sums to 1 across categories. */
  weight: number;
  findingCount: number;
  /** Plain-language explanation of how the number was reached. */
  rationale: string;
  /** Signals that moved the score, for the "show your work" panel. */
  deductions: { label: string; points: number }[];
}

export interface HealthScore {
  /** 0..100 — the Sentinel Software Health Score. */
  overall: number;
  categories: CategoryScore[];
  /** Copy explaining that this is Sentinel's own model, not an industry standard. */
  methodology: string;
}

/* ------------------------------------------------------------------ */
/* Roadmap                                                             */
/* ------------------------------------------------------------------ */

export interface RootCause {
  id: string;
  title: string;
  description: string;
  category: CategoryId;
  findingIds: string[];
  effortHours: [number, number];
  expectedScoreGain: number;
  severity: Severity;
}

export interface RoadmapAction {
  id: string;
  title: string;
  severity: Severity;
  rootCauseId: string;
  findingIds: string[];
  detail: string;
}

export interface RoadmapPhase {
  id: string;
  order: number;
  title: string;
  theme: CategoryId;
  summary: string;
  actions: RoadmapAction[];
  effortHours: [number, number];
  expectedScoreGain: number;
}

export interface DependencyRecommendation {
  name: string;
  ecosystem: string;
  reason: string;
  currentIssue: string;
  alternatives: string[];
  addressesFindingIds: string[];
  url?: string;
}

export interface ImprovementPlan {
  totalFindings: number;
  rootCauses: RootCause[];
  /** How many findings the listed root causes account for. */
  coveredFindings: number;
  /**
   * The smallest group of causes that accounts for most findings — the
   * "fix these few things" number the roadmap leads with.
   */
  concentration: { causes: number; findings: number };
  phases: RoadmapPhase[];
  dependencyRecommendations: DependencyRecommendation[];
  /** Projected overall score once every phase is done. */
  projectedScore: number;
}

/* ------------------------------------------------------------------ */
/* Architecture + dependencies                                         */
/* ------------------------------------------------------------------ */

export type ArchNodeKind =
  | 'client'
  | 'edge'
  | 'service'
  | 'datastore'
  | 'external'
  | 'worker'
  | 'infra';

export interface ArchNode {
  id: string;
  label: string;
  kind: ArchNodeKind;
  /** Representative files, for the detail drawer. */
  files: string[];
  findingIds: string[];
  risk: Severity | null;
  /** Layout coordinates in an abstract 0..100 space; the renderer scales them. */
  x: number;
  y: number;
  description?: string;
}

export interface ArchEdge {
  from: string;
  to: string;
  label?: string;
  /** Highlighted when the edge participates in a risky data flow. */
  risk?: Severity | null;
}

export interface ArchitectureMap {
  nodes: ArchNode[];
  edges: ArchEdge[];
  /** Detected cycles between modules, rendered as a warning. */
  cycles: string[][];
}

export type MaintenanceStatus = 'active' | 'slowing' | 'stale' | 'unknown';

export interface DependencyAdvisory {
  id: string;
  severity: Severity;
  title: string;
  fixedIn?: string;
  url?: string;
}

export interface DependencyNode {
  name: string;
  ecosystem: 'npm' | 'pypi' | 'go' | 'cargo' | 'maven' | 'rubygems' | 'other';
  version: string;
  latest?: string;
  direct: boolean;
  dev: boolean;
  license?: string;
  maintenance: MaintenanceStatus;
  advisories: DependencyAdvisory[];
  risk: Severity | null;
  /** Files that import the package, sampled. */
  usedIn: string[];
  /** Major versions behind latest, when known. */
  majorsBehind?: number;
}

export interface DependencyReport {
  manifests: string[];
  nodes: DependencyNode[];
  directCount: number;
  vulnerableCount: number;
  outdatedCount: number;
  /** True when advisory data came from a live source rather than the bundled set. */
  live: boolean;
  advisorySource: string;
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

export interface LanguageStat {
  name: string;
  files: number;
  loc: number;
  /** 0..1 */
  share: number;
}

export interface CodebaseMetrics {
  files: number;
  analyzedFiles: number;
  loc: number;
  languages: LanguageStat[];
  testFiles: number;
  /** testFiles / sourceFiles, 0..1 */
  testRatio: number;
  coverage?: number;
  /** Mean cyclomatic-ish complexity per analyzed function. */
  avgComplexity: number;
  maxComplexity: number;
  /** 0..1 share of duplicated line blocks. */
  duplication: number;
  deadCodeCount: number;
  largestFiles: { path: string; loc: number }[];
  /** Files that were skipped (binary, generated, over the size cap). */
  skippedFiles: number;
  truncated: boolean;
}

/* ------------------------------------------------------------------ */
/* Scan + report                                                       */
/* ------------------------------------------------------------------ */

export interface Scan {
  id: string;
  workspaceId: string;
  repo: RepoMeta;
  state: ScanState;
  mode: AnalysisMode;
  /** 0..1 */
  progress: number;
  statusMessage: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: ScanError;
  /** Present once the scan reaches `complete`. */
  score?: number;
  /** Public share slug when the user has opted in. */
  shareId?: string;
  agents: AgentRun[];
}

export interface ScanSummary {
  headline: string;
  detail: string;
  counts: Record<Severity, number>;
  topPriorities: { findingId: string; title: string; severity: Severity }[];
  /** Present only when nothing high-confidence was found — carefully worded. */
  caveat: string;
}

export interface Report {
  scanId: string;
  repo: RepoMeta;
  mode: AnalysisMode;
  generatedAt: string;
  durationMs: number;
  score: HealthScore;
  summary: ScanSummary;
  findings: Finding[];
  debates: Debate[];
  plan: ImprovementPlan;
  architecture: ArchitectureMap;
  dependencies: DependencyReport;
  metrics: CodebaseMetrics;
  agents: AgentRun[];
  /** Which deterministic analyzers actually ran, and which were unavailable. */
  toolchain: ToolchainStatus[];
  /**
   * Findings withheld by `.sentinelignore` or an inline comment. Reported
   * rather than hidden: a report that conceals how much it was told to ignore
   * is not an honest one.
   */
  suppressedCount: number;
}

export interface ToolchainStatus {
  name: string;
  kind: 'static' | 'secrets' | 'dependency' | 'ai' | 'ast';
  available: boolean;
  detail: string;
}

/* ------------------------------------------------------------------ */
/* Workspace / history                                                 */
/* ------------------------------------------------------------------ */

export interface TrackedRepository {
  id: string;
  workspaceId: string;
  repo: RepoMeta;
  latestScanId?: string;
  latestScore?: number;
  previousScore?: number;
  criticalCount: number;
  highCount: number;
  lastScannedAt?: string;
  scanCount: number;
}

export interface ScanHistoryPoint {
  scanId: string;
  index: number;
  score: number;
  at: string;
  criticalCount: number;
  highCount: number;
}
