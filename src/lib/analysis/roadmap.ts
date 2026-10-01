import type {
  CategoryId,
  CodebaseMetrics,
  DependencyRecommendation,
  Finding,
  ImprovementPlan,
  RoadmapPhase,
  RootCause,
  Severity,
} from '@/types';
import { CATEGORY_META, SEVERITY_ORDER } from '@/lib/constants';
import { projectScore } from './scoring';
import { ROOT_CAUSES, rootCauseTemplate } from './root-causes';
import type { RepoIndex } from './repo-index';
import type { DependencyReport } from '@/types';

/**
 * The improvement plan.
 *
 * A list of 47 warnings is not actionable. What is actionable is "these six
 * decisions produced 31 of them". Findings carry a `rootCauseId` assigned by
 * the rule that raised them; this module turns those groups into an ordered
 * plan with real effort and a real projected score.
 */

function worstSeverity(findings: Finding[]): Severity {
  return findings.reduce<Severity>(
    (acc, f) => (SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[acc] ? f.severity : acc),
    'info',
  );
}

function effortRange(findings: Finding[]): [number, number] {
  // Fixing a class together is cheaper per site than fixing each in isolation.
  const totalMinutes = findings.reduce((sum, f) => sum + f.effortMinutes, 0);
  const shared = totalMinutes * 0.6 + findings[0]!.effortMinutes * 0.4;
  const low = Math.max(1, Math.round(shared / 60));
  const high = Math.max(low + 1, Math.round((totalMinutes / 60) * 1.2));
  return [low, high];
}

/* ------------------------------------------------------------------ */
/* Dependency recommendations                                          */
/* ------------------------------------------------------------------ */

interface RecommendationRule {
  /** Fires when any finding matches. */
  when: (findings: Finding[], index: RepoIndex, deps: DependencyReport) => Finding[];
  build: (matched: Finding[], index: RepoIndex) => DependencyRecommendation;
}

function hasPackage(deps: DependencyReport, ...names: string[]): boolean {
  return deps.nodes.some((n) => names.includes(n.name));
}

const RECOMMENDATION_RULES: RecommendationRule[] = [
  {
    when: (findings, _index, deps) =>
      hasPackage(deps, 'zod', 'yup', 'joi', 'valibot', 'superstruct', 'pydantic')
        ? []
        : findings.filter((f) => f.rootCauseId === 'missing-input-validation'),
    build: (matched) => ({
      name: 'Zod',
      ecosystem: 'npm',
      reason:
        'Schema-first validation that infers TypeScript types from the schema, so the parsed value and the declared type cannot drift apart.',
      currentIssue: `${matched.length} ${matched.length === 1 ? 'endpoint accepts' : 'endpoints accept'} request data with no schema validation, and no validation library is currently a dependency.`,
      alternatives: ['Valibot (smaller bundle)', 'Joi (no TypeScript inference)', 'TypeBox (JSON Schema output)'],
      addressesFindingIds: matched.map((f) => f.id),
      url: 'https://zod.dev',
    }),
  },
  {
    when: (findings, _index, deps) =>
      hasPackage(deps, 'helmet', 'next-safe') ? [] : findings.filter((f) => f.rootCauseId === 'permissive-configuration'),
    build: (matched) => ({
      name: 'Helmet',
      ecosystem: 'npm',
      reason:
        'Sets the security response headers — CSP, HSTS, frame options, referrer policy — in one middleware instead of per route.',
      currentIssue: `${matched.length} configuration ${matched.length === 1 ? 'finding' : 'findings'} relate to permissive defaults that headers would constrain.`,
      alternatives: ['Hand-written header middleware', 'Edge/CDN header rules'],
      addressesFindingIds: matched.map((f) => f.id),
      url: 'https://helmetjs.github.io',
    }),
  },
  {
    when: (findings, _index, deps) =>
      hasPackage(deps, 'vitest', 'jest', 'mocha', 'ava', 'pytest', 'node:test')
        ? []
        : findings.filter((f) => f.rootCauseId === 'no-test-safety-net'),
    build: (matched) => ({
      name: 'Vitest',
      ecosystem: 'npm',
      reason:
        'Runs TypeScript directly with no separate transform configuration, so the first test can be written in minutes rather than after a toolchain setup.',
      currentIssue: 'No test runner is declared, so there is nowhere for a regression test to live.',
      alternatives: ['Jest (larger ecosystem)', 'node:test (zero dependencies)'],
      addressesFindingIds: matched.map((f) => f.id),
      url: 'https://vitest.dev',
    }),
  },
  {
    when: (findings, _index, deps) =>
      hasPackage(deps, 'pino', 'winston', 'bunyan', 'structlog')
        ? []
        : findings.filter((f) => f.rootCauseId === 'no-logging-strategy'),
    build: (matched) => ({
      name: 'Pino',
      ecosystem: 'npm',
      reason:
        'Structured JSON logging with levels and a redaction list, so credentials cannot reach the log pipeline by accident.',
      currentIssue: `${matched.length} ${matched.length === 1 ? 'module logs' : 'modules log'} to the console directly, with no level, structure or redaction.`,
      alternatives: ['Winston (more transports)', 'A thin wrapper over console for very small projects'],
      addressesFindingIds: matched.map((f) => f.id),
      url: 'https://getpino.io',
    }),
  },
  {
    when: (findings) => findings.filter((f) => f.rootCauseId === 'money-precision'),
    build: (matched) => ({
      name: 'Dinero.js',
      ecosystem: 'npm',
      reason:
        'Represents money as an integer amount plus a currency, so arithmetic is exact and currency mixing is a type error.',
      currentIssue: `${matched.length} monetary ${matched.length === 1 ? 'calculation uses' : 'calculations use'} floating-point arithmetic.`,
      alternatives: ['decimal.js (general decimal maths)', 'Integer minor units with a small helper'],
      addressesFindingIds: matched.map((f) => f.id),
      url: 'https://dinerojs.com',
    }),
  },
  {
    when: (findings) => findings.filter((f) => f.rootCauseId === 'unparameterised-queries'),
    build: (matched) => ({
      name: 'Drizzle ORM',
      ecosystem: 'npm',
      reason:
        'A typed query builder that binds values by construction, so the interpolation mistake cannot be expressed. Raw SQL stays available for the cases that need it.',
      currentIssue: `${matched.length} ${matched.length === 1 ? 'query is' : 'queries are'} built by string interpolation.`,
      alternatives: ['Prisma (heavier, generates a client)', 'Kysely (query builder only)', 'Parameter binding with the existing driver'],
      addressesFindingIds: matched.map((f) => f.id),
      url: 'https://orm.drizzle.team',
    }),
  },
  {
    when: (findings, _index, deps) =>
      hasPackage(deps, 'dompurify', 'sanitize-html')
        ? []
        : findings.filter((f) => f.rootCauseId === 'unescaped-output'),
    build: (matched) => ({
      name: 'DOMPurify',
      ecosystem: 'npm',
      reason:
        'A maintained, allow-list-based HTML sanitiser. Hand-written escaping misses mutation XSS; this does not.',
      currentIssue: `${matched.length} ${matched.length === 1 ? 'site writes' : 'sites write'} raw HTML into the DOM without sanitisation.`,
      alternatives: ['Render as text and drop HTML support', 'sanitize-html (server-side)'],
      addressesFindingIds: matched.map((f) => f.id),
      url: 'https://github.com/cure53/DOMPurify',
    }),
  },
];

export function buildRecommendations(
  findings: Finding[],
  index: RepoIndex,
  deps: DependencyReport,
): DependencyRecommendation[] {
  const live = findings.filter((f) => f.validation !== 'dismissed');
  const out: DependencyRecommendation[] = [];
  for (const rule of RECOMMENDATION_RULES) {
    const matched = rule.when(live, index, deps);
    if (matched.length > 0) out.push(rule.build(matched, index));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Plan assembly                                                       */
/* ------------------------------------------------------------------ */

/** Phases, in the order they should be worked. */
const PHASE_ORDER: { theme: CategoryId; title: string; summary: string }[] = [
  {
    theme: 'security',
    title: 'Security',
    summary: 'Close the paths an attacker can reach today. Nothing else moves until these are done.',
  },
  {
    theme: 'dependencies',
    title: 'Supply chain',
    summary: 'Version bumps with published fixes — the cheapest risk reduction available.',
  },
  {
    theme: 'reliability',
    title: 'Reliability',
    summary: 'Define what happens when things fail, so degradation is a decision rather than an accident.',
  },
  {
    theme: 'testing',
    title: 'Verification',
    summary: 'Put a safety net under the paths that cost money when they break.',
  },
  {
    theme: 'architecture',
    title: 'Architecture',
    summary: 'Make the boundaries real, so the fixes above stay fixed.',
  },
  {
    theme: 'performance',
    title: 'Performance',
    summary: 'Remove the work that grows with your data.',
  },
  {
    theme: 'maintainability',
    title: 'Maintainability',
    summary: 'Reduce what future changes have to carry.',
  },
  {
    theme: 'ai-code',
    title: 'Consistency',
    summary: 'Finish what was started and settle on one convention per concern.',
  },
];

export function buildImprovementPlan(
  findings: Finding[],
  metrics: CodebaseMetrics,
  index: RepoIndex,
  deps: DependencyReport,
): ImprovementPlan {
  const live = findings.filter((f) => f.validation !== 'dismissed');
  const byRootCause = new Map<string, Finding[]>();
  for (const finding of live) {
    const bucket = byRootCause.get(finding.rootCauseId) ?? [];
    bucket.push(finding);
    byRootCause.set(finding.rootCauseId, bucket);
  }

  const baseline = projectScore(live, metrics, new Set());

  const rootCauses: RootCause[] = [];
  for (const [id, group] of byRootCause) {
    const template = rootCauseTemplate(id);
    const resolved = new Set(group.map((f) => f.id));
    const improved = projectScore(live, metrics, resolved);

    rootCauses.push({
      id,
      title: template.title,
      description: template.description,
      category: template.category,
      findingIds: group.map((f) => f.id),
      effortHours: effortRange(group),
      expectedScoreGain: Math.max(0, improved - baseline),
      severity: worstSeverity(group),
    });
  }

  // Highest impact per hour first, with severity as the tie-break.
  rootCauses.sort((a, b) => {
    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severity !== 0) return severity;
    const rateA = a.expectedScoreGain / Math.max(1, a.effortHours[0]);
    const rateB = b.expectedScoreGain / Math.max(1, b.effortHours[0]);
    return rateB - rateA;
  });

  const findingById = new Map(live.map((f) => [f.id, f]));

  const phases: RoadmapPhase[] = [];
  let order = 1;
  for (const spec of PHASE_ORDER) {
    const causes = rootCauses.filter((cause) => cause.category === spec.theme);
    if (causes.length === 0) continue;

    const effort = causes.reduce<[number, number]>(
      (acc, cause) => [acc[0] + cause.effortHours[0], acc[1] + cause.effortHours[1]],
      [0, 0],
    );

    // Score it as one piece of work, not as the sum of its parts. Deductions
    // are damped above a threshold, so removing findings one at a time each
    // move the score barely at all while removing them together moves it a
    // lot — summing the marginal gains would understate the phase by an order
    // of magnitude.
    const phaseResolved = new Set(causes.flatMap((cause) => cause.findingIds));
    const phaseGain = Math.max(0, projectScore(live, metrics, phaseResolved) - baseline);

    phases.push({
      id: `phase-${spec.theme}`,
      order: order++,
      title: spec.title,
      theme: spec.theme,
      summary: spec.summary,
      effortHours: effort,
      expectedScoreGain: Number(phaseGain.toFixed(1)),
      actions: causes.map((cause) => {
        const members = cause.findingIds
          .map((id) => findingById.get(id))
          .filter((f): f is Finding => Boolean(f));
        const top = members.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])[0];
        return {
          id: `action-${cause.id}`,
          title: cause.title,
          severity: cause.severity,
          rootCauseId: cause.id,
          findingIds: cause.findingIds,
          detail:
            `${cause.description} ` +
            `${members.length === 1 ? 'One finding shares' : `${members.length} findings share`} this cause` +
            `${top ? `, starting at \`${top.location.path}${top.location.startLine ? `:${top.location.startLine}` : ''}\`` : ''}.`,
        };
      }),
    });
  }

  // Every live finding carries exactly one cause, so the causes always cover
  // all of them. The useful number is the *concentration*: how few causes
  // account for most of the list.
  const coveredFindings = new Set(rootCauses.flatMap((cause) => cause.findingIds)).size;
  const concentration = measureConcentration(rootCauses, live.length);

  return {
    totalFindings: live.length,
    rootCauses,
    coveredFindings,
    concentration,
    phases,
    dependencyRecommendations: buildRecommendations(findings, index, deps),
    projectedScore: projectScore(live, metrics, new Set(live.map((f) => f.id))),
  };
}

/** Fewest causes covering at least 60% of findings. */
function measureConcentration(
  rootCauses: RootCause[],
  total: number,
): { causes: number; findings: number } {
  if (total === 0) return { causes: 0, findings: 0 };
  const sorted = [...rootCauses].sort((a, b) => b.findingIds.length - a.findingIds.length);
  const target = Math.ceil(total * 0.6);
  let covered = 0;
  let used = 0;
  for (const cause of sorted) {
    covered += cause.findingIds.length;
    used += 1;
    if (covered >= target) break;
  }
  return { causes: used, findings: covered };
}

export { ROOT_CAUSES, CATEGORY_META };
