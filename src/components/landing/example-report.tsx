import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { Report } from '@/types';
import { SEVERITY_META, AGENTS } from '@/lib/constants';
import { Panel, SectionHeading } from '@/components/ui/panel';
import { SeverityBadge, ValidationBadge } from '@/components/ui/badge';
import { HealthScoreDial, CategoryBreakdown } from '@/components/report/health-score';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/utils';

/**
 * Example report.
 *
 * Rendered from a real run of the pipeline over the bundled sample repository,
 * so these numbers are computed rather than written. If the engine gets better
 * or worse, this section moves with it.
 */
export function ExampleReport({ report }: { report: Report | null }) {
  if (!report) return null;

  const counts = report.summary.counts;
  const top = report.findings
    .filter((f) => f.validation !== 'dismissed')
    .slice(0, 3);

  return (
    <section id="report" className="scroll-mt-20 border-y border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <div className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6">
        <SectionHeading
          eyebrow="Example report"
          title="What comes out the other side."
          description={`Produced by running the full pipeline over the bundled sample repository — ${formatNumber(report.metrics.analyzedFiles)} files, ${formatNumber(report.metrics.loc)} lines, ${report.findings.length} findings after deduplication. Labelled DEMO DATA everywhere it appears.`}
          action={
            <Link href="/demo">
              <Button variant="outline" size="sm" iconRight={<ArrowUpRight className="size-4" aria-hidden />}>
                Watch it run
              </Button>
            </Link>
          }
        />

        <div className="grid gap-3 lg:grid-cols-[minmax(0,380px)_1fr]">
          <Panel className="flex flex-col items-center justify-center px-6 py-8">
            <HealthScoreDial score={report.score} size={220} animateOnMount={false} />
            <div className="mt-6 flex w-full flex-wrap justify-center gap-2">
              {(['critical', 'high', 'medium', 'low'] as const).map((severity) => (
                <span
                  key={severity}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-hairline)] px-2 py-1 text-[12px] text-[var(--color-ink-muted)]"
                >
                  <span aria-hidden>{SEVERITY_META[severity].dot}</span>
                  <span className="tabular font-semibold text-[var(--color-ink)]">
                    {counts[severity]}
                  </span>
                  {SEVERITY_META[severity].label}
                </span>
              ))}
            </div>
          </Panel>

          <div className="grid gap-3">
            <Panel className="p-5">
              <div className="eyebrow mb-3">Category breakdown</div>
              <CategoryBreakdown categories={report.score.categories} />
            </Panel>

            <Panel className="overflow-hidden">
              <div className="border-b border-[var(--color-hairline)] px-5 py-3">
                <div className="eyebrow">Top findings</div>
              </div>
              <ul className="divide-y divide-[var(--color-hairline)]">
                {top.map((finding) => (
                  <li key={finding.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={finding.severity} size="sm" />
                      <ValidationBadge status={finding.validation} confidence={finding.confidence} />
                      <span className="ml-auto inline-flex gap-1">
                        {finding.detectedBy.map((agent) => (
                          <span key={agent} title={AGENTS[agent].name} aria-label={AGENTS[agent].name}>
                            {AGENTS[agent].emoji}
                          </span>
                        ))}
                      </span>
                    </div>
                    <h3 className="mt-2 text-[14px] font-semibold tracking-tight">{finding.title}</h3>
                    <p className="mono mt-1 text-[var(--color-ink-faint)]">
                      {finding.location.path}
                      {finding.location.startLine ? `:${finding.location.startLine}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>

        <Panel className="mt-3 p-5">
          <div className="eyebrow mb-3">Improvement plan</div>
          <p className="text-pretty text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
            We found {report.plan.totalFindings} findings. They originate from{' '}
            <span className="font-semibold text-[var(--color-ink)]">
              {report.plan.rootCauses.length} root causes
            </span>
            . Working the plan end to end projects a score of{' '}
            <span className="font-semibold text-[var(--color-ink)]">{report.plan.projectedScore}</span>,
            up from {report.score.overall}.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {report.plan.phases.slice(0, 4).map((phase) => (
              <span
                key={phase.id}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-raised)] px-3 py-1.5 text-[12px]"
              >
                <span className="text-[var(--color-ink-faint)]">Phase {phase.order}</span>
                <span className="font-medium">{phase.title}</span>
                <span className="tabular text-[var(--color-ink-faint)]">
                  +{phase.expectedScoreGain.toFixed(1)}
                </span>
              </span>
            ))}
          </div>
        </Panel>
      </div>
    </section>
  );
}
