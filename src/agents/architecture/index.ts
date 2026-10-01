import type { RawFinding } from '@/types';
import type { Agent, AgentContext, AgentResult } from '../types';
import { breathe, checkAborted } from '../types';
import { findLayerViolations } from '@/lib/analysis/graph';

/**
 * Architecture agent.
 *
 * Works on the module graph rather than on text, so its findings are structural
 * facts (this import cycle exists) rather than pattern guesses.
 */
export const architectureAgent: Agent = {
  id: 'architecture',

  async run(ctx: AgentContext): Promise<AgentResult> {
    const { index, graph, emit, signal } = ctx;
    const findings: RawFinding[] = [];
    const notes: string[] = [];

    const moduleCount = graph.nodes.size;
    const edgeCount = [...graph.nodes.values()].reduce(
      (sum, node) => sum + node.imports.filter((i) => i.resolved).length,
      0,
    );

    emit.activity(`Mapping ${moduleCount} modules and ${edgeCount} internal imports`, 0.2, moduleCount);
    emit.log(`Module graph: ${moduleCount} nodes, ${edgeCount} edges`);
    await breathe(ctx.pace);
    checkAborted(signal);

    /* --- Circular dependencies ------------------------------------ */
    emit.activity('Searching for dependency cycles', 0.4, moduleCount);
    for (const cycle of graph.cycles.slice(0, 5)) {
      const chain = [...cycle, cycle[0]!].join(' → ');
      const finding: RawFinding = {
        ruleId: 'arch.circular-dependency',
        title: `Circular dependency between ${cycle.length} modules`,
        category: 'architecture',
        severity: cycle.length > 3 ? 'high' : 'medium',
        confidence: 0.95,
        detectedBy: 'architecture',
        detectors: ['module-graph'],
        location: index.snippet(cycle[0]!, 1, 3),
        otherLocations: cycle.slice(1).map((path) => ({ path })),
        summary: `These modules import each other in a cycle: ${chain}`,
        impact:
          'Cycles make initialisation order undefined — one module sees a partially-initialised import and gets `undefined` at runtime. They also block tree-shaking and make the group impossible to test or extract in isolation.',
        evidence: [
          {
            kind: 'code',
            label: 'Cycle',
            detail: chain,
            path: cycle[0]!,
            source: 'module-graph',
          },
          {
            kind: 'reasoning',
            label: 'How this was found',
            detail:
              'Import statements were resolved to repository paths and the resulting directed graph was decomposed into strongly connected components. Every module listed can reach every other module listed.',
          },
        ],
        recommendation:
          'Break the cycle by extracting the shared contract (types, interfaces, constants) into a module that both sides import, and letting dependencies point one way only.',
        rootCauseId: 'module-coupling',
        references: [],
        effortMinutes: 90,
      };
      findings.push(finding);
      emit.finding(finding);
    }
    if (graph.cycles.length > 0) {
      emit.log(`${graph.cycles.length} dependency ${graph.cycles.length === 1 ? 'cycle' : 'cycles'} detected`);
    }
    notes.push(`${graph.cycles.length} cycles found`);
    await breathe(ctx.pace);
    checkAborted(signal);

    /* --- Layering ------------------------------------------------- */
    emit.activity('Checking layer boundaries', 0.6, moduleCount);
    const violations = findLayerViolations(graph);
    const grouped = new Map<string, typeof violations>();
    for (const violation of violations) {
      const bucket = grouped.get(violation.label) ?? [];
      bucket.push(violation);
      grouped.set(violation.label, bucket);
    }

    for (const [label, group] of grouped) {
      const first = group[0]!;
      const finding: RawFinding = {
        ruleId: 'arch.layer-violation',
        title: `Layer boundary crossed: ${label}`,
        category: 'architecture',
        severity: 'medium',
        confidence: 0.75,
        detectedBy: 'architecture',
        detectors: ['module-graph'],
        location: index.snippet(first.from, first.line, 2),
        otherLocations: group.slice(1, 5).map((v) => ({ path: v.from, startLine: v.line })),
        summary: `${group.length} ${group.length === 1 ? 'module' : 'modules'} cross a layer boundary — ${label}. The first is \`${first.from}:${first.line}\` importing \`${first.to}\`.`,
        impact:
          'When a layer reaches past its neighbour, the boundary stops being enforceable: swapping the implementation behind it becomes a repository-wide change, and the lower layer can no longer be tested independently.',
        evidence: group.slice(0, 4).map((v) => ({
          kind: 'code' as const,
          label: 'Import',
          detail: `${v.from} imports ${v.to}`,
          path: v.from,
          line: v.line,
          source: 'module-graph',
        })),
        recommendation:
          'Route the access through the layer that owns it — a service or repository function — so the boundary has one crossing point instead of many.',
        rootCauseId: 'layer-leakage',
        references: [],
        effortMinutes: 120,
      };
      findings.push(finding);
      emit.finding(finding);
    }
    notes.push(`${violations.length} layer crossings`);
    await breathe(ctx.pace);

    /* --- Oversized modules ---------------------------------------- */
    emit.activity('Measuring module responsibilities', 0.8, moduleCount);
    const godFiles = [...graph.nodes.values()]
      .map((node) => ({ node, file: index.file(node.path) }))
      .filter(
        (entry): entry is { node: (typeof entry)['node']; file: NonNullable<(typeof entry)['file']> } =>
          Boolean(entry.file) && entry.file!.loc > 500 && entry.node.exports.length >= 12,
      )
      .sort((a, b) => b.file.loc - a.file.loc)
      .slice(0, 4);

    for (const { node, file } of godFiles) {
      const finding: RawFinding = {
        ruleId: 'arch.god-module',
        title: `\`${file.base}\` carries ${node.exports.length} exports across ${file.loc} lines`,
        category: 'architecture',
        severity: file.loc > 1_000 ? 'high' : 'medium',
        confidence: 0.85,
        detectedBy: 'architecture',
        detectors: ['module-graph'],
        location: index.snippet(file.path, 1, 4),
        summary: `\`${file.path}\` exports ${node.exports.length} symbols and is imported by ${node.importedBy.length} ${node.importedBy.length === 1 ? 'module' : 'modules'}. A module this broad has no single reason to change.`,
        impact:
          'Every consumer depends on the whole file, so unrelated changes force unrelated rebuilds and reviews. Merge conflicts concentrate here, and the file becomes the thing nobody wants to touch.',
        evidence: [
          {
            kind: 'code',
            label: 'Module size',
            detail: `${file.loc} lines of code, ${node.exports.length} exports, ${node.importedBy.length} importers`,
            path: file.path,
            source: 'module-graph',
          },
          {
            kind: 'code',
            label: 'Exported symbols',
            detail: node.exports.slice(0, 12).join(', '),
            path: file.path,
          },
        ],
        recommendation:
          'Split along the seams the export names already suggest, and keep the original path as a re-export while callers migrate.',
        rootCauseId: 'module-coupling',
        references: [],
        effortMinutes: 150,
      };
      findings.push(finding);
      emit.finding(finding);
    }

    notes.push(`${moduleCount} modules mapped`);
    emit.activity(
      findings.length > 0 ? `${findings.length} structural issues raised` : 'Module structure looks coherent',
      1,
      moduleCount,
    );
    return { findings, filesScanned: moduleCount, notes };
  },
};
