import type { RawFinding } from '@/types';
import type { Agent, AgentContext, AgentResult } from '../types';
import { breathe, checkAborted } from '../types';
import { runPatternRules } from '@/lib/analysis/rule-engine';
import { RELIABILITY_RULES } from '@/lib/analysis/rules/reliability';
import { enrichWithAI } from '../ai-pass';

/** Reliability agent — crashes, silent failures and unhandled states. */
export const bugAgent: Agent = {
  id: 'bugs',

  async run(ctx: AgentContext): Promise<AgentResult> {
    const { index, emit, signal } = ctx;
    const findings: RawFinding[] = [];
    const notes: string[] = [];
    const sources = index.sources;

    emit.activity(`Reading ${sources.length} source files`, 0.1, 0);
    await breathe(ctx.pace);

    const asyncFiles = index.find((f) => f.isCode && /\basync\b|await\s|Promise/.test(f.content));
    emit.activity(
      asyncFiles.length > 0
        ? `Following ${asyncFiles.length} asynchronous ${asyncFiles.length === 1 ? 'module' : 'modules'}`
        : 'Following control flow',
      0.35,
      sources.length,
    );
    emit.log(`${asyncFiles.length} files contain asynchronous control flow`);
    await breathe(ctx.pace);
    checkAborted(signal);

    emit.activity('Checking error handling paths', 0.55, sources.length);
    const { findings: ruleFindings, matchCounts } = runPatternRules(index, RELIABILITY_RULES);
    for (const finding of ruleFindings) {
      findings.push(finding);
      emit.finding(finding);
    }
    checkAborted(signal);

    /* --- Error-handling coverage ---------------------------------- */
    const handlersWithoutCatch = index
      .find((f) => f.isCode && /await\s/.test(f.content))
      .filter((f) => !/try\s*\{|\.catch\(|except\b|rescue\b/.test(f.content));

    if (handlersWithoutCatch.length >= 3) {
      const finding: RawFinding = {
        ruleId: 'bug.no-error-handling-module',
        title: `${handlersWithoutCatch.length} modules perform async work with no error handling at all`,
        category: 'reliability',
        severity: 'medium',
        confidence: 0.72,
        detectedBy: 'bugs',
        detectors: ['control-flow-scan'],
        location: index.snippet(handlersWithoutCatch[0]!.path, 1, 4),
        otherLocations: handlersWithoutCatch.slice(1, 6).map((f) => ({ path: f.path })),
        summary: `${handlersWithoutCatch.length} files await asynchronous work without a single \`try\`/\`catch\`, \`.catch()\` or equivalent anywhere in the file.`,
        impact:
          'Any rejection propagates to the top of the call stack. In a request handler that is a 500 with no context; in a background job it can terminate the worker.',
        evidence: [
          {
            kind: 'absence',
            label: 'No error handling found',
            detail: handlersWithoutCatch
              .slice(0, 5)
              .map((f) => f.path)
              .join(', '),
          },
          {
            kind: 'reasoning',
            label: 'Method',
            detail:
              'Files were selected because they contain `await`; the check is for the absence of any catch construct in the same file.',
          },
        ],
        recommendation:
          'Add a shared error boundary at the framework level so no handler can fail silently, then handle the specific recoverable cases locally.',
        rootCauseId: 'missing-failure-handling',
        references: [],
        effortMinutes: 60,
      };
      findings.push(finding);
      emit.finding(finding);
    }

    const ruleHits = Object.keys(matchCounts).length;
    notes.push(`${ruleHits} reliability rule families matched`);
    notes.push(`${asyncFiles.length} async modules inspected`);

    emit.activity('Reviewing failure modes', 0.85, sources.length);
    await breathe(ctx.pace);

    if (ctx.ai.available && findings.length > 0) {
      const enriched = await enrichWithAI(ctx, 'bugs', findings.slice(0, 5));
      if (enriched > 0) notes.push(`${enriched} findings reviewed by the model`);
    }

    emit.activity(
      findings.length > 0 ? `${findings.length} reliability issues raised` : 'No reliability issues surfaced',
      1,
      sources.length,
    );
    return { findings, filesScanned: sources.length, notes };
  },
};
