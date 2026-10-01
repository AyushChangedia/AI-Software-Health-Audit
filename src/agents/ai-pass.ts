import { z } from 'zod';
import type { AgentId, RawFinding } from '@/types';
import type { AgentContext } from './types';
import { createLogger } from '@/lib/logger';

const logger = createLogger('agent:ai');

/**
 * The shared AI enrichment pass.
 *
 * Constraints, in priority order:
 *   1. The model never invents a location. It is given findings that already
 *      point at real lines and asked to explain them better.
 *   2. It may *lower* confidence and mark something as a false positive. That
 *      is the most valuable thing it does.
 *   3. If anything about the response is wrong — unparseable, references a
 *      finding index that does not exist, returns an out-of-range confidence —
 *      the deterministic finding is kept untouched.
 */

const enrichmentSchema = z.object({
  findings: z.array(
    z.object({
      index: z.number().int().min(0),
      verdict: z.enum(['real', 'uncertain', 'false_positive']),
      confidence: z.number().min(0).max(1),
      summary: z.string().min(20).max(600).optional(),
      impact: z.string().min(20).max(600).optional(),
      recommendation: z.string().min(20).max(800).optional(),
      reasoning: z.string().min(10).max(600),
    }),
  ),
});

const SYSTEM = `You are a staff security engineer reviewing static-analysis output for a code audit tool called Sentinel.

You are given findings that a deterministic analyzer already produced, each with the exact source lines it matched. Your job is to judge them, not to invent new ones.

Rules you must follow:
- Judge only what the provided code shows. If reachability from untrusted input is not visible in the snippet, the verdict is "uncertain", not "real".
- Mark "false_positive" when the snippet contains a mitigation the analyzer missed (parameter binding, sanitisation, an allow-list, a framework guard).
- Confidence is your probability that the issue is genuinely exploitable or genuinely a defect. Be calibrated: 0.95+ only when the code alone proves it.
- Never claim certainty you do not have. Never describe a hypothetical exploit as observed.
- Rewritten text must be concrete and reference the actual identifiers in the code. No generic advice such as "improve security".`;

function renderFinding(finding: RawFinding, index: number): string {
  const location = finding.location;
  return [
    `### Finding ${index}`,
    `rule: ${finding.ruleId}`,
    `title: ${finding.title}`,
    `severity: ${finding.severity}`,
    `detector confidence: ${finding.confidence.toFixed(2)}`,
    `file: ${location.path}${location.startLine ? `:${location.startLine}` : ''}`,
    `language: ${location.language ?? 'unknown'}`,
    location.snippet ? `\`\`\`\n${location.snippet.slice(0, 1_200)}\n\`\`\`` : '(no snippet available)',
    `analyzer summary: ${finding.summary}`,
  ].join('\n');
}

/**
 * Enriches findings in place. Returns how many were changed.
 */
export async function enrichWithAI(
  ctx: AgentContext,
  agent: AgentId,
  findings: RawFinding[],
): Promise<number> {
  if (!ctx.ai.available || findings.length === 0) return 0;

  const prompt = [
    `Repository: ${ctx.index.repo.slug}`,
    `Primary languages: ${ctx.index.languages.slice(0, 3).map((l) => l.name).join(', ') || 'unknown'}`,
    '',
    'Findings to judge:',
    '',
    ...findings.map((finding, i) => renderFinding(finding, i)),
    '',
    'Return JSON of the form:',
    '{"findings":[{"index":0,"verdict":"real|uncertain|false_positive","confidence":0.0,',
    '"summary":"...","impact":"...","recommendation":"...","reasoning":"..."}]}',
    '',
    'Include every finding index exactly once. summary/impact/recommendation are optional —',
    'omit them when the analyzer text is already accurate.',
  ].join('\n');

  const result = await ctx.ai.structured({
    purpose: `${agent}-enrich`,
    system: SYSTEM,
    prompt,
    schema: enrichmentSchema,
    maxTokens: 2_000,
  });

  if (!result) {
    logger.debug('ai.enrich_skipped', { agent, reason: 'no usable response' });
    return 0;
  }

  let changed = 0;
  for (const judgement of result.findings) {
    const finding = findings[judgement.index];
    if (!finding) continue;

    // Blend, do not replace. The detector's confidence encodes how specific the
    // pattern is; the model's encodes whether the surrounding code supports it.
    const blended =
      judgement.verdict === 'false_positive'
        ? Math.min(finding.confidence, judgement.confidence) * 0.5
        : (finding.confidence + judgement.confidence) / 2;

    finding.confidence = Math.max(0.05, Math.min(0.99, blended));
    if (judgement.summary) finding.summary = judgement.summary;
    if (judgement.impact) finding.impact = judgement.impact;
    if (judgement.recommendation) finding.recommendation = judgement.recommendation;

    finding.evidence.push({
      kind: 'reasoning',
      label: `Model review (${judgement.verdict.replace('_', ' ')})`,
      detail: judgement.reasoning,
      source: ctx.ai.name,
    });
    finding.detectors.push(`ai:${ctx.ai.name}`);
    changed += 1;
  }

  return changed;
}

/* ------------------------------------------------------------------ */
/* Executive summary                                                   */
/* ------------------------------------------------------------------ */

const summarySchema = z.object({
  headline: z.string().min(10).max(200),
  detail: z.string().min(30).max(700),
});

/**
 * Writes the report's opening paragraph. Falls back to a deterministic template
 * when no provider is configured — see `buildSummary` in `lib/analysis/report`.
 */
export async function narrateSummary(
  ctx: Pick<AgentContext, 'ai' | 'index'>,
  facts: {
    score: number;
    counts: Record<string, number>;
    topTitles: string[];
    rootCauses: string[];
  },
): Promise<{ headline: string; detail: string } | null> {
  if (!ctx.ai.available) return null;

  return ctx.ai.structured({
    purpose: 'report-summary',
    system:
      'You write the opening of an engineering audit report. Be direct and specific. ' +
      'Use only the facts given. Never claim a repository is secure or free of vulnerabilities — ' +
      'the correct phrasing is that no high-confidence issues were identified by this analysis. ' +
      'Two to four sentences of detail, no bullet points, no headings.',
    prompt: [
      `Repository: ${ctx.index.repo.slug}`,
      `Health score: ${facts.score}/100`,
      `Findings by severity: ${JSON.stringify(facts.counts)}`,
      `Top issues: ${facts.topTitles.slice(0, 5).join('; ') || 'none'}`,
      `Root causes: ${facts.rootCauses.slice(0, 5).join('; ') || 'none'}`,
      '',
      'Return {"headline": "...", "detail": "..."}. The headline is one sentence.',
    ].join('\n'),
    schema: summarySchema,
    maxTokens: 600,
  });
}
