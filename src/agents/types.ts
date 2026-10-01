import type { AgentId, RawFinding } from '@/types';
import type { AIProvider } from '@/lib/ai';
import type { RepoIndex } from '@/lib/analysis/repo-index';
import type { ModuleGraph } from '@/lib/analysis/graph';
import type { StructuralAnalysis } from '@/lib/analysis/metrics';
import type { DependencyAnalysis } from '@/lib/security/dependencies';
import type { SecretScanResult } from '@/lib/security/secrets';

/**
 * What an agent can tell the outside world while it works.
 *
 * Every message here is derived from something the agent actually did — a file
 * count, a rule that matched, a graph it walked. There is no decorative
 * narration: if the UI shows "tracing 14 request handlers", the agent found 14.
 */
export interface AgentEmitter {
  /** Current activity, optionally with progress (0..1) and a file counter. */
  activity(message: string, progress?: number, filesScanned?: number): void;
  /** Appends a line to the live console. */
  log(message: string): void;
  /** Publishes a finding the moment it is discovered. */
  finding(finding: RawFinding): void;
}

export interface AgentContext {
  scanId: string;
  index: RepoIndex;
  graph: ModuleGraph;
  structure: StructuralAnalysis;
  dependencies: DependencyAnalysis;
  /** Computed once in the indexing phase and shared with the redactor. */
  secrets: SecretScanResult;
  ai: AIProvider;
  /**
   * Presentation pacing, in milliseconds.
   *
   * Analysis of a small repository finishes in well under a second, which makes
   * the live agent view unreadable — findings appear and vanish before anyone
   * can follow them. Agents yield for this long at natural phase boundaries so
   * the stream is legible. It slows the *display* of real work; it never
   * invents work. Set `SCAN_PACE_MS=0` to turn it off.
   */
  pace: number;
  emit: AgentEmitter;
  /** Aborted when the scan exceeds its time budget. */
  signal: AbortSignal;
}

export interface AgentResult {
  findings: RawFinding[];
  filesScanned: number;
  /** Short notes surfaced in the agent card once it completes. */
  notes: string[];
}

export interface Agent {
  readonly id: AgentId;
  run(ctx: AgentContext): Promise<AgentResult>;
}

/** Throws if the scan budget has been exhausted. Call between phases. */
export function checkAborted(signal: AbortSignal) {
  if (signal.aborted) throw new AgentAborted();
}

export class AgentAborted extends Error {
  constructor() {
    super('Analysis budget exhausted');
    this.name = 'AgentAborted';
  }
}

/**
 * Yields to the event loop so buffered updates flush, optionally holding for
 * `ms` so the live view stays readable. See `AgentContext.pace`.
 */
export async function breathe(ms = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
