'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import { Check, Package, Sparkles, TrendingUp } from 'lucide-react';
import type { Finding, ImprovementPlan, RoadmapPhase } from '@/types';
import { CATEGORY_META, SEVERITY_META } from '@/lib/constants';
import { cn, formatHourRange, pluralize, scoreColorVar, severityColorVar } from '@/lib/utils';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { CopyButton, DiffView } from '@/components/ui/code-block';
import { EmptyState } from '@/components/ui/misc';

/**
 * The improvement plan.
 *
 * The point of this screen is to replace a warning count with a decision list.
 * Every number here is computed: effort comes from the findings in each group,
 * and the projected gain is the score recomputed with those findings resolved.
 */
export function Roadmap({
  plan,
  findings,
  currentScore,
  onFilterRootCause,
  className,
}: {
  plan: ImprovementPlan;
  findings: Finding[];
  currentScore: number;
  onFilterRootCause?: (rootCauseId: string) => void;
  className?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const reducedMotion = useMotionPreference();

  const findingById = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);

  const patchable = useMemo(
    () =>
      plan.phases
        .flatMap((phase) => phase.actions)
        .map((action) => ({
          action,
          patches: action.findingIds
            .map((id) => findingById.get(id))
            .filter((f): f is Finding => Boolean(f?.patch)),
        }))
        .filter((entry) => entry.patches.length > 0),
    [plan, findingById],
  );

  const selectedPatches = patchable
    .filter((entry) => selected.has(entry.action.id))
    .flatMap((entry) => entry.patches);

  const bundle = useMemo(() => {
    if (selectedPatches.length === 0) return '';
    return selectedPatches
      .map((finding) =>
        [
          `# ${finding.title}`,
          `# ${finding.location.path}${finding.location.startLine ? `:${finding.location.startLine}` : ''}`,
          `# ${finding.patch!.description}`,
          finding.patch!.diff,
        ].join('\n'),
      )
      .join('\n\n');
  }, [selectedPatches]);

  if (plan.rootCauses.length === 0) {
    return (
      <EmptyState
        title="Nothing to plan"
        description="No findings survived validation, so there is no remediation work to sequence. That is not the same as the repository being safe — see the caveat on the overview."
        className={className}
      />
    );
  }

  const gain = plan.projectedScore - currentScore;

  return (
    <div className={cn('space-y-3', className)}>
      {/* --- Headline ------------------------------------------------ */}
      <Panel className="overflow-hidden">
        <div className="grid gap-6 p-6 md:grid-cols-[1.4fr_1fr] md:items-center">
          <div>
            <div className="eyebrow flex items-center gap-2">
              <Sparkles className="size-3.5" aria-hidden />
              Your improvement plan
            </div>
            <p className="mt-4 text-pretty text-lg leading-relaxed">
              We found{' '}
              <strong className="font-semibold">
                {plan.totalFindings} {pluralize(plan.totalFindings, 'finding')}
              </strong>
              . They originate from{' '}
              <strong className="font-semibold">
                {plan.rootCauses.length} root {pluralize(plan.rootCauses.length, 'cause')}
              </strong>
              {plan.concentration.causes > 0 && plan.concentration.causes < plan.rootCauses.length ? (
                <>
                  , and{' '}
                  <strong className="font-semibold">
                    {plan.concentration.causes} of them account for {plan.concentration.findings}
                  </strong>
                  .
                </>
              ) : (
                '.'
              )}
            </p>
            <p className="mt-2 text-pretty text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
              The phases below are ordered by what they buy you per hour of work. The projected
              score is what this same model would return with these findings resolved — it is not a
              statement about what remains undetected.
            </p>
          </div>

          <div className="flex items-center justify-start gap-6 md:justify-end">
            <div>
              <div className="eyebrow">Now</div>
              <div
                className="tabular mt-1 text-3xl font-semibold"
                style={{ color: scoreColorVar(currentScore) }}
              >
                {currentScore}
              </div>
            </div>
            <TrendingUp className="size-5 text-[var(--color-ink-faint)]" aria-hidden />
            <div>
              <div className="eyebrow">Projected</div>
              <div
                className="tabular mt-1 text-3xl font-semibold"
                style={{ color: scoreColorVar(plan.projectedScore) }}
              >
                {plan.projectedScore}
              </div>
              {gain > 0 ? (
                <div className="mt-0.5 text-[12px] font-medium text-[var(--color-healthy)]">
                  +{gain} points
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Panel>

      {/* --- Phases -------------------------------------------------- */}
      {plan.phases.map((phase, index) => (
        <PhaseCard
          key={phase.id}
          phase={phase}
          index={index}
          reducedMotion={Boolean(reducedMotion)}
          selected={selected}
          patchableIds={new Set(patchable.map((entry) => entry.action.id))}
          onToggle={(actionId) =>
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(actionId)) next.delete(actionId);
              else next.add(actionId);
              return next;
            })
          }
          {...(onFilterRootCause ? { onFilterRootCause } : {})}
        />
      ))}

      {/* --- Patch bundle -------------------------------------------- */}
      {patchable.length > 0 ? (
        <Panel className="overflow-hidden">
          <div className="border-b border-[var(--color-hairline)] px-5 py-4">
            <h3 className="text-sm font-semibold tracking-tight">Generate a patch</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              Select the fixes you want and Sentinel assembles the diffs into one bundle for you to
              review. It never writes to your repository — applying the change is always your call.
            </p>
          </div>

          <div className="px-5 py-4">
            <ul className="space-y-1.5">
              {patchable.map((entry) => (
                <li key={entry.action.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--color-raised)]">
                    <input
                      type="checkbox"
                      checked={selected.has(entry.action.id)}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(entry.action.id)) next.delete(entry.action.id);
                          else next.add(entry.action.id);
                          return next;
                        })
                      }
                      className="mt-0.5 size-4 shrink-0 accent-[var(--color-signal)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{entry.action.title}</span>
                      <span className="mono mt-0.5 block text-[var(--color-ink-faint)]">
                        {entry.patches.length} {pluralize(entry.patches.length, 'patch', 'patches')}
                        {' · '}
                        {entry.patches
                          .slice(0, 2)
                          .map((f) => f.patch!.path)
                          .join(', ')}
                      </span>
                    </span>
                    <span
                      className="shrink-0 text-[11px] font-semibold uppercase tracking-wider"
                      style={{ color: severityColorVar(entry.action.severity) }}
                    >
                      {SEVERITY_META[entry.action.severity].label}
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant={selectedPatches.length > 0 ? 'primary' : 'secondary'}
                size="sm"
                disabled={selectedPatches.length === 0}
                icon={selectedPatches.length > 0 ? <Check className="size-4" aria-hidden /> : undefined}
              >
                {selectedPatches.length === 0
                  ? 'Select fixes to generate a patch'
                  : `${selectedPatches.length} ${pluralize(selectedPatches.length, 'patch', 'patches')} ready`}
              </Button>
              {bundle ? <CopyButton value={bundle} label="Copy patch bundle" /> : null}
            </div>

            {bundle ? (
              <div className="mt-4">
                <DiffView diff={bundle} />
                <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-medium)]">
                  Review every hunk before applying. Patches derived from a matched line are marked
                  as needing review in the finding detail.
                </p>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {/* --- Recommendations ----------------------------------------- */}
      {plan.dependencyRecommendations.length > 0 ? (
        <Panel className="overflow-hidden">
          <div className="border-b border-[var(--color-hairline)] px-5 py-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Package className="size-4 text-[var(--color-ink-faint)]" aria-hidden />
              Suggested libraries
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              Each of these is suggested because of a specific finding, with the alternatives worth
              weighing. Sentinel never installs anything.
            </p>
          </div>
          <ul className="divide-y divide-[var(--color-hairline)]">
            {plan.dependencyRecommendations.map((recommendation) => (
              <li key={`${recommendation.ecosystem}-${recommendation.name}`} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h4 className="text-[14px] font-semibold tracking-tight">{recommendation.name}</h4>
                  <span className="mono text-[var(--color-ink-faint)]">{recommendation.ecosystem}</span>
                  {recommendation.url ? (
                    <a
                      href={recommendation.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="ml-auto text-[12px] text-[var(--color-low)] hover:underline"
                    >
                      Documentation
                    </a>
                  ) : null}
                </div>

                <dl className="mt-3 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-[auto_1fr]">
                  <dt className="eyebrow pt-0.5">Reason</dt>
                  <dd className="text-pretty leading-relaxed text-[var(--color-ink-muted)]">
                    {recommendation.reason}
                  </dd>

                  <dt className="eyebrow pt-0.5">Current issue</dt>
                  <dd className="text-pretty leading-relaxed text-[var(--color-ink-muted)]">
                    {recommendation.currentIssue}
                  </dd>

                  <dt className="eyebrow pt-0.5">Alternatives</dt>
                  <dd className="text-[var(--color-ink-muted)]">
                    {recommendation.alternatives.join(' · ')}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function PhaseCard({
  phase,
  index,
  reducedMotion,
  selected,
  patchableIds,
  onToggle,
  onFilterRootCause,
}: {
  phase: RoadmapPhase;
  index: number;
  reducedMotion: boolean;
  selected: Set<string>;
  patchableIds: Set<string>;
  onToggle: (actionId: string) => void;
  onFilterRootCause?: (rootCauseId: string) => void;
}) {
  const meta = CATEGORY_META[phase.theme];

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
    >
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-hairline)] px-5 py-4">
          <div className="min-w-0">
            <div className="eyebrow">Phase {phase.order}</div>
            <h3 className="mt-1.5 flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              <span aria-hidden>{meta.emoji}</span>
              {phase.title}
            </h3>
            <p className="mt-1.5 max-w-xl text-pretty text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              {phase.summary}
            </p>
          </div>
          <dl className="flex gap-6 text-right">
            <div>
              <dt className="eyebrow">Effort</dt>
              <dd className="tabular mt-1 text-[13px] font-medium">
                {formatHourRange(phase.effortHours)}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Score gain</dt>
              <dd className="tabular mt-1 text-[13px] font-medium text-[var(--color-healthy)]">
                +{phase.expectedScoreGain.toFixed(1)}
              </dd>
            </div>
          </dl>
        </div>

        <ul className="divide-y divide-[var(--color-hairline)]">
          {phase.actions.map((action) => (
            <li key={action.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start gap-3">
                <span
                  aria-hidden
                  className="mt-1.5 size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: severityColorVar(action.severity) }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-[14px] font-semibold tracking-tight">{action.title}</h4>
                    <span className="rounded border border-[var(--color-hairline)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-ink-faint)]">
                      {action.findingIds.length} {pluralize(action.findingIds.length, 'finding')}
                    </span>
                  </div>
                  <p className="mt-1.5 text-pretty text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                    {action.detail}
                  </p>

                  <div className="mt-2.5 flex flex-wrap items-center gap-3">
                    {onFilterRootCause ? (
                      <button
                        type="button"
                        onClick={() => onFilterRootCause(action.rootCauseId)}
                        className="text-[12px] font-medium text-[var(--color-low)] hover:underline"
                      >
                        Show these findings
                      </button>
                    ) : null}
                    {patchableIds.has(action.id) ? (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--color-ink-muted)]">
                        <input
                          type="checkbox"
                          checked={selected.has(action.id)}
                          onChange={() => onToggle(action.id)}
                          className="size-3.5 accent-[var(--color-signal)]"
                        />
                        Include in patch
                      </label>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </motion.div>
  );
}
