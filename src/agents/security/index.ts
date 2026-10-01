import type { Agent, AgentContext, AgentResult } from '../types';
import { breathe, checkAborted } from '../types';
import { runPatternRules } from '@/lib/analysis/rule-engine';
import { SECURITY_RULES } from '@/lib/analysis/rules/security';
import type { RawFinding } from '@/types';
import { enrichWithAI } from '../ai-pass';

const AUTH_HINT = /(auth|session|login|token|jwt|permission|role|guard|middleware)/i;

/**
 * Security agent.
 *
 * Runs deterministic detectors first, then — only if a provider is configured —
 * asks the model to reason about the specific files those detectors flagged.
 * The model never gets to invent a finding out of nothing: it enriches evidence
 * that already exists, or proposes candidates that must survive validation.
 */
export const securityAgent: Agent = {
  id: 'security',

  async run(ctx: AgentContext): Promise<AgentResult> {
    const { index, emit, signal } = ctx;
    const findings: RawFinding[] = [];
    const notes: string[] = [];

    const scannable = index.files.filter((f) => !f.isVendor && !f.isGenerated);
    emit.activity(`Indexing ${scannable.length} files for security review`, 0.05, 0);

    /* --- Secrets ------------------------------------------------- */
    emit.activity('Sweeping for committed credentials', 0.15, 0);
    emit.log(`Scanning ${scannable.length} files for credential patterns`);
    // Computed once in the indexing phase; shared so the report-wide redactor
    // and this agent see exactly the same set of matched values.
    const secrets = ctx.secrets;
    for (const finding of secrets.findings) {
      findings.push(finding);
      emit.finding(finding);
    }
    emit.activity(
      secrets.findings.length > 0
        ? `Found ${secrets.findings.length} credential ${secrets.findings.length === 1 ? 'match' : 'matches'}`
        : 'No committed credentials matched',
      0.3,
      secrets.filesScanned,
    );
    notes.push(`${secrets.filesScanned} files swept for secrets`);
    checkAborted(signal);
    await breathe(ctx.pace);

    /* --- Injection + configuration rules -------------------------- */
    const authFiles = index.find((f) => AUTH_HINT.test(f.path) && f.isCode);
    emit.activity(
      authFiles.length > 0
        ? `Tracing ${authFiles.length} authentication-related ${authFiles.length === 1 ? 'module' : 'modules'}`
        : 'Mapping request handlers',
      0.45,
      secrets.filesScanned,
    );
    if (authFiles.length > 0) {
      emit.log(`Authentication surface: ${authFiles.slice(0, 3).map((f) => f.path).join(', ')}`);
    }
    await breathe(ctx.pace);

    emit.activity(`Applying ${SECURITY_RULES.length} injection and misconfiguration rules`, 0.6, scannable.length);
    const { findings: ruleFindings, matchCounts } = runPatternRules(index, SECURITY_RULES);
    for (const finding of ruleFindings) {
      findings.push(finding);
      emit.finding(finding);
    }
    checkAborted(signal);

    const ruleHits = Object.keys(matchCounts).length;
    notes.push(`${ruleHits} of ${SECURITY_RULES.length} rules matched`);
    emit.activity(
      ruleHits > 0 ? `${ruleHits} rule families matched` : 'No injection patterns matched',
      0.8,
      scannable.length,
    );
    await breathe(ctx.pace);

    /* --- AI reasoning pass ---------------------------------------- */
    if (ctx.ai.available && findings.length > 0) {
      emit.activity('Asking the model to reason about the flagged paths', 0.88, scannable.length);
      const enriched = await enrichWithAI(ctx, 'security', findings.slice(0, 6));
      if (enriched > 0) {
        notes.push(`${enriched} findings enriched with model reasoning`);
        emit.log(`Model reasoning applied to ${enriched} findings`);
      }
    } else if (!ctx.ai.available) {
      notes.push('Deterministic rules only — no AI provider configured');
    }

    emit.activity(
      findings.length > 0
        ? `${findings.length} security ${findings.length === 1 ? 'candidate' : 'candidates'} raised`
        : 'No high-confidence security issues surfaced',
      1,
      scannable.length,
    );

    return { findings, filesScanned: scannable.length, notes };
  },
};
