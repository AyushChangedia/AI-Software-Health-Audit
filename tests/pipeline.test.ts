import { describe, expect, it } from 'vitest';
import { FIXTURE_SECRETS } from '@/lib/demo/fixture-secrets';
import { buildDemoIndex, DEMO_SLUG } from '@/lib/demo';
import { buildModuleGraph } from '@/lib/analysis/graph';
import { analyzeStructure } from '@/lib/analysis/metrics';
import { analyzeDependencies } from '@/lib/security/dependencies';
import { createRedactor, scanForSecrets } from '@/lib/security/secrets';
import { runPatternRules } from '@/lib/analysis/rule-engine';
import { SECURITY_RULES } from '@/lib/analysis/rules/security';

describe('demo repository analysis', () => {
  const index = buildDemoIndex();

  it('indexes the bundled repository', () => {
    expect(index.repo.slug).toBe(DEMO_SLUG);
    expect(index.files.length).toBeGreaterThan(20);
    expect(index.loc).toBeGreaterThan(300);
    expect(index.languages[0]?.name).toBe('TypeScript');
  });

  it('finds the committed credentials', () => {
    const { findings } = scanForSecrets(index);
    const rules = findings.map((f) => f.ruleId);
    expect(rules).toContain('sec.secret.env-committed');
    expect(rules.some((r) => r.includes('stripe') || r.includes('connection-string'))).toBe(true);
    // Secret values must never survive the report-wide redaction pass —
    // including when they appear in a *neighbouring* finding's snippet.
    const { secrets } = scanForSecrets(index);
    const redact = createRedactor(secrets);
    const rendered = redact(JSON.stringify(findings));
    expect(rendered).not.toContain(FIXTURE_SECRETS.databaseUrl);
    expect(rendered).not.toContain(FIXTURE_SECRETS.stripeLiveKey);
  });

  it('detects SQL injection in the auth router', () => {
    const { findings } = runPatternRules(index, SECURITY_RULES);
    const sqli = findings.filter((f) => f.ruleId === 'sec.sql-injection');
    expect(sqli.length).toBeGreaterThan(0);
    expect(sqli.some((f) => f.location.path.includes('auth'))).toBe(true);
  });

  it('detects the circular dependency between orders and inventory', () => {
    const graph = buildModuleGraph(index);
    const flat = graph.cycles.flat().join(' ');
    expect(graph.cycles.length).toBeGreaterThan(0);
    expect(flat).toContain('services/orders.ts');
    expect(flat).toContain('services/inventory.ts');
  });

  it('detects the unresolved legacy import', () => {
    const graph = buildModuleGraph(index);
    expect(graph.dangling.some((d) => d.specifier.includes('report-helpers'))).toBe(true);
  });

  it('measures structure', () => {
    const graph = buildModuleGraph(index);
    const structure = analyzeStructure(index, graph.unusedExports.length);
    expect(structure.metrics.files).toBeGreaterThan(20);
    expect(structure.functions.length).toBeGreaterThan(10);
    expect(structure.metrics.testFiles).toBe(0);
  });

  it('flags vulnerable dependencies offline', async () => {
    const { report, findings } = await analyzeDependencies(index, { allowNetwork: false });
    expect(report.manifests).toContain('package.json');
    expect(report.nodes.length).toBeGreaterThan(5);
    const vulnerable = findings.filter((f) => f.ruleId === 'dep.known-vulnerability');
    expect(vulnerable.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.ruleId === 'dep.missing-lockfile')).toBe(true);
  });
});
