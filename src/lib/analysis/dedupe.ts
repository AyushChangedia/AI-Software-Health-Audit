import type { AgentId, CodeLocation, Evidence, Finding, RawFinding, Severity } from '@/types';
import { SEVERITY_ORDER } from '@/lib/constants';
import { stableId } from '@/lib/id';
import { canonicalRootCause } from './root-causes';

/**
 * Finding aggregation.
 *
 * Several agents legitimately notice the same defect from different angles —
 * the Security agent sees an injection sink, the Bug Hunter sees an unvalidated
 * value, the Performance agent sees the same loop. Showing that as three
 * findings makes the report look padded and makes the real count meaningless.
 *
 * Findings are merged when they describe the same *issue class* at the same
 * place. Corroboration then raises confidence rather than the count.
 */

/**
 * Maps a rule id to the underlying issue. Rules that share a class and a
 * location are the same finding.
 */
const ISSUE_CLASS: { pattern: RegExp; issue: string }[] = [
  { pattern: /^sec\.secret\./, issue: 'exposed-credential' },
  { pattern: /^sec\.sql-injection/, issue: 'injection.sql' },
  { pattern: /^sec\.command-injection|^sec\.eval-usage/, issue: 'injection.code' },
  { pattern: /^sec\.xss/, issue: 'injection.xss' },
  { pattern: /^sec\.ssrf/, issue: 'ssrf' },
  { pattern: /^sec\.path-traversal/, issue: 'path-traversal' },
  { pattern: /^sec\.jwt|^sec\.auth/, issue: 'auth-verification' },
  { pattern: /^sec\.(cors|insecure-cookie|debug-enabled|tls)/, issue: 'insecure-configuration' },
  { pattern: /^sec\.(mass-assignment|unvalidated-input)/, issue: 'input-validation' },
  { pattern: /^dep\./, issue: 'dependency' },
  { pattern: /^perf\.n-plus-one|^bug\.await-in-loop/, issue: 'per-iteration-io' },
  { pattern: /^perf\./, issue: 'performance' },
  { pattern: /duplicat|repeated-implementation/, issue: 'duplication' },
  { pattern: /unused-export|dead-code/, issue: 'dead-code' },
  { pattern: /^bug\.(empty-catch|bare-except)/, issue: 'swallowed-error' },
  { pattern: /^bug\./, issue: 'reliability' },
  { pattern: /^arch\./, issue: 'architecture' },
  { pattern: /^test\./, issue: 'testing' },
  { pattern: /^maint\.|^ai\./, issue: 'maintainability' },
];

export function issueClass(ruleId: string): string {
  for (const entry of ISSUE_CLASS) {
    if (entry.pattern.test(ruleId)) return entry.issue;
  }
  return ruleId;
}

/**
 * Findings within five lines of each other are treated as the same site. Two
 * detectors rarely land on the exact same line for the same problem.
 */
function locationKey(location: CodeLocation): string {
  const bucket = location.startLine ? Math.floor(location.startLine / 5) : 'file';
  return `${location.path}#${bucket}`;
}

export function dedupeKey(finding: Pick<RawFinding, 'ruleId' | 'title' | 'location'>): string {
  // Dependency findings are per-package, not per-line.
  if (finding.ruleId.startsWith('dep.')) {
    return `${finding.ruleId}#${finding.title}`;
  }
  return `${issueClass(finding.ruleId)}@${locationKey(finding.location)}`;
}

function worstSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER[a] <= SEVERITY_ORDER[b] ? a : b;
}

/**
 * Noisy-OR: two independent detectors that each say 0.7 should leave us more
 * confident than either alone, but never at certainty.
 */
export function combineConfidence(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0]!;
  const product = values.reduce((acc, value) => acc * (1 - value), 1);
  // Damped so three weak detectors cannot manufacture certainty.
  const combined = 1 - product * 0.92;
  return Math.min(0.97, Math.max(...values, combined));
}

function dedupeEvidence(items: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const item of items) {
    const key = `${item.kind}|${item.label}|${item.detail.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 8);
}

function dedupeLocations(items: CodeLocation[]): CodeLocation[] {
  const seen = new Set<string>();
  const out: CodeLocation[] = [];
  for (const item of items) {
    const key = `${item.path}:${item.startLine ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 12);
}

export interface AggregationResult {
  findings: Finding[];
  /** How many raw findings collapsed into each merged one. */
  mergedCounts: Map<string, number>;
  rawCount: number;
}

/**
 * Collapses raw detector output into the final finding list.
 */
export function aggregateFindings(scanId: string, raw: RawFinding[]): AggregationResult {
  const groups = new Map<string, RawFinding[]>();

  for (const finding of raw) {
    const key = dedupeKey(finding);
    const bucket = groups.get(key);
    if (bucket) bucket.push(finding);
    else groups.set(key, [finding]);
  }

  const findings: Finding[] = [];
  const mergedCounts = new Map<string, number>();
  const createdAt = new Date().toISOString();

  for (const [key, group] of groups) {
    // The richest member leads: most evidence wins, then highest severity.
    const primary = [...group].sort((a, b) => {
      const evidence = b.evidence.length - a.evidence.length;
      if (evidence !== 0) return evidence;
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    })[0]!;

    const detectedBy = [...new Set(group.map((f) => f.detectedBy))] as AgentId[];
    const detectors = [...new Set(group.flatMap((f) => f.detectors))];
    const severity = group.reduce<Severity>((acc, f) => worstSeverity(acc, f.severity), 'info');

    // Corroboration only counts when it comes from *different* agents.
    const confidences =
      detectedBy.length > 1
        ? detectedBy.map((agent) =>
            Math.max(...group.filter((f) => f.detectedBy === agent).map((f) => f.confidence)),
          )
        : [Math.max(...group.map((f) => f.confidence))];

    const otherLocations = dedupeLocations([
      ...group.flatMap((f) => f.otherLocations ?? []),
      ...group.filter((f) => f !== primary).map((f) => f.location),
    ]);

    // The dedupe key is unique per group by construction, so it — not the
    // location — is what makes the id unique. Several dependency findings
    // legitimately share `package.json` with no line number.
    const id = stableId('fnd', scanId, key);

    findings.push({
      ...primary,
      id,
      scanId,
      // Rules carry a fine-grained cause; the plan groups by the canonical one
      // so that "one fix closes these" is true of every group it shows.
      rootCauseId: canonicalRootCause(primary.rootCauseId),
      severity,
      confidence: combineConfidence(confidences),
      detectedBy,
      detectors,
      otherLocations,
      evidence: dedupeEvidence(group.flatMap((f) => f.evidence)),
      references: dedupeReferences(group.flatMap((f) => f.references)),
      // Set by the validator; `potential` until then.
      validation: 'potential',
      createdAt,
    });

    mergedCounts.set(id, group.length);
  }

  findings.sort((a, b) => {
    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severity !== 0) return severity;
    return b.confidence - a.confidence;
  });

  return { findings, mergedCounts, rawCount: raw.length };
}

function dedupeReferences(items: { label: string; url: string }[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}
