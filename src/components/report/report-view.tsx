'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import {
  Boxes,
  Clock,
  Download,
  FileJson,
  Github,
  MessagesSquare,
  Network,
  RotateCw,
  ShieldCheck,
} from 'lucide-react';
import type { Finding, Report, Scan } from '@/types';
import { SEVERITY_META, SEVERITIES_ORDERED } from '@/lib/constants';
import { cn, formatDuration, formatNumber, formatRelativeTime, severityColorVar } from '@/lib/utils';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { DemoBanner } from '@/components/ui/misc';
import { HealthScoreDial, CategoryBreakdown } from './health-score';
import { FindingsExplorer } from './findings-explorer';
import { Roadmap } from './roadmap';
import { ArchitectureExplorer } from './architecture-map';
import { DependencyPanel, MetricsPanel, ToolchainPanel } from './panels';
import { DebateList } from '@/components/scan/debate-panel';
import { FindingDetail } from './finding-detail';
import { ShareButton } from './share-button';

/**
 * The report.
 *
 * Structured so the first screen answers "how bad is it and what do I do
 * first", and everything else is available without leaving the page.
 */
export function ReportView({
  report,
  scan,
  readOnly = false,
}: {
  report: Report;
  scan: Scan;
  /** Shared public view: no re-scan, no workspace links. */
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState('overview');
  const [rootCauseFilter, setRootCauseFilter] = useState<string | undefined>(undefined);
  const [spotlight, setSpotlight] = useState<Finding | null>(null);
  const reducedMotion = useMotionPreference();

  const live = useMemo(
    () => report.findings.filter((f) => f.validation !== 'dismissed'),
    [report.findings],
  );

  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'findings', label: 'Findings', count: live.length },
    { id: 'roadmap', label: 'Improvement plan', count: report.plan.rootCauses.length },
    { id: 'architecture', label: 'Architecture' },
    { id: 'dependencies', label: 'Dependencies', count: report.dependencies.nodes.length },
    { id: 'debates', label: 'Debates', count: report.debates.length },
    { id: 'metrics', label: 'Metrics' },
  ];

  function showRootCause(rootCauseId: string) {
    setRootCauseFilter(rootCauseId);
    setTab('findings');
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      {report.mode === 'demo' ? <DemoBanner className="mb-5" /> : null}

      <ReportHeader report={report} scan={scan} readOnly={readOnly} />

      <div className="sticky top-14 z-30 -mx-4 mb-5 border-b border-[var(--color-hairline)] bg-[color-mix(in_oklab,var(--color-canvas)_88%,transparent)] px-4 py-2 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <Tabs items={tabs} value={tab} onChange={setTab} />
      </div>

      {tab === 'overview' ? (
        <Overview report={report} onOpenFinding={setSpotlight} onShowAll={() => setTab('findings')} />
      ) : null}

      {tab === 'findings' ? (
        <FindingsExplorer
          findings={report.findings}
          debates={report.debates}
          {...(rootCauseFilter ? { initialRootCause: rootCauseFilter } : {})}
        />
      ) : null}

      {tab === 'roadmap' ? (
        <Roadmap
          plan={report.plan}
          findings={report.findings}
          currentScore={report.score.overall}
          onFilterRootCause={showRootCause}
        />
      ) : null}

      {tab === 'architecture' ? (
        <ArchitectureExplorer map={report.architecture} findings={report.findings} />
      ) : null}

      {tab === 'dependencies' ? <DependencyPanel report={report.dependencies} /> : null}

      {tab === 'debates' ? (
        <div>
          <p className="mb-4 max-w-2xl text-pretty text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
            A debate is recorded whenever the validator found evidence that pushed against an
            agent&rsquo;s claim. The confidence attached to each finding is the outcome of these
            exchanges, not an opinion.
          </p>
          <DebateList debates={report.debates} />
        </div>
      ) : null}

      {tab === 'metrics' ? (
        <div className="space-y-3">
          <MetricsPanel metrics={report.metrics} />
          <ToolchainPanel toolchain={report.toolchain} />
        </div>
      ) : null}

      <FindingDetail
        finding={spotlight}
        {...(spotlight
          ? (() => {
              const debate = report.debates.find((d) => d.findingId === spotlight.id);
              return debate ? { debate } : {};
            })()
          : {})}
        onClose={() => setSpotlight(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ReportHeader({
  report,
  scan,
  readOnly,
}: {
  report: Report;
  scan: Scan;
  readOnly: boolean;
}) {
  const [rescanning, setRescanning] = useState(false);

  async function rescan() {
    setRescanning(true);
    try {
      const response = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          report.mode === 'demo' ? { mode: 'demo' } : { url: report.repo.url },
        ),
      });
      const body = (await response.json()) as { scan?: Scan };
      if (body.scan) {
        window.location.href = `/scan/${body.scan.id}`;
        return;
      }
    } catch {
      // Leave the button re-enabled so the user can try again.
    }
    setRescanning(false);
  }

  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow">Software health report</div>
          <h1 className="mt-2 flex items-center gap-2.5 text-2xl font-semibold tracking-tight sm:text-3xl">
            <Github className="size-6 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
            <a
              href={report.repo.url}
              target="_blank"
              rel="noreferrer noopener"
              className="truncate hover:underline"
            >
              {report.repo.slug}
            </a>
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--color-ink-muted)]">
            {report.repo.primaryLanguage ? <span>{report.repo.primaryLanguage}</span> : null}
            {report.repo.license ? <span>{report.repo.license}</span> : null}
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" aria-hidden />
              analysed in {formatDuration(report.durationMs)}
            </span>
            <span>{formatRelativeTime(report.generatedAt)}</span>
            {report.metrics.analyzedFiles ? (
              <span>{formatNumber(report.metrics.analyzedFiles)} files</span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/scans/${scan.id}/export?format=sarif`} download>
            <Button variant="outline" size="sm" icon={<ShieldCheck className="size-4" aria-hidden />}>
              SARIF
            </Button>
          </a>
          <a href={`/api/scans/${scan.id}/export?format=json`} download>
            <Button variant="outline" size="sm" icon={<FileJson className="size-4" aria-hidden />}>
              JSON
            </Button>
          </a>
          {!readOnly ? (
            <>
              <ShareButton
                scanId={scan.id}
                {...(scan.shareId ? { initialShareId: scan.shareId } : {})}
              />
              <Button
                variant="secondary"
                size="sm"
                loading={rescanning}
                onClick={() => void rescan()}
                icon={<RotateCw className="size-4" aria-hidden />}
              >
                Re-run
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */

function Overview({
  report,
  onOpenFinding,
  onShowAll,
}: {
  report: Report;
  onOpenFinding: (finding: Finding) => void;
  onShowAll: () => void;
}) {
  const reducedMotion = useMotionPreference();
  const findingById = useMemo(
    () => new Map(report.findings.map((f) => [f.id, f])),
    [report.findings],
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Panel className="flex items-center justify-center px-6 py-8">
          <HealthScoreDial score={report.score} size={250} />
        </Panel>

        <div className="grid gap-3">
          <Panel className="p-6">
            <h2 className="text-pretty text-lg font-semibold leading-snug tracking-tight">
              {report.summary.headline}
            </h2>
            <p className="mt-2.5 text-pretty text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
              {report.summary.detail}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {SEVERITIES_ORDERED.filter((s) => s !== 'info').map((severity) => {
                const count = report.summary.counts[severity];
                return (
                  <motion.span
                    key={severity}
                    initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]',
                      count > 0
                        ? 'border-[var(--color-hairline-strong)]'
                        : 'border-[var(--color-hairline)] opacity-50',
                    )}
                  >
                    <span aria-hidden>{SEVERITY_META[severity].dot}</span>
                    <span
                      className="tabular font-semibold"
                      style={{ color: count > 0 ? severityColorVar(severity) : undefined }}
                    >
                      {count}
                    </span>
                    <span className="text-[var(--color-ink-muted)]">
                      {SEVERITY_META[severity].label}
                    </span>
                  </motion.span>
                );
              })}
            </div>

            <p className="mt-5 border-t border-[var(--color-hairline)] pt-4 text-pretty text-[12.5px] leading-relaxed text-[var(--color-ink-faint)]">
              {report.summary.caveat}
            </p>
          </Panel>

          <Panel className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="eyebrow">Category scores</div>
              <span
                className="text-[11px] text-[var(--color-ink-faint)]"
                title={report.score.methodology}
              >
                weighted model
              </span>
            </div>
            <CategoryBreakdown categories={report.score.categories} />
          </Panel>
        </div>
      </div>

      {report.summary.topPriorities.length > 0 ? (
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--color-hairline)] px-5 py-4">
            <h3 className="text-sm font-semibold tracking-tight">Top priorities</h3>
            <button
              type="button"
              onClick={onShowAll}
              className="text-[12px] font-medium text-[var(--color-low)] hover:underline"
            >
              All findings →
            </button>
          </div>
          <ol className="divide-y divide-[var(--color-hairline)]">
            {report.summary.topPriorities.map((priority, index) => {
              const finding = findingById.get(priority.findingId);
              return (
                <li key={priority.findingId}>
                  <button
                    type="button"
                    onClick={() => finding && onOpenFinding(finding)}
                    className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-[var(--color-raised)]"
                  >
                    <span className="tabular w-4 shrink-0 text-[13px] font-semibold text-[var(--color-ink-faint)]">
                      {index + 1}
                    </span>
                    <span aria-hidden className="shrink-0">
                      {SEVERITY_META[priority.severity].dot}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                      {priority.title}
                    </span>
                    {finding ? (
                      <span className="mono hidden shrink-0 text-[var(--color-ink-faint)] sm:block">
                        {finding.location.path}
                        {finding.location.startLine ? `:${finding.location.startLine}` : ''}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </Panel>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <QuickCard
          icon={<Boxes className="size-4" aria-hidden />}
          title="Root causes"
          value={String(report.plan.rootCauses.length)}
          detail={`${report.plan.coveredFindings} findings trace back to them.`}
        />
        <QuickCard
          icon={<Network className="size-4" aria-hidden />}
          title="Components mapped"
          value={String(report.architecture.nodes.length)}
          detail={
            report.architecture.cycles.length > 0
              ? `${report.architecture.cycles.length} dependency ${report.architecture.cycles.length === 1 ? 'cycle' : 'cycles'} detected.`
              : 'No dependency cycles detected.'
          }
        />
        <QuickCard
          icon={<MessagesSquare className="size-4" aria-hidden />}
          title="Debates recorded"
          value={String(report.debates.length)}
          detail={`${report.findings.filter((f) => f.validation === 'dismissed').length} findings were dismissed after review.`}
        />
      </div>

      <ToolchainPanel toolchain={report.toolchain} />

      <p className="px-1 pt-2 text-pretty text-[12px] leading-relaxed text-[var(--color-ink-faint)]">
        {report.score.methodology}
      </p>
    </div>
  );
}

function QuickCard({
  icon,
  title,
  value,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <Panel className="p-5">
      <div className="flex items-center gap-2 text-[var(--color-ink-faint)]">
        {icon}
        <span className="eyebrow">{title}</span>
      </div>
      <div className="tabular mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <p className="mt-1.5 text-pretty text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
        {detail}
      </p>
    </Panel>
  );
}

/** Small link used by the dashboard and repository pages. */
export function ReportLink({ scanId, children }: { scanId: string; children: React.ReactNode }) {
  return (
    <Link
      href={`/scan/${scanId}`}
      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-low)] hover:underline"
    >
      {children}
      <Download className="size-3.5 rotate-[-90deg]" aria-hidden />
    </Link>
  );
}
