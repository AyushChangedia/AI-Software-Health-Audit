import { describe, expect, it } from 'vitest';
import { runScan } from '@/agents/orchestrator';
import { getStore } from '@/lib/db';
import { FIXTURE_SECRETS } from '@/lib/demo/fixture-secrets';
import { DEMO_REPO } from '@/lib/demo';
import { newId } from '@/lib/id';
import { dedupeKey } from '@/lib/analysis/dedupe';
import type { Scan } from '@/types';

function queuedScan(): Scan {
  return {
    id: newId('scn'),
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

describe('end-to-end scan', () => {
  it('produces a complete report for the demo repository', async () => {
    const store = getStore();
    const scan = await store.createScan(queuedScan());

    await runScan(scan.id);

    const finished = await store.getScan(scan.id);
    expect(finished?.state).toBe('complete');
    expect(finished?.score).toBeGreaterThan(0);
    expect(finished?.score).toBeLessThanOrEqual(100);

    const report = await store.getReport(scan.id);
    expect(report).not.toBeNull();
    if (!report) return;

    // Findings
    expect(report.findings.length).toBeGreaterThan(10);
    expect(report.findings.every((f) => f.location.path.length > 0)).toBe(true);
    expect(report.findings.every((f) => f.evidence.length > 0)).toBe(true);
    expect(report.findings.every((f) => f.confidence > 0 && f.confidence <= 1)).toBe(true);
    expect(report.findings.every((f) => f.validatedBy === 'validator')).toBe(true);

    // Deduplication: identifiers are unique, and no two findings describe the
    // same issue class at the same place.
    const ids = report.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = report.findings.map(dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);

    // Multiple agents contributed.
    const agents = new Set(report.findings.flatMap((f) => f.detectedBy));
    expect(agents.size).toBeGreaterThanOrEqual(4);

    // Score
    expect(report.score.categories.length).toBe(8);
    const weightSum = report.score.categories.reduce((s, c) => s + c.weight, 0);
    expect(weightSum).toBeCloseTo(1, 5);

    // Plan
    expect(report.plan.rootCauses.length).toBeGreaterThan(2);
    expect(report.plan.phases.length).toBeGreaterThan(1);
    expect(report.plan.coveredFindings).toBeGreaterThan(0);
    expect(report.plan.projectedScore).toBeGreaterThanOrEqual(report.score.overall);

    // Architecture + dependencies
    expect(report.architecture.nodes.length).toBeGreaterThan(2);
    expect(report.dependencies.nodes.length).toBeGreaterThan(5);

    // Every event was recorded for replay.
    const events = await store.getEvents(scan.id);
    expect(events.length).toBeGreaterThan(20);
    expect(events.at(-1)?.event.type).toBe('scan_complete');
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));

    // Nothing leaks a real-looking credential.
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain(FIXTURE_SECRETS.databaseUrl);
    expect(serialised).not.toContain(FIXTURE_SECRETS.stripeLiveKey);
  }, 60_000);
});
