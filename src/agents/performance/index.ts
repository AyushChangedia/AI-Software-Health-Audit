import type { RawFinding } from '@/types';
import type { Agent, AgentContext, AgentResult } from '../types';
import { breathe, checkAborted } from '../types';
import { runPatternRules } from '@/lib/analysis/rule-engine';
import { PERFORMANCE_RULES } from '@/lib/analysis/rules/performance';

export const performanceAgent: Agent = {
  id: 'performance',

  async run(ctx: AgentContext): Promise<AgentResult> {
    const { index, structure, emit, signal } = ctx;
    const findings: RawFinding[] = [];
    const notes: string[] = [];

    const sources = index.sources;
    emit.activity(`Profiling ${sources.length} source files statically`, 0.2, 0);
    await breathe(ctx.pace);

    const dataAccess = index.find((f) =>
      /(prisma|knex|sequelize|typeorm|mongoose|drizzle|sqlalchemy|SELECT\s|\.query\(|findMany|find_one)/i.test(
        f.content,
      ),
    );
    emit.activity(
      dataAccess.length > 0
        ? `Tracing data access in ${dataAccess.length} ${dataAccess.length === 1 ? 'module' : 'modules'}`
        : 'Looking for data access paths',
      0.45,
      sources.length,
    );
    if (dataAccess.length > 0) emit.log(`Data access modules: ${dataAccess.length}`);
    await breathe(ctx.pace);
    checkAborted(signal);

    emit.activity('Checking query and loop shapes', 0.7, sources.length);
    const { findings: ruleFindings } = runPatternRules(index, PERFORMANCE_RULES);
    for (const finding of ruleFindings) {
      findings.push(finding);
      emit.finding(finding);
    }
    checkAborted(signal);

    /* --- Deeply nested hot functions -------------------------------- */
    const heavy = structure.functions
      .filter((f) => f.maxNesting >= 5 && f.complexity >= 18)
      .sort((a, b) => b.complexity - a.complexity)
      .slice(0, 3);

    for (const fn of heavy) {
      const finding: RawFinding = {
        ruleId: 'perf.deep-branching',
        title: `\`${fn.name}()\` branches ${fn.complexity} ways across ${fn.maxNesting} levels`,
        category: 'performance',
        severity: 'low',
        confidence: 0.7,
        detectedBy: 'performance',
        detectors: ['ast-lite'],
        location: index.snippet(fn.path, fn.startLine, 4),
        summary: `\`${fn.name}()\` in \`${fn.path}\` has ${fn.complexity} decision points nested up to ${fn.maxNesting} deep over ${fn.lines} lines.`,
        impact:
          'Deeply nested branching defeats branch prediction and makes the function impossible to reason about when profiling. It is usually where unnecessary repeated work hides.',
        evidence: [
          {
            kind: 'code',
            label: 'Structure',
            detail: `${fn.lines} lines, complexity ${fn.complexity}, max nesting ${fn.maxNesting}, ${fn.parameters} parameters`,
            path: fn.path,
            line: fn.startLine,
            source: 'ast-lite',
          },
        ],
        recommendation:
          'Flatten with early returns and lift invariant work out of the inner branches. Measure before and after — this is a readability win first and a performance win second.',
        rootCauseId: 'complex-hot-paths',
        references: [],
        effortMinutes: 60,
      };
      findings.push(finding);
      emit.finding(finding);
    }

    notes.push(`${dataAccess.length} data-access modules traced`);
    notes.push(`mean complexity ${structure.metrics.avgComplexity}`);

    emit.activity(
      findings.length > 0 ? `${findings.length} performance risks raised` : 'No scaling hazards surfaced',
      1,
      sources.length,
    );
    return { findings, filesScanned: sources.length, notes };
  },
};
