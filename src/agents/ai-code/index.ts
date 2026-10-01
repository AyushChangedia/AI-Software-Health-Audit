import type { RawFinding } from '@/types';
import type { Agent, AgentContext, AgentResult } from '../types';
import { breathe, checkAborted } from '../types';
import { runPatternRules } from '@/lib/analysis/rule-engine';
import { AI_CODE_RULES } from '@/lib/analysis/rules/ai-code';

/**
 * AI Code Quality agent.
 *
 * Sentinel does not claim to detect AI-generated code — no tool can do that
 * reliably, and pretending otherwise would undermine everything else in the
 * report. What this agent measures is a cluster of patterns that show up when
 * code is produced faster than it is integrated: imports that point at nothing,
 * duplicated blocks, placeholder implementations, exports nobody consumes.
 *
 * Every string it emits is phrased as a pattern, never as an accusation.
 */
export const aiCodeAgent: Agent = {
  id: 'ai-code',

  async run(ctx: AgentContext): Promise<AgentResult> {
    const { index, graph, structure, emit, signal } = ctx;
    const findings: RawFinding[] = [];
    const notes: string[] = [];
    const sources = index.sources;

    emit.activity(`Reviewing ${sources.length} files for integration gaps`, 0.15, 0);
    await breathe(ctx.pace);

    /* --- Imports that resolve to nothing ---------------------------- */
    // This is the strongest signal in the agent: a relative import with no
    // target means the file has never successfully been built or run.
    emit.activity('Resolving every local import', 0.3, sources.length);
    if (graph.dangling.length > 0) {
      const first = graph.dangling[0]!;
      const finding: RawFinding = {
        ruleId: 'ai.unresolved-import',
        title: `${graph.dangling.length} local ${graph.dangling.length === 1 ? 'import points' : 'imports point'} at a file that does not exist`,
        category: 'ai-code',
        severity: 'high',
        confidence: 0.9,
        detectedBy: 'ai-code',
        detectors: ['module-graph'],
        location: index.snippet(first.from, first.line, 3),
        otherLocations: graph.dangling.slice(1, 6).map((d) => ({ path: d.from, startLine: d.line })),
        summary: `\`${first.from}:${first.line}\` imports \`${first.specifier}\`, which does not resolve to any file in the repository.${graph.dangling.length > 1 ? ` ${graph.dangling.length - 1} other imports have the same problem.` : ''}`,
        impact:
          'A module with an unresolvable import cannot have been executed. Either the file is dead and should be deleted, or the code path it belongs to has never run.',
        evidence: graph.dangling.slice(0, 5).map((d) => ({
          kind: 'code' as const,
          label: 'Unresolved import',
          detail: `${d.from}:${d.line} → ${d.specifier}`,
          path: d.from,
          line: d.line,
          source: 'module-graph',
        })),
        recommendation:
          'Resolve each one: restore the missing module, fix the path, or delete the importing file. A build with strict module resolution would catch these at commit time.',
        rootCauseId: 'incomplete-implementations',
        references: [],
        effortMinutes: 45,
      };
      findings.push(finding);
      emit.finding(finding);
      emit.log(`${graph.dangling.length} imports do not resolve`);
    }
    await breathe(ctx.pace);
    checkAborted(signal);

    /* --- Duplication ------------------------------------------------ */
    emit.activity('Fingerprinting for repeated implementations', 0.5, sources.length);
    const spread = structure.duplicates.filter(
      (block) => new Set(block.occurrences.map((o) => o.path)).size > 1,
    );
    if (spread.length >= 3) {
      const worst = spread[0]!;
      const finding: RawFinding = {
        ruleId: 'ai.repeated-implementation',
        title: `${spread.length} code blocks are repeated across multiple files`,
        category: 'ai-code',
        severity: spread.length > 10 ? 'medium' : 'low',
        confidence: 0.78,
        detectedBy: 'ai-code',
        detectors: ['duplication-fingerprint'],
        location: index.snippet(worst.occurrences[0]!.path, worst.occurrences[0]!.startLine, 3),
        otherLocations: worst.occurrences.slice(1, 5).map((o) => ({
          path: o.path,
          startLine: o.startLine,
        })),
        summary: `${spread.length} blocks of six or more significant lines appear in two or more files. The largest cluster repeats across ${worst.occurrences.length} locations.`,
        impact:
          'Duplicated logic diverges. A fix applied to one copy silently leaves the others wrong, and the bug reappears months later in a place nobody connects to the original.',
        evidence: [
          {
            kind: 'code',
            label: 'Repeated block',
            detail: worst.sample,
            path: worst.occurrences[0]!.path,
            line: worst.occurrences[0]!.startLine,
            source: 'duplication-fingerprint',
          },
          {
            kind: 'code',
            label: 'Appears at',
            detail: worst.occurrences.map((o) => `${o.path}:${o.startLine}`).join('\n'),
          },
          {
            kind: 'reasoning',
            label: 'Method',
            detail:
              'Lines are normalised (whitespace collapsed, string and numeric literals replaced) and hashed in sliding windows of six. Identical hashes in different files are reported.',
          },
        ],
        recommendation:
          'Extract the largest clusters into shared functions. Start with the ones that appear in three or more files — those are the ones already costing you.',
        rootCauseId: 'duplicated-logic',
        references: [],
        effortMinutes: 90,
      };
      findings.push(finding);
      emit.finding(finding);
    }
    await breathe(ctx.pace);

    /* --- Unused exports --------------------------------------------- */
    emit.activity('Checking which exports anything consumes', 0.68, sources.length);
    if (graph.unusedExports.length >= 5) {
      const first = graph.unusedExports[0]!;
      const byFile = new Map<string, number>();
      for (const item of graph.unusedExports) byFile.set(item.path, (byFile.get(item.path) ?? 0) + 1);

      const finding: RawFinding = {
        ruleId: 'ai.unused-exports',
        title: `${graph.unusedExports.length} exported symbols are never imported`,
        category: 'ai-code',
        severity: 'low',
        confidence: 0.7,
        detectedBy: 'ai-code',
        detectors: ['module-graph'],
        location: index.snippet(first.path, first.line, 3),
        otherLocations: graph.unusedExports.slice(1, 6).map((e) => ({
          path: e.path,
          startLine: e.line,
        })),
        summary: `${graph.unusedExports.length} symbols are exported but imported nowhere in the repository, across ${byFile.size} files.`,
        impact:
          'Dead exports are maintained as if they were used: they get refactored, reviewed and kept compiling for no benefit. They also make it impossible to tell what a module is actually for.',
        evidence: [
          {
            kind: 'absence',
            label: 'No importers',
            detail: [...byFile.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([path, count]) => `${path} (${count})`)
              .join('\n'),
            source: 'module-graph',
          },
          {
            kind: 'reasoning',
            label: 'Caveat',
            detail:
              'Framework entry points and convention-loaded files are excluded. A symbol consumed only by a dynamic import or by a consumer outside this repository will still appear here.',
          },
        ],
        recommendation:
          'Delete what is genuinely unused and downgrade the rest from `export` to module-private. Version control remembers anything you need back.',
        rootCauseId: 'dead-code',
        references: [],
        effortMinutes: 40,
      };
      findings.push(finding);
      emit.finding(finding);
    }
    await breathe(ctx.pace);
    checkAborted(signal);

    /* --- Pattern rules ----------------------------------------------- */
    emit.activity('Scanning for placeholders and inconsistent conventions', 0.85, sources.length);
    const { findings: ruleFindings } = runPatternRules(index, AI_CODE_RULES);
    for (const finding of ruleFindings) {
      findings.push(finding);
      emit.finding(finding);
    }

    notes.push(`${graph.dangling.length} unresolved imports`);
    notes.push(`${(structure.metrics.duplication * 100).toFixed(1)}% duplicated lines`);
    notes.push('Patterns only — authorship is never inferred');

    emit.activity(
      findings.length > 0
        ? `${findings.length} integration-quality patterns raised`
        : 'No AI-assisted development patterns stood out',
      1,
      sources.length,
    );
    return { findings, filesScanned: sources.length, notes };
  },
};
