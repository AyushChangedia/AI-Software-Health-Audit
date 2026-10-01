'use client';

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import { cn, scoreColorVar } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export function ProgressBar({
  value,
  className,
  color,
  label,
}: {
  /** 0..1 */
  value: number;
  className?: string;
  color?: string;
  label?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-hairline)]', className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color ?? 'var(--color-signal)' }}
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 22 }}
      />
    </div>
  );
}

/** Horizontal score bar used for category breakdowns. */
export function ScoreBar({ score, className }: { score: number; className?: string }) {
  return <ProgressBar value={score / 100} color={scoreColorVar(score)} className={className} />;
}

/* ------------------------------------------------------------------ */
/* Animated number                                                     */
/* ------------------------------------------------------------------ */

export function useCountUp(target: number, durationMs = 1_200) {
  const reduced = useMotionPreference();
  return { target, durationMs, reduced };
}

/* ------------------------------------------------------------------ */
/* Empty + loading states                                              */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--color-hairline-strong)] px-6 py-14 text-center',
        className,
      )}
    >
      {icon ? <div className="mb-4 text-[var(--color-ink-faint)]">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-pretty text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-[var(--color-hairline)]', className)}
      aria-hidden
    />
  );
}

/* ------------------------------------------------------------------ */
/* Stat                                                                */
/* ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="eyebrow">{label}</div>
      <div
        className="tabular mt-1.5 text-2xl font-semibold tracking-tight"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-[12px] text-[var(--color-ink-muted)]">{hint}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Demo notice                                                         */
/* ------------------------------------------------------------------ */

export function DemoBanner({ detail, className }: { detail?: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-[13px]',
        'border-[color-mix(in_oklab,var(--color-signal)_35%,transparent)]',
        'bg-[color-mix(in_oklab,var(--color-signal)_10%,transparent)]',
        className,
      )}
      role="note"
    >
      <span className="rounded-md bg-[var(--color-signal)] px-2 py-0.5 text-[10px] font-bold tracking-widest text-white">
        DEMO DATA
      </span>
      <span className="text-[var(--color-ink-muted)]">
        {detail ??
          'These results come from running the real Sentinel pipeline over a bundled sample repository, not over your code.'}
      </span>
    </div>
  );
}
