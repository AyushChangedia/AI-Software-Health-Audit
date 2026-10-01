import type { RawFinding } from '@/types';
import type { Agent, AgentContext, AgentResult } from '../types';
import { breathe } from '../types';

const COMPLEXITY_THRESHOLD = 15;
const LENGTH_THRESHOLD = 120;
const PARAM_THRESHOLD = 6;

/** Maintainability agent — complexity, duplication and dead weight. */
export const maintainabilityAgent: Agent = {
  id: 'maintainability',

  async run(ctx: AgentContext): Promise<AgentResult> {
    const { index, structure, emit } = ctx;
    const findings: RawFinding[] = [];
    const notes: string[] = [];
    const { functions, metrics } = structure;

    emit.activity(`Measuring ${functions.length} functions`, 0.2, 0);
    await breathe(ctx.pace);
    emit.log(`Mean complexity ${metrics.avgComplexity}, peak ${metrics.maxComplexity}`);

    /* --- Complexity -------------------------------------------------- */
    emit.activity('Ranking by cyclomatic complexity', 0.4, functions.length);
    const complex = functions
      .filter((f) => f.complexity >= COMPLEXITY_THRESHOLD)
      .sort((a, b) => b.complexity - a.complexity)
      .slice(0, 5);

    for (const fn of complex) {
      const finding: RawFinding = {
        ruleId: 'maint.high-complexity',
        title: `\`${fn.name}()\` has a complexity of ${fn.complexity}`,
        category: 'maintainability',
        severity: fn.complexity >= 30 ? 'medium' : 'low',
        confidence: 0.85,
        detectedBy: 'maintainability',
        detectors: ['ast-lite'],
        location: index.snippet(fn.path, fn.startLine, 4),
        summary: `\`${fn.name}()\` in \`${fn.path}\` contains ${fn.complexity} decision points across ${fn.lines} lines. Roughly ${fn.complexity} independent paths run through it.`,
        impact:
          'Complexity is the number of tests needed to cover the function and the number of cases a reviewer must hold in mind. Past about 15, both stop happening reliably.',
        evidence: [
          {
            kind: 'code',
            label: 'Measurement',
            detail: `complexity ${fn.complexity}, ${fn.lines} lines, nesting depth ${fn.maxNesting}, ${fn.parameters} parameters`,
            path: fn.path,
            line: fn.startLine,
            source: 'ast-lite',
          },
          {
            kind: 'reasoning',
            label: 'How it is counted',
            detail:
              'One, plus every branch point: if / else if / for / while / case / catch and each short-circuit or ternary operator.',
          },
        ],
        recommendation:
          'Extract the independent decisions into named predicates. The goal is a function whose branches you can list without scrolling, not a lower number for its own sake.',
        rootCauseId: 'complexity-debt',
        references: [],
        effortMinutes: 60,
      };
      findings.push(finding);
      emit.finding(finding);
    }
    notes.push(`${complex.length} functions over complexity ${COMPLEXITY_THRESHOLD}`);
    await breathe(ctx.pace);

    /* --- Long functions ----------------------------------------------- */
    const long = functions
      .filter((f) => f.lines >= LENGTH_THRESHOLD && f.complexity < COMPLEXITY_THRESHOLD)
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 3);

    for (const fn of long) {
      const finding: RawFinding = {
        ruleId: 'maint.long-function',
        title: `\`${fn.name}()\` runs to ${fn.lines} lines`,
        category: 'maintainability',
        severity: 'low',
        confidence: 0.9,
        detectedBy: 'maintainability',
        detectors: ['ast-lite'],
        location: index.snippet(fn.path, fn.startLine, 4),
        summary: `\`${fn.name}()\` in \`${fn.path}\` spans lines ${fn.startLine}–${fn.endLine}.`,
        impact:
          'A function longer than a screen cannot be read as a unit, so its steps get coupled by accident through shared locals.',
        evidence: [
          {
            kind: 'code',
            label: 'Span',
            detail: `lines ${fn.startLine}–${fn.endLine} (${fn.lines} lines)`,
            path: fn.path,
            line: fn.startLine,
            source: 'ast-lite',
          },
        ],
        recommendation: 'Split at the blank lines you already use to separate its phases.',
        rootCauseId: 'complexity-debt',
        references: [],
        effortMinutes: 45,
      };
      findings.push(finding);
      emit.finding(finding);
    }

    /* --- Parameter lists ----------------------------------------------- */
    const wide = functions.filter((f) => f.parameters >= PARAM_THRESHOLD).slice(0, 2);
    for (const fn of wide) {
      const finding: RawFinding = {
        ruleId: 'maint.wide-signature',
        title: `\`${fn.name}()\` takes ${fn.parameters} parameters`,
        category: 'maintainability',
        severity: 'low',
        confidence: 0.88,
        detectedBy: 'maintainability',
        detectors: ['ast-lite'],
        location: index.snippet(fn.path, fn.startLine, 3),
        summary: `\`${fn.name}()\` in \`${fn.path}\` accepts ${fn.parameters} positional parameters.`,
        impact:
          'Long positional signatures are misread at the call site, and two adjacent parameters of the same type will eventually be swapped.',
        evidence: [
          {
            kind: 'code',
            label: 'Signature',
            detail: index.file(fn.path)?.lines[fn.startLine - 1]?.trim().slice(0, 200) ?? '',
            path: fn.path,
            line: fn.startLine,
            source: 'ast-lite',
          },
        ],
        recommendation: 'Take a single options object so every argument is named at the call site.',
        rootCauseId: 'complexity-debt',
        references: [],
        effortMinutes: 30,
      };
      findings.push(finding);
      emit.finding(finding);
    }

    await breathe(ctx.pace);

    /* --- Oversized files ------------------------------------------------ */
    emit.activity('Checking file sizes and duplication', 0.75, functions.length);
    const huge = metrics.largestFiles.filter((f) => f.loc > 800).slice(0, 3);
    for (const file of huge) {
      const finding: RawFinding = {
        ruleId: 'maint.oversized-file',
        title: `\`${file.path.split('/').pop()}\` is ${file.loc} lines long`,
        category: 'maintainability',
        severity: file.loc > 1_500 ? 'medium' : 'low',
        confidence: 0.92,
        detectedBy: 'maintainability',
        detectors: ['ast-lite'],
        location: index.snippet(file.path, 1, 4),
        summary: `\`${file.path}\` contains ${file.loc} lines of code.`,
        impact:
          'Large files attract every change, so they concentrate merge conflicts and make review superficial.',
        evidence: [
          { kind: 'code', label: 'Size', detail: `${file.loc} lines of code`, path: file.path },
        ],
        recommendation:
          'Split along the boundaries the file already has internally — its export groups usually mark them.',
        rootCauseId: 'complexity-debt',
        references: [],
        effortMinutes: 90,
      };
      findings.push(finding);
      emit.finding(finding);
    }

    if (metrics.duplication > 0.03) {
      const finding: RawFinding = {
        ruleId: 'maint.duplication',
        title: `${(metrics.duplication * 100).toFixed(1)}% of lines are duplicated`,
        category: 'maintainability',
        severity: metrics.duplication > 0.1 ? 'medium' : 'low',
        confidence: 0.8,
        detectedBy: 'maintainability',
        detectors: ['duplication-fingerprint'],
        location: structure.duplicates[0]
          ? index.snippet(
              structure.duplicates[0].occurrences[0]!.path,
              structure.duplicates[0].occurrences[0]!.startLine,
              3,
            )
          : { path: index.files[0]?.path ?? '' },
        summary: `Roughly ${(metrics.duplication * 100).toFixed(1)}% of the analysed lines belong to a block that appears more than once.`,
        impact:
          'Every duplicated block is a place where a future fix has to be applied more than once, and where it will not be.',
        evidence: [
          {
            kind: 'tool',
            label: 'Duplication scan',
            detail: `${structure.duplicates.length} repeated blocks of ${6}+ significant lines`,
            source: 'duplication-fingerprint',
          },
        ],
        recommendation:
          'Consolidate the largest clusters first. Below about 3% duplication the cost of abstraction usually exceeds the benefit.',
        rootCauseId: 'duplicated-logic',
        references: [],
        effortMinutes: 90,
      };
      findings.push(finding);
      emit.finding(finding);
    }

    notes.push(`${(metrics.duplication * 100).toFixed(1)}% duplication`);
    notes.push(`${metrics.loc.toLocaleString('en-US')} lines analysed`);

    emit.activity(
      findings.length > 0 ? `${findings.length} maintainability issues raised` : 'Structure is within thresholds',
      1,
      functions.length,
    );
    return { findings, filesScanned: index.sources.length, notes };
  },
};
