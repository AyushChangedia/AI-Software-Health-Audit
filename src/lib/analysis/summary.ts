import type { Finding, ImprovementPlan, ScanSummary, Severity } from '@/types';
import { NO_FINDINGS_COPY, SEVERITY_ORDER } from '@/lib/constants';

/**
 * Executive summary.
 *
 * Deliberately conservative language: Sentinel never says a repository is
 * secure. When nothing is found, it says nothing was found *by this analysis*.
 */
export function buildSummary(
  findings: Finding[],
  score: number,
  plan: ImprovementPlan,
): ScanSummary {
  const live = findings.filter((f) => f.validation !== 'dismissed');

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of live) counts[finding.severity] += 1;

  const urgent = live.filter(
    (f) =>
      (f.severity === 'critical' || f.severity === 'high') &&
      (f.validation === 'confirmed' || f.validation === 'likely'),
  );

  const topPriorities = [...live]
    .sort((a, b) => {
      const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (severity !== 0) return severity;
      return b.confidence - a.confidence;
    })
    .slice(0, 5)
    .map((f) => ({ findingId: f.id, title: f.title, severity: f.severity }));

  const dismissed = findings.length - live.length;

  let headline: string;
  if (live.length === 0) {
    headline = 'No high-confidence issues were identified by this analysis.';
  } else if (counts.critical > 0) {
    headline = `${counts.critical} critical ${counts.critical === 1 ? 'issue needs' : 'issues need'} attention before anything else.`;
  } else if (urgent.length > 0) {
    headline = `${urgent.length} ${urgent.length === 1 ? 'issue requires' : 'issues require'} attention; nothing is critical.`;
  } else {
    headline = 'No critical or high-confidence issues, but there is technical debt worth scheduling.';
  }

  const detailParts: string[] = [];
  if (live.length > 0) {
    detailParts.push(
      `Sentinel raised ${live.length} ${live.length === 1 ? 'finding' : 'findings'} and scored this repository ${score}/100.`,
    );
    if (plan.concentration.causes > 0 && plan.concentration.causes < plan.rootCauses.length) {
      const top = [...plan.rootCauses]
        .sort((a, b) => b.findingIds.length - a.findingIds.length)
        .slice(0, 2)
        .map((c) => c.title.toLowerCase());
      detailParts.push(
        `${plan.concentration.findings} of them come from just ${plan.concentration.causes} root ${plan.concentration.causes === 1 ? 'cause' : 'causes'} — chiefly ${top.join(' and ')}.`,
      );
    } else if (plan.rootCauses.length > 0) {
      detailParts.push(
        `They trace back to ${plan.rootCauses.length} root ${plan.rootCauses.length === 1 ? 'cause' : 'causes'}.`,
      );
    }
    if (plan.projectedScore > score) {
      // Careful with this number: it is what the same model would return with
      // these findings resolved, not a promise about the resulting software.
      detailParts.push(
        `Clearing the whole plan would move the score to ${plan.projectedScore} against the same model — a gain of ${plan.projectedScore - score} points.`,
      );
    }
  } else {
    detailParts.push(
      `Sentinel scored this repository ${score}/100 without raising a finding above the reporting threshold.`,
    );
  }
  if (dismissed > 0) {
    detailParts.push(
      `${dismissed} further ${dismissed === 1 ? 'candidate was' : 'candidates were'} dismissed by the validator and are listed for transparency.`,
    );
  }

  return {
    headline,
    detail: detailParts.join(' '),
    counts,
    topPriorities,
    caveat:
      live.length === 0
        ? NO_FINDINGS_COPY
        : 'Confidence reflects what static analysis can establish from source alone. Findings marked "potential" need a human to confirm reachability.',
  };
}
