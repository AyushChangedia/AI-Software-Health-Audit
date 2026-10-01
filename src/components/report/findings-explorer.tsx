'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { CategoryId, Debate, Finding, Severity } from '@/types';
import type { SortKey } from '@/lib/findings/filter';
import { filterFindings } from '@/lib/findings/filter';
import { AGENTS, CATEGORY_META, SEVERITIES_ORDERED, SEVERITY_META } from '@/lib/constants';
import { cn, severityColorVar } from '@/lib/utils';
import { Panel } from '@/components/ui/panel';
import { SeverityBadge, ValidationBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/misc';
import { FindingDetail } from './finding-detail';

/**
 * Findings explorer.
 *
 * Filtering runs against the full list in memory — a scan of a large monorepo
 * can produce thousands of findings, so the list renders incrementally rather
 * than mounting every row at once.
 */

const PAGE = 40;

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'severity', label: 'Severity' },
  { id: 'confidence', label: 'Confidence' },
  { id: 'file', label: 'File' },
  { id: 'category', label: 'Category' },
];

export function FindingsExplorer({
  findings,
  debates,
  initialRootCause,
  className,
}: {
  findings: Finding[];
  debates: Debate[];
  initialRootCause?: string;
  className?: string;
}) {
  const [search, setSearch] = useState('');
  const [severities, setSeverities] = useState<Severity[]>([]);
  const [categories, setCategories] = useState<CategoryId[]>([]);
  const [sort, setSort] = useState<SortKey>('severity');
  const [showDismissed, setShowDismissed] = useState(false);
  const [rootCause, setRootCause] = useState(initialRootCause);
  const [visible, setVisible] = useState(PAGE);
  const [selected, setSelected] = useState<Finding | null>(null);

  const debateFor = useMemo(() => {
    const map = new Map<string, Debate>();
    for (const debate of debates) map.set(debate.findingId, debate);
    return map;
  }, [debates]);

  const filtered = useMemo(
    () =>
      filterFindings(findings, {
        search,
        severities,
        categories,
        sort,
        hideDismissed: !showDismissed,
        ...(rootCause ? { rootCauseId: rootCause } : {}),
      }),
    [findings, search, severities, categories, sort, showDismissed, rootCause],
  );

  useEffect(() => setVisible(PAGE), [search, severities, categories, sort, showDismissed, rootCause]);

  const severityCounts = useMemo(() => {
    const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const finding of findings) {
      if (finding.validation === 'dismissed' && !showDismissed) continue;
      counts[finding.severity] += 1;
    }
    return counts;
  }, [findings, showDismissed]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<CategoryId, number>();
    for (const finding of findings) {
      if (finding.validation === 'dismissed' && !showDismissed) continue;
      counts.set(finding.category, (counts.get(finding.category) ?? 0) + 1);
    }
    return counts;
  }, [findings, showDismissed]);

  const dismissedCount = findings.filter((f) => f.validation === 'dismissed').length;
  const hasFilters =
    search !== '' || severities.length > 0 || categories.length > 0 || Boolean(rootCause);

  function toggle<T>(list: T[], value: T, setter: (next: T[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  return (
    <div className={className}>
      {/* --- Controls ------------------------------------------------ */}
      <Panel className="mb-3 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative flex min-w-[220px] flex-1 items-center">
              <Search
                className="pointer-events-none absolute left-3 size-4 text-[var(--color-ink-faint)]"
                aria-hidden
              />
              <span className="sr-only">Search findings</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search findings, files, rules…"
                className="h-9 w-full rounded-lg border border-[var(--color-hairline-strong)] bg-[var(--color-canvas)] pl-9 pr-3 text-[13px] outline-none transition-colors placeholder:text-[var(--color-ink-faint)] focus:border-[color-mix(in_oklab,var(--color-signal)_50%,transparent)]"
              />
            </label>

            <label className="flex items-center gap-2 text-[12px] text-[var(--color-ink-muted)]">
              <SlidersHorizontal className="size-3.5" aria-hidden />
              <span className="sr-only sm:not-sr-only">Sort</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
                className="h-9 rounded-lg border border-[var(--color-hairline-strong)] bg-[var(--color-canvas)] px-2 text-[13px] text-[var(--color-ink)] outline-none focus:border-[color-mix(in_oklab,var(--color-signal)_50%,transparent)]"
              >
                {SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {dismissedCount > 0 ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-hairline-strong)] px-3 py-2 text-[12px] text-[var(--color-ink-muted)]">
                <input
                  type="checkbox"
                  checked={showDismissed}
                  onChange={(event) => setShowDismissed(event.target.checked)}
                  className="size-3.5 accent-[var(--color-signal)]"
                />
                Show {dismissedCount} dismissed
              </label>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {SEVERITIES_ORDERED.map((severity) => {
              const count = severityCounts[severity];
              if (count === 0) return null;
              const active = severities.includes(severity);
              return (
                <FilterChip
                  key={severity}
                  active={active}
                  color={severityColorVar(severity)}
                  onClick={() => toggle(severities, severity, setSeverities)}
                >
                  <span aria-hidden>{SEVERITY_META[severity].dot}</span>
                  {SEVERITY_META[severity].label}
                  <span className="tabular opacity-60">{count}</span>
                </FilterChip>
              );
            })}

            <span aria-hidden className="mx-1 h-4 w-px bg-[var(--color-hairline-strong)]" />

            {[...categoryCounts.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([category, count]) => {
                const active = categories.includes(category);
                return (
                  <FilterChip
                    key={category}
                    active={active}
                    onClick={() => toggle(categories, category, setCategories)}
                  >
                    <span aria-hidden>{CATEGORY_META[category].emoji}</span>
                    {CATEGORY_META[category].label}
                    <span className="tabular opacity-60">{count}</span>
                  </FilterChip>
                );
              })}

            {hasFilters ? (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setSeverities([]);
                  setCategories([]);
                  setRootCause(undefined);
                }}
                className="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
              >
                <X className="size-3" aria-hidden />
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </Panel>

      <p className="mb-3 px-1 text-[12px] text-[var(--color-ink-muted)]" aria-live="polite">
        {filtered.length} of {findings.length} findings
        {rootCause ? ' · filtered to one root cause' : ''}
      </p>

      {/* --- List ---------------------------------------------------- */}
      {filtered.length === 0 ? (
        <EmptyState
          title="Nothing matches those filters"
          description="Try widening the severity range or clearing the search."
        />
      ) : (
        <>
          <ul className="space-y-2">
            {filtered.slice(0, visible).map((finding, index) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                index={index}
                onOpen={() => setSelected(finding)}
              />
            ))}
          </ul>
          {visible < filtered.length ? (
            <LoadMore
              remaining={filtered.length - visible}
              onVisible={() => setVisible((current) => current + PAGE)}
            />
          ) : null}
        </>
      )}

      <FindingDetail
        finding={selected}
        {...(selected && debateFor.get(selected.id) ? { debate: debateFor.get(selected.id)! } : {})}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function FilterChip({
  children,
  active,
  color,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
        active
          ? 'border-[var(--color-hairline-strong)] bg-[var(--color-raised)] text-[var(--color-ink)]'
          : 'border-transparent text-[var(--color-ink-muted)] hover:bg-[var(--color-raised)]',
      )}
      style={active && color ? { color, borderColor: `color-mix(in oklab, ${color} 40%, transparent)` } : undefined}
    >
      {children}
    </button>
  );
}

function FindingCard({
  finding,
  index,
  onOpen,
}: {
  finding: Finding;
  index: number;
  onOpen: () => void;
}) {
  const reducedMotion = useMotionPreference();
  const dismissed = finding.validation === 'dismissed';

  return (
    <motion.li
      initial={reducedMotion || index > 12 ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.02, duration: 0.2 }}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'panel panel-hover group relative block w-full overflow-hidden p-4 text-left',
          dismissed && 'opacity-60',
        )}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ backgroundColor: severityColorVar(finding.severity) }}
        />

        <div className="flex flex-wrap items-center gap-2 pl-1.5">
          <SeverityBadge severity={finding.severity} size="sm" />
          <ValidationBadge status={finding.validation} confidence={finding.confidence} />
          <span className="ml-auto flex items-center gap-1">
            {finding.detectedBy.map((agent) => (
              <span key={agent} title={`Detected by ${AGENTS[agent].name}`} className="text-[13px]">
                {AGENTS[agent].emoji}
              </span>
            ))}
            {finding.validatedBy ? (
              <span title="Reviewed by the Validator" className="text-[13px]">
                {AGENTS.validator.emoji}
              </span>
            ) : null}
          </span>
        </div>

        <h3 className="mt-2.5 text-pretty pl-1.5 text-[14px] font-semibold leading-snug tracking-tight">
          {finding.title}
        </h3>

        <p className="mono mt-1 pl-1.5 text-[var(--color-ink-faint)]">
          {finding.location.path}
          {finding.location.startLine ? `:${finding.location.startLine}` : ''}
          {finding.otherLocations.length > 0 ? (
            <span className="ml-2 text-[var(--color-ink-faint)]">
              +{finding.otherLocations.length} more
            </span>
          ) : null}
        </p>

        <p className="mt-2 line-clamp-2 text-pretty pl-1.5 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          {finding.summary}
        </p>

        <span className="mt-3 inline-flex items-center gap-1 pl-1.5 text-[12px] font-medium text-[var(--color-ink-muted)] transition-colors group-hover:text-[var(--color-ink)]">
          View finding
          <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </span>
      </button>
    </motion.li>
  );
}

/** Renders the next page when the sentinel scrolls into view. */
function LoadMore({ remaining, onVisible }: { remaining: number; onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onVisible();
      },
      { rootMargin: '400px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [onVisible]);

  return (
    <div ref={ref} className="py-6 text-center text-[12px] text-[var(--color-ink-faint)]">
      Loading {Math.min(PAGE, remaining)} more of {remaining}…
    </div>
  );
}
