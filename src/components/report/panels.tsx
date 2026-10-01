'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, CircleSlash, ExternalLink } from 'lucide-react';
import type {
  CodebaseMetrics,
  DependencyNode,
  DependencyReport,
  ToolchainStatus,
} from '@/types';
import { cn, formatNumber, formatPercent, severityColorVar, truncateMiddle } from '@/lib/utils';
import { Panel } from '@/components/ui/panel';
import { SeverityBadge } from '@/components/ui/badge';
import { EmptyState, Stat } from '@/components/ui/misc';

/* ------------------------------------------------------------------ */
/* Dependencies                                                        */
/* ------------------------------------------------------------------ */

export function DependencyPanel({
  report,
  className,
}: {
  report: DependencyReport;
  className?: string;
}) {
  const [selected, setSelected] = useState<DependencyNode | null>(null);

  if (report.nodes.length === 0) {
    return (
      <EmptyState
        title="No dependency manifests found"
        description="Sentinel reads package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml and Gemfile. None of those are present in this repository."
        className={className}
      />
    );
  }

  return (
    <div className={cn('grid gap-3 lg:grid-cols-[1fr_340px]', className)}>
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-hairline)] px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">Dependency health</h3>
            <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">
              {report.directCount} direct · {report.vulnerableCount} with advisories ·{' '}
              {report.outdatedCount} behind latest
            </p>
          </div>
          <span
            className={cn(
              'rounded-md border px-2 py-1 text-[11px]',
              report.live
                ? 'border-[color-mix(in_oklab,var(--color-healthy)_35%,transparent)] text-[var(--color-healthy)]'
                : 'border-[var(--color-hairline-strong)] text-[var(--color-ink-muted)]',
            )}
            title={report.advisorySource}
          >
            {report.live ? 'Live OSV data' : 'Offline advisory snapshot'}
          </span>
        </div>

        <ul className="max-h-[560px] divide-y divide-[var(--color-hairline)] overflow-y-auto">
          {report.nodes.map((node) => (
            <li key={`${node.ecosystem}:${node.name}`}>
              <button
                type="button"
                onClick={() => setSelected(node)}
                className={cn(
                  'flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--color-raised)]',
                  selected?.name === node.name && 'bg-[var(--color-raised)]',
                )}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: node.risk
                      ? severityColorVar(node.risk)
                      : 'var(--color-hairline-strong)',
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{node.name}</span>
                  <span className="mono mt-0.5 block text-[var(--color-ink-faint)]">
                    {node.version}
                    {node.latest && node.latest !== node.version ? ` → ${node.latest}` : ''}
                    {node.dev ? ' · dev' : ''}
                  </span>
                </span>
                {node.advisories.length > 0 ? (
                  <span className="shrink-0 rounded border border-[color-mix(in_oklab,var(--color-critical)_35%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-critical)]">
                    {node.advisories.length}{' '}
                    {node.advisories.length === 1 ? 'advisory' : 'advisories'}
                  </span>
                ) : node.majorsBehind && node.majorsBehind > 0 ? (
                  <span className="shrink-0 text-[11px] text-[var(--color-medium)]">
                    {node.majorsBehind} major behind
                  </span>
                ) : (
                  <CheckCircle2
                    className="size-3.5 shrink-0 text-[color-mix(in_oklab,var(--color-healthy)_70%,transparent)]"
                    aria-label="No advisories matched"
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className="h-fit overflow-hidden">
        <div className="border-b border-[var(--color-hairline)] px-4 py-3">
          <div className="eyebrow">{selected ? selected.name : 'Select a package'}</div>
        </div>
        {selected ? (
          <dl className="space-y-3 px-4 py-4 text-[13px]">
            <Row label="Version" value={selected.version} mono />
            <Row label="Latest" value={selected.latest ?? 'unknown'} mono />
            <Row label="Ecosystem" value={selected.ecosystem} />
            <Row label="Scope" value={selected.dev ? 'development' : 'runtime'} />
            <Row label="Licence" value={selected.license ?? 'not reported'} />
            <Row
              label="Maintenance"
              value={selected.maintenance === 'unknown' ? 'not assessed' : selected.maintenance}
            />
            <div>
              <dt className="eyebrow mb-1.5">Used in</dt>
              <dd>
                {selected.usedIn.length === 0 ? (
                  <span className="text-[var(--color-ink-faint)]">
                    No import found. It may be used via config or a CLI binary.
                  </span>
                ) : (
                  <ul className="space-y-1">
                    {selected.usedIn.map((path) => (
                      <li key={path} className="mono truncate text-[var(--color-ink-muted)]">
                        {truncateMiddle(path, 40)}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            {selected.advisories.length > 0 ? (
              <div>
                <dt className="eyebrow mb-1.5">Advisories</dt>
                <dd className="space-y-2">
                  {selected.advisories.map((advisory) => (
                    <div
                      key={advisory.id}
                      className="rounded-lg border border-[color-mix(in_oklab,var(--color-critical)_25%,transparent)] bg-[color-mix(in_oklab,var(--color-critical)_6%,transparent)] p-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={advisory.severity} size="sm" />
                        <span className="mono text-[var(--color-ink-faint)]">{advisory.id}</span>
                      </div>
                      <p className="mt-1.5 text-pretty text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
                        {advisory.title}
                      </p>
                      {advisory.fixedIn ? (
                        <p className="mt-1 text-[12px] text-[var(--color-healthy)]">
                          Fixed in {advisory.fixedIn}
                        </p>
                      ) : null}
                      {advisory.url ? (
                        <a
                          href={advisory.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-[var(--color-low)] hover:underline"
                        >
                          Advisory
                          <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : null}
                    </div>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="px-4 py-6 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
            Choose a package to see its version, licence, advisories and where it is imported.
          </p>
        )}
      </Panel>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[var(--color-ink-faint)]">{label}</dt>
      <dd className={cn('text-right text-[var(--color-ink-muted)]', mono && 'mono')}>{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Codebase metrics                                                    */
/* ------------------------------------------------------------------ */

export function MetricsPanel({
  metrics,
  className,
}: {
  metrics: CodebaseMetrics;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-3', className)}>
      <Panel className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
        <Stat label="Files analysed" value={formatNumber(metrics.analyzedFiles)} hint={`${formatNumber(metrics.skippedFiles)} skipped`} />
        <Stat label="Lines of code" value={formatNumber(metrics.loc)} />
        <Stat
          label="Test ratio"
          value={formatPercent(metrics.testRatio)}
          hint={`${metrics.testFiles} test files`}
          tone={metrics.testRatio < 0.15 ? 'var(--color-high)' : undefined}
        />
        <Stat
          label="Duplication"
          value={formatPercent(metrics.duplication, 1)}
          tone={metrics.duplication > 0.1 ? 'var(--color-high)' : undefined}
        />
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel className="p-5">
          <div className="eyebrow mb-4">Languages</div>
          {metrics.languages.length === 0 ? (
            <p className="text-[13px] text-[var(--color-ink-faint)]">No source languages detected.</p>
          ) : (
            <>
              <div className="mb-4 flex h-2 overflow-hidden rounded-full">
                {metrics.languages.map((language, index) => (
                  <motion.span
                    key={language.name}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(1, language.share * 100)}%` }}
                    transition={{ delay: index * 0.05, duration: 0.5 }}
                    style={{
                      backgroundColor: [
                        'var(--color-signal)',
                        'var(--color-validator)',
                        'var(--color-healthy)',
                        'var(--color-medium)',
                        'var(--color-high)',
                        'var(--color-low)',
                        'var(--color-ink-faint)',
                        'var(--color-hairline-strong)',
                      ][index % 8],
                    }}
                    title={`${language.name} ${formatPercent(language.share)}`}
                  />
                ))}
              </div>
              <ul className="space-y-1.5">
                {metrics.languages.map((language, index) => (
                  <li key={language.name} className="flex items-center gap-2.5 text-[13px]">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: [
                          'var(--color-signal)',
                          'var(--color-validator)',
                          'var(--color-healthy)',
                          'var(--color-medium)',
                          'var(--color-high)',
                          'var(--color-low)',
                          'var(--color-ink-faint)',
                          'var(--color-hairline-strong)',
                        ][index % 8],
                      }}
                    />
                    <span className="flex-1 truncate">{language.name}</span>
                    <span className="tabular text-[var(--color-ink-faint)]">
                      {formatNumber(language.loc)} loc
                    </span>
                    <span className="tabular w-10 text-right text-[var(--color-ink-muted)]">
                      {formatPercent(language.share)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel className="p-5">
          <div className="eyebrow mb-4">Structure</div>
          <dl className="space-y-3 text-[13px]">
            <Row label="Mean function complexity" value={String(metrics.avgComplexity)} />
            <Row label="Highest complexity" value={String(metrics.maxComplexity)} />
            <Row label="Unused exports" value={formatNumber(metrics.deadCodeCount)} />
            <Row
              label="Reported coverage"
              value={metrics.coverage !== undefined ? formatPercent(metrics.coverage) : 'not published'}
            />
          </dl>

          <div className="mt-5">
            <div className="eyebrow mb-2">Largest files</div>
            <ul className="space-y-1">
              {metrics.largestFiles.slice(0, 6).map((file) => (
                <li key={file.path} className="flex items-baseline gap-3 text-[12px]">
                  <span className="mono min-w-0 flex-1 truncate text-[var(--color-ink-muted)]">
                    {truncateMiddle(file.path, 44)}
                  </span>
                  <span className="tabular shrink-0 text-[var(--color-ink-faint)]">
                    {formatNumber(file.loc)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>

      {metrics.truncated ? (
        <Panel className="flex items-start gap-3 border-[color-mix(in_oklab,var(--color-medium)_32%,transparent)] p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-medium)]" aria-hidden />
          <p className="text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
            This repository exceeded the per-scan file limit, so the analysis covered a subset.
            Raise <span className="mono">SCAN_MAX_FILES</span> on your own instance for full
            coverage.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toolchain                                                           */
/* ------------------------------------------------------------------ */

export function ToolchainPanel({
  toolchain,
  className,
}: {
  toolchain: ToolchainStatus[];
  className?: string;
}) {
  return (
    <Panel className={cn('overflow-hidden', className)}>
      <div className="border-b border-[var(--color-hairline)] px-5 py-4">
        <h3 className="text-sm font-semibold tracking-tight">What ran</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          A report is only as trustworthy as the tools behind it. This is exactly which analyzers
          produced the findings above, and which were unavailable.
        </p>
      </div>
      <ul className="divide-y divide-[var(--color-hairline)]">
        {toolchain.map((tool) => (
          <li key={tool.name} className="flex items-start gap-3 px-5 py-3.5">
            {tool.available ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--color-healthy)]" aria-hidden />
            ) : (
              <CircleSlash className="mt-0.5 size-4 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium">{tool.name}</span>
                <span className="rounded border border-[var(--color-hairline)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                  {tool.kind}
                </span>
              </div>
              <p className="mt-1 text-pretty text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
                {tool.detail}
              </p>
            </div>
            <span
              className={cn(
                'ml-auto shrink-0 text-[11px] font-medium',
                tool.available ? 'text-[var(--color-healthy)]' : 'text-[var(--color-ink-faint)]',
              )}
            >
              {tool.available ? 'ran' : 'unavailable'}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
