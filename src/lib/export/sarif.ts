import type { Finding, Report, Severity } from '@/types';

/**
 * SARIF 2.1.0 export.
 *
 * SARIF is how findings get into GitHub code scanning, so this is the format
 * that makes Sentinel part of a pipeline rather than a destination.
 */

const LEVEL: Record<Severity, 'error' | 'warning' | 'note' | 'none'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'note',
  info: 'none',
};

/** GitHub reads `security-severity` as a CVSS-like number for filtering. */
const SECURITY_SEVERITY: Record<Severity, string> = {
  critical: '9.5',
  high: '7.5',
  medium: '5.0',
  low: '3.0',
  info: '1.0',
};

function ruleFor(finding: Finding) {
  return {
    id: finding.ruleId,
    name: finding.ruleId.replace(/[.-](\w)/g, (_, c: string) => c.toUpperCase()),
    shortDescription: { text: finding.title },
    fullDescription: { text: finding.impact },
    help: {
      text: finding.recommendation,
      markdown: [
        `**What**\n\n${finding.summary}`,
        `**Why it matters**\n\n${finding.impact}`,
        `**How to fix**\n\n${finding.recommendation}`,
        finding.references.length
          ? `**References**\n\n${finding.references.map((r) => `- [${r.label}](${r.url})`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
    defaultConfiguration: { level: LEVEL[finding.severity] },
    properties: {
      tags: [finding.category, ...(finding.cwe ? [finding.cwe] : []), ...(finding.owasp ? ['owasp'] : [])],
      'security-severity': SECURITY_SEVERITY[finding.severity],
      ...(finding.cwe ? { cwe: finding.cwe } : {}),
      ...(finding.owasp ? { owasp: finding.owasp } : {}),
    },
  };
}

export function toSarif(report: Report) {
  // Dismissed findings are excluded: exporting something the validator ruled
  // out would poison a downstream security dashboard.
  const findings = report.findings.filter((f) => f.validation !== 'dismissed');

  const rules = new Map<string, ReturnType<typeof ruleFor>>();
  for (const finding of findings) {
    if (!rules.has(finding.ruleId)) rules.set(finding.ruleId, ruleFor(finding));
  }
  const ruleIndex = new Map([...rules.keys()].map((id, index) => [id, index]));

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Sentinel',
            fullName: 'Sentinel AI Software Health Auditor',
            informationUri: 'https://github.com/AyushChangedia/AI-Software-Health-Audit',
            rules: [...rules.values()],
          },
        },
        automationDetails: {
          id: `sentinel/${report.repo.slug}/${report.scanId}`,
          description: {
            text:
              report.mode === 'demo'
                ? 'DEMO ANALYSIS — produced against a bundled sample repository, not real code.'
                : `Sentinel health score ${report.score.overall}/100.`,
          },
        },
        results: findings.map((finding) => ({
          ruleId: finding.ruleId,
          ruleIndex: ruleIndex.get(finding.ruleId) ?? 0,
          level: LEVEL[finding.severity],
          message: { text: finding.summary },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.location.path },
                ...(finding.location.startLine
                  ? {
                      region: {
                        startLine: finding.location.startLine,
                        ...(finding.location.endLine ? { endLine: finding.location.endLine } : {}),
                        ...(finding.location.snippet
                          ? { snippet: { text: finding.location.snippet } }
                          : {}),
                      },
                    }
                  : {}),
              },
            },
          ],
          ...(finding.otherLocations.length
            ? {
                relatedLocations: finding.otherLocations.map((location, index) => ({
                  id: index + 1,
                  physicalLocation: {
                    artifactLocation: { uri: location.path },
                    ...(location.startLine ? { region: { startLine: location.startLine } } : {}),
                  },
                })),
              }
            : {}),
          partialFingerprints: { sentinelFindingId: finding.id },
          properties: {
            confidence: finding.confidence,
            validation: finding.validation,
            detectedBy: finding.detectedBy,
            detectors: finding.detectors,
            rootCause: finding.rootCauseId,
          },
        })),
      },
    ],
  };
}
