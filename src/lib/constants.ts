import type { AgentId, CategoryId, Severity, ValidationStatus } from '@/types';

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

export interface AgentMeta {
  id: AgentId;
  name: string;
  emoji: string;
  /** One-line description used on the landing page and agent cards. */
  role: string;
  category: CategoryId | null;
  /** Tailwind-friendly accent token, resolved in `globals.css`. */
  accent: string;
}

export const AGENTS: Record<AgentId, AgentMeta> = {
  orchestrator: {
    id: 'orchestrator',
    name: 'Orchestrator',
    emoji: '🧠',
    role: 'Plans the audit, assigns work and resolves conflicts between agents.',
    category: null,
    accent: 'violet',
  },
  security: {
    id: 'security',
    name: 'Security Agent',
    emoji: '🔐',
    role: 'Hunts injection, authentication, authorization and secret-handling flaws.',
    category: 'security',
    accent: 'red',
  },
  bugs: {
    id: 'bugs',
    name: 'Bug Hunter',
    emoji: '🐛',
    role: 'Finds crashes, unhandled states and incorrect error handling.',
    category: 'reliability',
    accent: 'amber',
  },
  architecture: {
    id: 'architecture',
    name: 'Architecture Agent',
    emoji: '🏗️',
    role: 'Maps service boundaries, coupling and circular dependencies.',
    category: 'architecture',
    accent: 'sky',
  },
  testing: {
    id: 'testing',
    name: 'Testing Agent',
    emoji: '🧪',
    role: 'Measures coverage of the paths that actually matter.',
    category: 'testing',
    accent: 'emerald',
  },
  dependencies: {
    id: 'dependencies',
    name: 'Dependency Agent',
    emoji: '📦',
    role: 'Correlates manifests with advisories, licences and maintenance signals.',
    category: 'dependencies',
    accent: 'orange',
  },
  performance: {
    id: 'performance',
    name: 'Performance Agent',
    emoji: '⚡',
    role: 'Looks for N+1 queries, blocking work and accidental O(n²).',
    category: 'performance',
    accent: 'yellow',
  },
  'ai-code': {
    id: 'ai-code',
    name: 'AI Code Agent',
    emoji: '🤖',
    role: 'Flags patterns common in fast AI-assisted development.',
    category: 'ai-code',
    accent: 'fuchsia',
  },
  maintainability: {
    id: 'maintainability',
    name: 'Maintainability Agent',
    emoji: '🧹',
    role: 'Tracks complexity, duplication and dead code.',
    category: 'maintainability',
    accent: 'teal',
  },
  validator: {
    id: 'validator',
    name: 'Validator',
    emoji: '🔬',
    role: 'Challenges every claim and refuses to pass unproven findings.',
    category: null,
    accent: 'cyan',
  },
};

/** Agents that produce findings, in the order they are deployed. */
export const WORKER_AGENT_IDS = [
  'security',
  'bugs',
  'architecture',
  'testing',
  'dependencies',
  'performance',
  'ai-code',
  'maintainability',
] as const;

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  emoji: string;
  description: string;
  /** Share of the overall health score. Overridable via env. */
  weight: number;
}

export const CATEGORY_META: Record<CategoryId, CategoryMeta> = {
  security: {
    id: 'security',
    label: 'Security',
    emoji: '🔐',
    description: 'Exploitable weaknesses, secret exposure and missing access control.',
    weight: 0.25,
  },
  reliability: {
    id: 'reliability',
    label: 'Reliability',
    emoji: '🐛',
    description: 'Crashes, unhandled failure modes and silent data loss.',
    weight: 0.15,
  },
  architecture: {
    id: 'architecture',
    label: 'Architecture',
    emoji: '🏗️',
    description: 'Boundaries, coupling and the cost of changing the system.',
    weight: 0.15,
  },
  testing: {
    id: 'testing',
    label: 'Testing',
    emoji: '🧪',
    description: 'Whether the paths that matter are actually covered.',
    weight: 0.1,
  },
  dependencies: {
    id: 'dependencies',
    label: 'Dependencies',
    emoji: '📦',
    description: 'Known advisories, abandoned packages and licence risk.',
    weight: 0.1,
  },
  performance: {
    id: 'performance',
    label: 'Performance',
    emoji: '⚡',
    description: 'Work done per request and how it scales with data.',
    weight: 0.1,
  },
  maintainability: {
    id: 'maintainability',
    label: 'Maintainability',
    emoji: '🧹',
    description: 'Complexity, duplication and dead weight.',
    weight: 0.1,
  },
  'ai-code': {
    id: 'ai-code',
    label: 'AI Code Quality',
    emoji: '🤖',
    description: 'Patterns that correlate with fast AI-assisted development.',
    weight: 0.05,
  },
};

/** Default weights, exported separately so the scoring engine can be re-weighted. */
export const DEFAULT_WEIGHTS: Record<CategoryId, number> = Object.fromEntries(
  (Object.keys(CATEGORY_META) as CategoryId[]).map((id) => [id, CATEGORY_META[id].weight]),
) as Record<CategoryId, number>;

/* ------------------------------------------------------------------ */
/* Severity + validation                                               */
/* ------------------------------------------------------------------ */

export interface SeverityMeta {
  id: Severity;
  label: string;
  /** Base points removed from a category score, before confidence weighting. */
  weight: number;
  dot: string;
}

export const SEVERITY_META: Record<Severity, SeverityMeta> = {
  critical: { id: 'critical', label: 'Critical', weight: 30, dot: '🔴' },
  high: { id: 'high', label: 'High', weight: 14, dot: '🟠' },
  medium: { id: 'medium', label: 'Medium', weight: 5, dot: '🟡' },
  low: { id: 'low', label: 'Low', weight: 1.5, dot: '🔵' },
  info: { id: 'info', label: 'Info', weight: 0.3, dot: '⚪' },
};

/** Severities in reporting order, worst first. */
export const SEVERITIES_ORDERED: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const VALIDATION_META: Record<
  ValidationStatus,
  { label: string; dot: string; description: string }
> = {
  confirmed: {
    label: 'Confirmed',
    dot: '🟢',
    description: 'Reproduced against the source. Evidence is direct.',
  },
  likely: {
    label: 'Likely',
    dot: '🟡',
    description: 'Strong signal, one assumption could not be proven statically.',
  },
  potential: {
    label: 'Potential',
    dot: '🔵',
    description: 'Pattern matched, but reachability was not established.',
  },
  dismissed: {
    label: 'Dismissed',
    dot: '⚪',
    description: 'A mitigating control was found. Kept for transparency.',
  },
};

/* ------------------------------------------------------------------ */
/* Product copy                                                        */
/* ------------------------------------------------------------------ */

export const PRODUCT = {
  name: 'Sentinel',
  tagline: 'Your AI engineering team for every codebase.',
  subTagline: 'Find what your software cannot see.',
  scoreName: 'Sentinel Software Health Score',
} as const;

/**
 * Deliberately hedged language. Sentinel never claims a codebase is safe.
 */
export const NO_FINDINGS_COPY =
  'No high-confidence vulnerabilities were identified by the current analysis. This is not proof that none exist.';

export const METHODOLOGY_COPY =
  'The Sentinel Software Health Score is our own weighted model, not an industry standard. ' +
  'Each category starts at 100 and loses points for findings, weighted by severity and by how ' +
  'confident the validator was. Weights are configurable.';
