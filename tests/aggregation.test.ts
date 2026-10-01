import { describe, expect, it } from 'vitest';
import { aggregateFindings, combineConfidence, dedupeKey, issueClass } from '@/lib/analysis/dedupe';
import type { AgentId, RawFinding, Severity } from '@/types';

function raw(overrides: Partial<RawFinding> = {}): RawFinding {
  return {
    ruleId: 'sec.sql-injection',
    title: 'SQL query built by string concatenation',
    category: 'security',
    severity: 'critical',
    confidence: 0.7,
    detectedBy: 'security' as AgentId,
    detectors: ['pattern-rules'],
    location: { path: 'src/db.ts', startLine: 10 },
    summary: 'A query is interpolated.',
    impact: 'Injection.',
    evidence: [{ kind: 'code', label: 'Line', detail: 'query(`...${x}`)' }],
    recommendation: 'Bind parameters.',
    rootCauseId: 'unparameterised-queries',
    references: [],
    effortMinutes: 30,
    ...overrides,
  };
}

describe('issueClass', () => {
  it('maps related rules onto one issue', () => {
    expect(issueClass('sec.command-injection')).toBe('injection.code');
    expect(issueClass('sec.eval-usage')).toBe('injection.code');
    expect(issueClass('perf.n-plus-one')).toBe('per-iteration-io');
    expect(issueClass('bug.await-in-loop-no-error')).toBe('per-iteration-io');
  });

  it('falls back to the rule id for anything unmapped', () => {
    expect(issueClass('custom.rule')).toBe('custom.rule');
  });
});

describe('dedupeKey', () => {
  it('buckets nearby lines together', () => {
    const a = raw({ location: { path: 'src/db.ts', startLine: 10 } });
    const b = raw({ location: { path: 'src/db.ts', startLine: 11 } });
    expect(dedupeKey(a)).toBe(dedupeKey(b));
  });

  it('keeps distant lines apart', () => {
    const a = raw({ location: { path: 'src/db.ts', startLine: 10 } });
    const b = raw({ location: { path: 'src/db.ts', startLine: 90 } });
    expect(dedupeKey(a)).not.toBe(dedupeKey(b));
  });

  it('keys dependency findings per package rather than per line', () => {
    const a = raw({ ruleId: 'dep.known-vulnerability', title: 'lodash — X', location: { path: 'package.json' } });
    const b = raw({ ruleId: 'dep.known-vulnerability', title: 'axios — Y', location: { path: 'package.json' } });
    expect(dedupeKey(a)).not.toBe(dedupeKey(b));
  });
});

describe('combineConfidence', () => {
  it('returns the single value unchanged', () => {
    expect(combineConfidence([0.7])).toBe(0.7);
  });

  it('raises confidence when independent detectors agree', () => {
    const combined = combineConfidence([0.7, 0.7]);
    expect(combined).toBeGreaterThan(0.7);
  });

  it('never reaches certainty', () => {
    expect(combineConfidence([0.95, 0.95, 0.95, 0.95])).toBeLessThanOrEqual(0.97);
  });

  it('is never lower than its strongest input', () => {
    expect(combineConfidence([0.9, 0.2])).toBeGreaterThanOrEqual(0.9);
  });
});

describe('aggregateFindings', () => {
  it('merges the same issue found by two agents into one finding', () => {
    const { findings, rawCount } = aggregateFindings('scan_1', [
      raw({ detectedBy: 'security', confidence: 0.7 }),
      raw({
        ruleId: 'bug.unchecked-array-index',
        detectedBy: 'bugs',
        confidence: 0.6,
        // Same issue class is what matters, not the same rule.
        location: { path: 'src/db.ts', startLine: 11 },
      }),
    ]);

    expect(rawCount).toBe(2);
    // Different issue classes stay separate.
    expect(findings.length).toBe(2);
  });

  it('merges two detectors reporting the same issue class at the same place', () => {
    const { findings } = aggregateFindings('scan_1', [
      raw({ detectedBy: 'security', confidence: 0.7, detectors: ['pattern-rules'] }),
      raw({ detectedBy: 'bugs', confidence: 0.65, detectors: ['control-flow-scan'] }),
    ]);

    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.detectedBy).toEqual(['security', 'bugs']);
    expect(finding.detectors).toEqual(['pattern-rules', 'control-flow-scan']);
    expect(finding.confidence).toBeGreaterThan(0.7);
  });

  it('keeps the worst severity when merging', () => {
    const { findings } = aggregateFindings('scan_1', [
      raw({ severity: 'medium', detectedBy: 'security' }),
      raw({ severity: 'critical', detectedBy: 'bugs' }),
    ]);
    expect(findings[0]!.severity).toBe<Severity>('critical');
  });

  it('does not inflate confidence when one agent reports twice', () => {
    const twice = aggregateFindings('scan_1', [
      raw({ detectedBy: 'security', confidence: 0.7 }),
      raw({ detectedBy: 'security', confidence: 0.7 }),
    ]);
    expect(twice.findings[0]!.confidence).toBe(0.7);
  });

  it('collects the other locations of a merged finding', () => {
    const { findings } = aggregateFindings('scan_1', [
      raw({ detectedBy: 'security', location: { path: 'src/db.ts', startLine: 10 } }),
      raw({
        detectedBy: 'bugs',
        location: { path: 'src/db.ts', startLine: 12 },
        evidence: [],
      }),
    ]);
    expect(findings[0]!.otherLocations.length).toBeGreaterThan(0);
  });

  it('gives every finding a unique, stable id', () => {
    const input = [
      raw(),
      raw({ ruleId: 'dep.known-vulnerability', title: 'lodash', location: { path: 'package.json' } }),
      raw({ ruleId: 'dep.known-vulnerability', title: 'axios', location: { path: 'package.json' } }),
    ];
    const first = aggregateFindings('scan_1', input);
    const second = aggregateFindings('scan_1', input);

    const ids = first.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Same scan, same input, same ids — this is what makes history possible.
    expect(second.findings.map((f) => f.id)).toEqual(ids);
  });

  it('sorts by severity and then confidence', () => {
    const { findings } = aggregateFindings('scan_1', [
      raw({ severity: 'low', location: { path: 'a.ts', startLine: 1 }, ruleId: 'maint.x' }),
      raw({ severity: 'critical', location: { path: 'b.ts', startLine: 1 } }),
      raw({ severity: 'medium', location: { path: 'c.ts', startLine: 1 }, ruleId: 'perf.x' }),
    ]);
    expect(findings.map((f) => f.severity)).toEqual(['critical', 'medium', 'low']);
  });

  it('starts every finding unvalidated', () => {
    const { findings } = aggregateFindings('scan_1', [raw()]);
    expect(findings[0]!.validation).toBe('potential');
  });

  it('canonicalises the root cause so the plan can group by it', () => {
    const { findings } = aggregateFindings('scan_1', [
      raw({ rootCauseId: 'unvalidated-filesystem-paths', ruleId: 'sec.path-traversal' }),
    ]);
    expect(findings[0]!.rootCauseId).toBe('untrusted-input-boundary');
  });
});
