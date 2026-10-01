import type { Agent, AgentContext, AgentResult } from '../types';
import { breathe } from '../types';

/**
 * Dependency agent.
 *
 * The advisory lookup itself runs once in the orchestrator's pre-pass (it is
 * network-bound and shared with the report). This agent narrates that work and
 * owns the findings it produced.
 */
export const dependencyAgent: Agent = {
  id: 'dependencies',

  async run(ctx: AgentContext): Promise<AgentResult> {
    const { dependencies, emit, index } = ctx;
    const { report, findings } = dependencies;
    const notes: string[] = [];

    emit.activity(
      report.manifests.length > 0
        ? `Reading ${report.manifests.length} dependency ${report.manifests.length === 1 ? 'manifest' : 'manifests'}`
        : 'Looking for dependency manifests',
      0.15,
      report.manifests.length,
    );
    await breathe(ctx.pace);

    if (report.manifests.length === 0) {
      emit.activity('No dependency manifests found', 1, 0);
      notes.push('No manifests to analyse');
      return { findings: [], filesScanned: 0, notes };
    }

    emit.log(`Manifests: ${report.manifests.join(', ')}`);
    emit.activity(`Analysing ${report.nodes.length} declared packages`, 0.45, report.nodes.length);
    await breathe(ctx.pace);

    emit.activity(`Matching against ${report.advisorySource}`, 0.7, report.nodes.length);
    emit.log(
      report.live
        ? `Advisory data: live OSV.dev lookup for ${report.nodes.length} packages`
        : 'Advisory data: bundled snapshot (no outbound network access)',
    );
    await breathe(ctx.pace);

    for (const finding of findings) {
      emit.finding(finding);
    }

    /* --- Unused direct dependencies -------------------------------- */
    const unused = report.nodes.filter((n) => n.direct && !n.dev && n.usedIn.length === 0);
    if (unused.length >= 3) {
      const finding = {
        ruleId: 'dep.unused',
        title: `${unused.length} declared dependencies are never imported`,
        category: 'dependencies' as const,
        severity: 'low' as const,
        confidence: 0.65,
        detectedBy: 'dependencies' as const,
        detectors: ['manifest-parser'],
        location: { path: report.manifests[0]! },
        summary: `Sentinel found no import of ${unused
          .slice(0, 6)
          .map((n) => `\`${n.name}\``)
          .join(', ')}${unused.length > 6 ? ` and ${unused.length - 6} more` : ''}.`,
        impact:
          'Unused dependencies still install, still ship in some build setups, and still count against you when a advisory lands. They also make the real dependency surface harder to see.',
        evidence: [
          {
            kind: 'absence' as const,
            label: 'No import found',
            detail: unused.map((n) => n.name).join(', '),
          },
          {
            kind: 'reasoning' as const,
            label: 'Caveat',
            detail:
              'Detection is import-based. A package used only through a config file, a CLI binary or a plugin system will look unused here — check before removing.',
          },
        ],
        recommendation:
          'Remove the ones you can account for. Keep the rest and add a comment saying why, so the next person does not have to repeat this investigation.',
        rootCauseId: 'dependency-drift',
        references: [],
        effortMinutes: 30,
      };
      findings.push(finding);
      emit.finding(finding);
    }

    notes.push(`${report.directCount} direct dependencies`);
    notes.push(
      report.vulnerableCount > 0
        ? `${report.vulnerableCount} with known advisories`
        : 'no advisories matched',
    );
    if (report.outdatedCount > 0) notes.push(`${report.outdatedCount} behind latest`);

    emit.activity(
      report.vulnerableCount > 0
        ? `${report.vulnerableCount} vulnerable ${report.vulnerableCount === 1 ? 'package' : 'packages'}`
        : `${report.nodes.length} packages checked, no advisories matched`,
      1,
      report.nodes.length,
    );

    return { findings, filesScanned: index.manifests.length, notes };
  },
};
