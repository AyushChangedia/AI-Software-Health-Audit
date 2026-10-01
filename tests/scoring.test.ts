import { describe, expect, it } from 'vitest';
import {
  computeHealthScore,
  dampDeduction,
  findingDeduction,
  projectScore,
  scoreCategory,
} from '@/lib/analysis/scoring';
import { buildImprovementPlan } from '@/lib/analysis/roadmap';
import { buildDemoIndex } from '@/lib/demo';
import type { CodebaseMetrics, Finding, Severity, ValidationStatus } from '@/types';

function metrics(overrides: Partial<CodebaseMetrics> = {}): CodebaseMetrics {
  return {
    files: 100,
    analyzedFiles: 100,
    loc: 5_000,
    languages: [],
    testFiles: 30,
    testRatio: 0.35,
    avgComplexity: 5,
    maxComplexity: 12,
    duplication: 0.01,
    deadCodeCount: 0,
    largestFiles: [],
    skippedFiles: 0,
    truncated: false,
    ...overrides,
  };
}

let counter = 0;
function finding(
  severity: Severity,
  validation: ValidationStatus = 'confirmed',
  confidence = 1,
  category: Finding['category'] = 'security',
): Finding {
  counter += 1;
  return {
    id: `fnd_${counter}`,
    scanId: 'scan_1',
    ruleId: 'sec.test',
    title: `Finding ${counter}`,
    category,
    severity,
    confidence,
    validation,
    location: { path: 'src/a.ts', startLine: 1 },
    otherLocations: [],
    detectedBy: ['security'],
    detectors: ['pattern-rules'],
    summary: 'summary',
    impact: 'impact',
    evidence: [],
    recommendation: 'fix it',
    rootCauseId: 'unparameterised-queries',
    references: [],
    effortMinutes: 30,
    createdAt: new Date().toISOString(),
  };
}

describe('findingDeduction', () => {
  it('scales with severity', () => {
    expect(findingDeduction(finding('critical'))).toBeGreaterThan(
      findingDeduction(finding('high')),
    );
    expect(findingDeduction(finding('low'))).toBeGreaterThan(findingDeduction(finding('info')));
  });

  it('scales with confidence', () => {
    expect(findingDeduction(finding('high', 'confirmed', 0.5))).toBeCloseTo(
      findingDeduction(finding('high', 'confirmed', 1)) / 2,
      5,
    );
  });

  it('costs nothing once dismissed', () => {
    expect(findingDeduction(finding('critical', 'dismissed'))).toBe(0);
  });

  it('costs less when the validator is unsure', () => {
    expect(findingDeduction(finding('high', 'potential'))).toBeLessThan(
      findingDeduction(finding('high', 'confirmed')),
    );
  });
});

describe('dampDeduction', () => {
  it('is linear below the budget', () => {
    expect(dampDeduction(10)).toBe(10);
    expect(dampDeduction(40)).toBe(40);
  });

  it('compresses above the budget', () => {
    expect(dampDeduction(200)).toBeLessThan(200);
    // Still monotonic — worse must never score better.
    expect(dampDeduction(400)).toBeGreaterThan(dampDeduction(200));
  });
});

describe('scoreCategory', () => {
  it('is 100 when nothing was found', () => {
    const score = scoreCategory('security', [], metrics(), 0.25);
    expect(score.score).toBe(100);
    expect(score.rationale).toContain('No security findings');
  });

  it('penalises a missing test suite even with no findings', () => {
    const score = scoreCategory('testing', [], metrics({ testFiles: 0, testRatio: 0 }), 0.1);
    expect(score.score).toBeLessThan(60);
    expect(score.deductions.some((d) => d.label.includes('No test files'))).toBe(true);
  });

  it('does not let fifty low findings outweigh one critical', () => {
    const manyLow = Array.from({ length: 50 }, () => finding('low'));
    const oneCritical = [finding('critical')];
    const low = scoreCategory('security', manyLow, metrics(), 0.25).score;
    const critical = scoreCategory('security', oneCritical, metrics(), 0.25).score;
    expect(critical).toBeLessThan(low);
  });

  it('lists what it deducted for', () => {
    const score = scoreCategory('security', [finding('critical')], metrics(), 0.25);
    expect(score.deductions.length).toBeGreaterThan(0);
    expect(score.deductions[0]!.points).toBeGreaterThan(0);
  });
});

describe('computeHealthScore', () => {
  it('returns a weighted average across all eight categories', () => {
    const score = computeHealthScore({ findings: [], metrics: metrics() });
    expect(score.categories).toHaveLength(8);
    expect(score.categories.reduce((sum, c) => sum + c.weight, 0)).toBeCloseTo(1, 6);
    expect(score.overall).toBeGreaterThan(90);
  });

  it('normalises custom weights', () => {
    const score = computeHealthScore({
      findings: [],
      metrics: metrics(),
      weights: { security: 10, reliability: 10 },
    });
    expect(score.categories.reduce((sum, c) => sum + c.weight, 0)).toBeCloseTo(1, 6);
  });

  it('stays within bounds under heavy load', () => {
    const findings = Array.from({ length: 300 }, () => finding('critical'));
    const score = computeHealthScore({ findings, metrics: metrics() });
    expect(score.overall).toBeGreaterThanOrEqual(0);
    expect(score.overall).toBeLessThanOrEqual(100);
  });

  it('says out loud that it is not an industry standard', () => {
    const score = computeHealthScore({ findings: [], metrics: metrics() });
    expect(score.methodology).toMatch(/not an industry standard/i);
  });
});

describe('projectScore', () => {
  it('never returns less than the current score when resolving findings', () => {
    const findings = [finding('critical'), finding('high'), finding('medium')];
    const now = computeHealthScore({ findings, metrics: metrics() }).overall;
    const after = projectScore(findings, metrics(), new Set(findings.map((f) => f.id)));
    expect(after).toBeGreaterThanOrEqual(now);
  });

  it('treats resolving a testing finding as closing the structural gap', () => {
    const testing = finding('high', 'confirmed', 1, 'testing');
    const bare = metrics({ testFiles: 0, testRatio: 0 });
    const before = computeHealthScore({ findings: [testing], metrics: bare }).overall;
    const after = projectScore([testing], bare, new Set([testing.id]));
    expect(after).toBeGreaterThan(before + 2);
  });
});

describe('improvement plan', () => {
  it('scores a phase as one change rather than the sum of its parts', () => {
    const findings = Array.from({ length: 8 }, () => finding('critical'));
    const index = buildDemoIndex();
    const plan = buildImprovementPlan(findings, metrics(), index, {
      manifests: [],
      nodes: [],
      directCount: 0,
      vulnerableCount: 0,
      outdatedCount: 0,
      live: false,
      advisorySource: 'test',
    });

    const security = plan.phases.find((p) => p.theme === 'security');
    expect(security).toBeDefined();
    const sumOfCauses = plan.rootCauses
      .filter((c) => c.category === 'security')
      .reduce((sum, c) => sum + c.expectedScoreGain, 0);

    // Damping means doing them together is worth much more than doing them
    // one at a time; this is the bug the joint calculation fixes.
    expect(security!.expectedScoreGain).toBeGreaterThanOrEqual(sumOfCauses);
  });

  it('reports how concentrated the findings are', () => {
    const findings = [
      ...Array.from({ length: 6 }, () => finding('high')),
      finding('low', 'confirmed', 1, 'maintainability'),
    ];
    const plan = buildImprovementPlan(findings, metrics(), buildDemoIndex(), {
      manifests: [],
      nodes: [],
      directCount: 0,
      vulnerableCount: 0,
      outdatedCount: 0,
      live: false,
      advisorySource: 'test',
    });
    expect(plan.concentration.causes).toBeGreaterThan(0);
    expect(plan.concentration.findings).toBeGreaterThanOrEqual(
      Math.ceil(plan.totalFindings * 0.6),
    );
  });

  it('excludes dismissed findings from the plan', () => {
    const findings = [finding('critical', 'dismissed')];
    const plan = buildImprovementPlan(findings, metrics(), buildDemoIndex(), {
      manifests: [],
      nodes: [],
      directCount: 0,
      vulnerableCount: 0,
      outdatedCount: 0,
      live: false,
      advisorySource: 'test',
    });
    expect(plan.totalFindings).toBe(0);
    expect(plan.rootCauses).toHaveLength(0);
  });
});
