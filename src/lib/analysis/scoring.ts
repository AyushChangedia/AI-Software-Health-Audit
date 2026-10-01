import type {
  CategoryId,
  CategoryScore,
  CodebaseMetrics,
  Finding,
  HealthScore,
  Severity,
  ValidationStatus,
} from '@/types';
import { CATEGORY_META, DEFAULT_WEIGHTS, METHODOLOGY_COPY, SEVERITY_META } from '@/lib/constants';

/**
 * The Sentinel Software Health Score.
 *
 * Design goals, in order:
 *   1. Explainable — every point lost is attributable to something on screen.
 *   2. Honest about confidence — an unproven finding costs less than a proven one.
 *   3. Resistant to volume — fifty low-severity nits must not read as worse than
 *      one authentication bypass.
 *
 * It is our model, not an industry standard, and the UI says so.
 */

/** How much a finding counts, by how sure we are it is real. */
const VALIDATION_MULTIPLIER: Record<ValidationStatus, number> = {
  confirmed: 1,
  likely: 0.75,
  potential: 0.45,
  dismissed: 0,
};

/**
 * Above this many deduction points, additional findings have square-root
 * effect. Without this, any large codebase floors at zero and the score stops
 * distinguishing between "bad" and "catastrophic".
 */
const LINEAR_BUDGET = 40;

/**
 * The most a whole severity tier can ever remove.
 *
 * Volume of nits is a different problem from one exploitable flaw, and the
 * score has to say so: without a per-tier ceiling, fifty low-severity findings
 * out-score a single authentication bypass purely by arithmetic. Critical and
 * high are uncapped — there is no number of authentication bypasses that
 * should stop mattering.
 */
const TIER_CEILING: Partial<Record<Severity, number>> = {
  medium: 40,
  low: 18,
  info: 5,
};

export function dampDeduction(raw: number): number {
  if (raw <= LINEAR_BUDGET) return raw;
  return LINEAR_BUDGET + Math.sqrt(raw - LINEAR_BUDGET) * 5;
}

export function findingDeduction(finding: Finding): number {
  const base = SEVERITY_META[finding.severity].weight;
  return base * finding.confidence * VALIDATION_MULTIPLIER[finding.validation];
}

export interface ScoringInput {
  findings: Finding[];
  metrics: CodebaseMetrics;
  weights?: Partial<Record<CategoryId, number>>;
}

/**
 * Signals that are not findings but still describe category health — a project
 * with no tests should not score 100 on Testing just because nothing matched.
 */
function structuralDeductions(
  category: CategoryId,
  metrics: CodebaseMetrics,
): { label: string; points: number }[] {
  const out: { label: string; points: number }[] = [];

  if (category === 'testing') {
    if (metrics.testFiles === 0) {
      out.push({ label: 'No test files found', points: 45 });
    } else if (metrics.testRatio < 0.3) {
      const points = Math.round((0.3 - metrics.testRatio) * 80);
      out.push({ label: `Test-to-source ratio ${(metrics.testRatio * 100).toFixed(0)}%`, points });
    }
    if (metrics.coverage !== undefined && metrics.coverage < 0.6) {
      out.push({
        label: `Reported line coverage ${(metrics.coverage * 100).toFixed(0)}%`,
        points: Math.round((0.6 - metrics.coverage) * 40),
      });
    }
  }

  if (category === 'maintainability') {
    if (metrics.duplication > 0.05) {
      out.push({
        label: `${(metrics.duplication * 100).toFixed(1)}% duplicated lines`,
        points: Math.round(Math.min(20, metrics.duplication * 150)),
      });
    }
    if (metrics.avgComplexity > 8) {
      out.push({
        label: `Mean function complexity ${metrics.avgComplexity}`,
        points: Math.round(Math.min(15, (metrics.avgComplexity - 8) * 3)),
      });
    }
  }

  if (category === 'ai-code' && metrics.deadCodeCount > 10) {
    out.push({
      label: `${metrics.deadCodeCount} unused exports`,
      points: Math.min(15, Math.round(metrics.deadCodeCount / 4)),
    });
  }

  return out;
}

export function scoreCategory(
  category: CategoryId,
  findings: Finding[],
  metrics: CodebaseMetrics,
  weight: number,
): CategoryScore {
  const relevant = findings.filter((f) => f.category === category);

  const live = relevant.filter((f) => f.validation !== 'dismissed');

  const findingDeductions = live
    .map((f) => ({
      severity: f.severity,
      label: `${SEVERITY_META[f.severity].label}: ${f.title}`,
      points: Number(findingDeduction(f).toFixed(1)),
    }))
    .sort((a, b) => b.points - a.points);

  // Sum within each severity tier, then apply that tier's ceiling.
  const byTier = new Map<Severity, number>();
  for (const deduction of findingDeductions) {
    byTier.set(deduction.severity, (byTier.get(deduction.severity) ?? 0) + deduction.points);
  }
  const findingTotal = [...byTier.entries()].reduce((sum, [severity, points]) => {
    const ceiling = TIER_CEILING[severity];
    return sum + (ceiling === undefined ? points : Math.min(ceiling, points));
  }, 0);

  const structural = structuralDeductions(category, metrics);
  const rawTotal = findingTotal + structural.reduce((sum, d) => sum + d.points, 0);

  const score = Math.max(0, Math.min(100, Math.round(100 - dampDeduction(rawTotal))));

  const confirmed = relevant.filter((f) => f.validation === 'confirmed').length;
  const dismissed = relevant.filter((f) => f.validation === 'dismissed').length;

  const rationale =
    relevant.length === 0 && structural.length === 0
      ? `No ${CATEGORY_META[category].label.toLowerCase()} findings were raised by this analysis.`
      : [
          `${relevant.length} ${relevant.length === 1 ? 'finding' : 'findings'}`,
          confirmed > 0 ? `${confirmed} confirmed` : null,
          dismissed > 0 ? `${dismissed} dismissed` : null,
          structural.length > 0 ? `${structural.length} structural signals` : null,
          `${rawTotal.toFixed(0)} raw deduction points, damped to ${dampDeduction(rawTotal).toFixed(0)}`,
        ]
          .filter(Boolean)
          .join(' · ');

  return {
    category,
    score,
    weight,
    findingCount: relevant.length,
    rationale,
    deductions: [
      ...structural,
      ...findingDeductions.map(({ label, points }) => ({ label, points })),
    ].slice(0, 8),
  };
}

export function computeHealthScore({ findings, metrics, weights }: ScoringInput): HealthScore {
  const resolved: Record<CategoryId, number> = { ...DEFAULT_WEIGHTS, ...weights };

  // Normalise so the weights always sum to 1, whatever the operator configured.
  const total = Object.values(resolved).reduce((sum, w) => sum + w, 0) || 1;
  const categories = (Object.keys(CATEGORY_META) as CategoryId[]).map((category) =>
    scoreCategory(category, findings, metrics, resolved[category] / total),
  );

  const overall = Math.round(
    categories.reduce((sum, category) => sum + category.score * category.weight, 0),
  );

  return {
    overall: Math.max(0, Math.min(100, overall)),
    categories: categories.sort((a, b) => b.weight - a.weight),
    methodology: METHODOLOGY_COPY,
  };
}

/**
 * What the score would be if the given findings were resolved.
 * Used by the roadmap to put a real number on "expected improvement".
 */
export function projectScore(
  findings: Finding[],
  metrics: CodebaseMetrics,
  resolvedIds: Set<string>,
  weights?: Partial<Record<CategoryId, number>>,
): number {
  const remaining = findings.filter((f) => !resolvedIds.has(f.id));

  // Resolving testing findings implies the structural gap closed too.
  const adjusted: CodebaseMetrics = { ...metrics };
  const resolvedTesting = findings.some(
    (f) => resolvedIds.has(f.id) && f.category === 'testing',
  );
  if (resolvedTesting) {
    adjusted.testRatio = Math.max(adjusted.testRatio, 0.3);
    adjusted.testFiles = Math.max(adjusted.testFiles, 1);
  }
  const resolvedMaint = findings.some(
    (f) => resolvedIds.has(f.id) && (f.category === 'maintainability' || f.category === 'ai-code'),
  );
  if (resolvedMaint) {
    adjusted.duplication = Math.min(adjusted.duplication, 0.03);
    adjusted.deadCodeCount = Math.min(adjusted.deadCodeCount, 5);
  }

  return computeHealthScore({ findings: remaining, metrics: adjusted, ...(weights ? { weights } : {}) })
    .overall;
}
