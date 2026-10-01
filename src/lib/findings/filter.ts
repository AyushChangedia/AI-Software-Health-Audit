import type { CategoryId, Finding, Severity, ValidationStatus } from '@/types';
import { SEVERITY_ORDER } from '@/lib/constants';

/**
 * Finding filtering and sorting.
 *
 * Shared between the API route and the client explorer so both produce exactly
 * the same list for the same query — which is what makes a shared link land on
 * the view the sender was looking at.
 */

export type SortKey = 'severity' | 'confidence' | 'file' | 'category';

export interface FindingQuery {
  search?: string;
  severities?: Severity[];
  categories?: CategoryId[];
  validations?: ValidationStatus[];
  sort?: SortKey;
  /** Hide findings the validator dismissed. Defaults to true. */
  hideDismissed?: boolean;
  rootCauseId?: string;
}

function matchesSearch(finding: Finding, needle: string): boolean {
  const haystack = [
    finding.title,
    finding.summary,
    finding.location.path,
    finding.ruleId,
    finding.cwe ?? '',
    finding.category,
  ]
    .join(' ')
    .toLowerCase();
  // Every whitespace-separated term must appear somewhere.
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export function filterFindings(findings: Finding[], query: FindingQuery): Finding[] {
  const {
    search,
    severities,
    categories,
    validations,
    sort = 'severity',
    hideDismissed = true,
    rootCauseId,
  } = query;

  const severitySet = severities?.length ? new Set(severities) : null;
  const categorySet = categories?.length ? new Set(categories) : null;
  const validationSet = validations?.length ? new Set(validations) : null;
  const needle = search?.trim();

  const filtered = findings.filter((finding) => {
    if (hideDismissed && finding.validation === 'dismissed') return false;
    if (severitySet && !severitySet.has(finding.severity)) return false;
    if (categorySet && !categorySet.has(finding.category)) return false;
    if (validationSet && !validationSet.has(finding.validation)) return false;
    if (rootCauseId && finding.rootCauseId !== rootCauseId) return false;
    if (needle && !matchesSearch(finding, needle)) return false;
    return true;
  });

  const sorted = [...filtered];
  switch (sort) {
    case 'confidence':
      sorted.sort((a, b) => b.confidence - a.confidence);
      break;
    case 'file':
      sorted.sort(
        (a, b) =>
          a.location.path.localeCompare(b.location.path) ||
          (a.location.startLine ?? 0) - (b.location.startLine ?? 0),
      );
      break;
    case 'category':
      sorted.sort(
        (a, b) =>
          a.category.localeCompare(b.category) ||
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
      );
      break;
    default:
      sorted.sort(
        (a, b) =>
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.confidence - a.confidence,
      );
  }
  return sorted;
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) {
    if (finding.validation === 'dismissed') continue;
    counts[finding.severity] += 1;
  }
  return counts;
}

export function countByCategory(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of findings) {
    if (finding.validation === 'dismissed') continue;
    counts[finding.category] = (counts[finding.category] ?? 0) + 1;
  }
  return counts;
}

/** Parses a query string into a `FindingQuery`. */
export function queryFromSearchParams(params: URLSearchParams): FindingQuery {
  const list = (key: string) =>
    params
      .getAll(key)
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean);

  const sort = params.get('sort');
  return {
    ...(params.get('q') ? { search: params.get('q')! } : {}),
    ...(list('severity').length ? { severities: list('severity') as Severity[] } : {}),
    ...(list('category').length ? { categories: list('category') as CategoryId[] } : {}),
    ...(list('validation').length ? { validations: list('validation') as ValidationStatus[] } : {}),
    ...(sort && ['severity', 'confidence', 'file', 'category'].includes(sort)
      ? { sort: sort as SortKey }
      : {}),
    hideDismissed: params.get('dismissed') !== 'true',
    ...(params.get('rootCause') ? { rootCauseId: params.get('rootCause')! } : {}),
  };
}
