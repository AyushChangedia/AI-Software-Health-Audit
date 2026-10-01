'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import { ChevronDown, MessagesSquare } from 'lucide-react';
import type { Debate, DebateStance, DebateTurn } from '@/types';
import { AGENTS, VALIDATION_META } from '@/lib/constants';
import { cn, validationClass } from '@/lib/utils';
import { EmptyState } from '@/components/ui/misc';

/**
 * Agent debate.
 *
 * Every turn here is a real signal the validator evaluated — a mitigating
 * control it found, a reachability check it ran, the strongest counter-argument
 * it could construct. The transcript exists so a reader can disagree with the
 * confidence number on the same evidence the system used.
 */

const STANCE_LABEL: Record<DebateStance, string> = {
  claim: 'Claim',
  challenge: 'Challenge',
  rebuttal: 'Rebuttal',
  test: 'Test',
  verdict: 'Verdict',
};

const STANCE_STYLE: Record<DebateStance, { accent: string; align: 'left' | 'right' }> = {
  claim: { accent: 'var(--color-high)', align: 'left' },
  challenge: { accent: 'var(--color-validator)', align: 'right' },
  rebuttal: { accent: 'var(--color-high)', align: 'left' },
  test: { accent: 'var(--color-signal)', align: 'right' },
  verdict: { accent: 'var(--color-healthy)', align: 'right' },
};

export function DebateList({
  debates,
  className,
  defaultOpen = 1,
}: {
  debates: Debate[];
  className?: string;
  defaultOpen?: number;
}) {
  if (debates.length === 0) {
    return (
      <EmptyState
        icon={<MessagesSquare className="size-6" aria-hidden />}
        title="No disagreements yet"
        description="A debate is recorded when the validator finds evidence that contradicts an agent's claim. Quiet here means every finding so far survived its checks unchallenged."
        className={className}
      />
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {debates.map((debate, index) => (
        <DebateCard key={debate.id} debate={debate} defaultOpen={index < defaultOpen} />
      ))}
    </div>
  );
}

export function DebateCard({ debate, defaultOpen = false }: { debate: Debate; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const reducedMotion = useMotionPreference();
  const { outcome } = debate;
  const delta = outcome.confidenceAfter - outcome.confidenceBefore;

  return (
    <div className="panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--color-raised)]"
      >
        <span className="mt-0.5 flex shrink-0 -space-x-1.5">
          {[...new Set(debate.turns.map((turn) => turn.agent))].slice(0, 3).map((agent) => (
            <span
              key={agent}
              title={AGENTS[agent].name}
              className="inline-flex size-6 items-center justify-center rounded-full border border-[var(--color-hairline-strong)] bg-[var(--color-panel)] text-[11px]"
            >
              {AGENTS[agent].emoji}
            </span>
          ))}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold tracking-tight">
            {debate.topic}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className={validationClass(outcome.status)}>
              {VALIDATION_META[outcome.status].dot} {VALIDATION_META[outcome.status].label}
            </span>
            <span className="tabular text-[var(--color-ink-faint)]">
              {Math.round(outcome.confidenceBefore * 100)}% → {Math.round(outcome.confidenceAfter * 100)}%
            </span>
            <span
              className="tabular font-medium"
              style={{
                color:
                  delta > 0.01
                    ? 'var(--color-healthy)'
                    : delta < -0.01
                      ? 'var(--color-high)'
                      : 'var(--color-ink-faint)',
              }}
            >
              {delta >= 0 ? '+' : ''}
              {Math.round(delta * 100)} pts
            </span>
            <span className="text-[var(--color-ink-faint)]">
              {debate.turns.length} {debate.turns.length === 1 ? 'turn' : 'turns'}
            </span>
          </span>
        </span>

        <ChevronDown
          aria-hidden
          className={cn(
            'mt-0.5 size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={reducedMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reducedMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden border-t border-[var(--color-hairline)]"
          >
            <ol className="space-y-3 px-4 py-4">
              {debate.turns.map((turn, index) => (
                <DebateTurnRow
                  key={index}
                  turn={turn}
                  index={index}
                  last={index === debate.turns.length - 1}
                  reducedMotion={Boolean(reducedMotion)}
                />
              ))}
            </ol>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function DebateTurnRow({
  turn,
  index,
  last,
  reducedMotion,
}: {
  turn: DebateTurn;
  index: number;
  last: boolean;
  reducedMotion: boolean;
}) {
  const agent = AGENTS[turn.agent];
  const style = STANCE_STYLE[turn.stance];

  return (
    <motion.li
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.24 }}
      className="relative flex gap-3"
    >
      {/* Thread line connecting the turns. */}
      {!last ? (
        <span
          aria-hidden
          className="absolute left-[13px] top-8 h-[calc(100%+0.75rem)] w-px bg-[var(--color-hairline)]"
        />
      ) : null}

      <span
        className="relative z-10 mt-0.5 inline-flex size-[27px] shrink-0 items-center justify-center rounded-full border bg-[var(--color-panel)] text-[12px]"
        style={{ borderColor: `color-mix(in oklab, ${style.accent} 45%, transparent)` }}
        title={agent.name}
      >
        {agent.emoji}
      </span>

      <div
        className="min-w-0 flex-1 rounded-lg border px-3.5 py-2.5"
        style={{
          borderColor: `color-mix(in oklab, ${style.accent} 26%, transparent)`,
          backgroundColor: `color-mix(in oklab, ${style.accent} 6%, transparent)`,
        }}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[12px] font-semibold">{agent.name}</span>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: style.accent }}
          >
            {STANCE_LABEL[turn.stance]}
          </span>
          {turn.confidence !== undefined ? (
            <span className="tabular ml-auto text-[11px] text-[var(--color-ink-faint)]">
              {Math.round(turn.confidence * 100)}% confident
            </span>
          ) : null}
        </div>

        <p className="mt-1.5 text-pretty text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          {turn.message}
        </p>

        {turn.citation ? (
          <p className="mono mt-2 text-[var(--color-ink-faint)]">
            {turn.citation.path}
            {turn.citation.line ? `:${turn.citation.line}` : ''}
          </p>
        ) : null}
      </div>
    </motion.li>
  );
}
