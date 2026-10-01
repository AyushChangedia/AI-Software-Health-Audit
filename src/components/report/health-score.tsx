'use client';

import { useEffect, useState } from 'react';
import { animate, motion } from 'framer-motion';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import type { CategoryScore, HealthScore } from '@/types';
import { CATEGORY_META, PRODUCT } from '@/lib/constants';
import { cn, scoreColorVar, scoreLabel } from '@/lib/utils';

/**
 * The Sentinel Software Health Score.
 *
 * A ring, not a gauge. A gauge implies a calibrated instrument with an agreed
 * scale; this is our weighted model and the surrounding copy says so. The
 * spokes outside the ring are the eight category scores, so the shape of the
 * mark itself tells you where the weakness is before you read a number.
 */
export function HealthScoreDial({
  score,
  size = 260,
  className,
  animateOnMount = true,
}: {
  score: HealthScore;
  size?: number;
  className?: string;
  animateOnMount?: boolean;
}) {
  const reducedMotion = useMotionPreference();
  // The first render must be identical on the server and the client, so it
  // always shows the real score. The count-up starts afterwards, and only
  // when motion is allowed — branching on `useMotionPreference()` during render
  // is a hydration mismatch, because it resolves to null on the server.
  const [displayed, setDisplayed] = useState(score.overall);

  useEffect(() => {
    if (!animateOnMount || reducedMotion) {
      setDisplayed(score.overall);
      return;
    }
    const controls = animate(0, score.overall, {
      duration: 1.4,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (value) => setDisplayed(Math.round(value)),
    });
    return () => controls.stop();
  }, [score.overall, animateOnMount, reducedMotion]);

  const stroke = 6;
  const ringRadius = size / 2 - stroke * 5;
  const circumference = 2 * Math.PI * ringRadius;
  const color = scoreColorVar(score.overall);

  const categories = [...score.categories].sort((a, b) => b.weight - a.weight);

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${PRODUCT.scoreName}: ${score.overall} out of 100`}
        >
          {/* Category spokes, outermost. */}
          <g>
            {categories.map((category, index) => {
              const angle = (index / categories.length) * Math.PI * 2 - Math.PI / 2;
              const inner = ringRadius + stroke * 2.4;
              const outer = inner + (category.score / 100) * (stroke * 2.6) + 2;
              const cx = size / 2;
              const cy = size / 2;
              return (
                <motion.line
                  key={category.category}
                  x1={cx + Math.cos(angle) * inner}
                  y1={cy + Math.sin(angle) * inner}
                  x2={cx + Math.cos(angle) * outer}
                  y2={cy + Math.sin(angle) * outer}
                  stroke={scoreColorVar(category.score)}
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  opacity={0.75}
                  initial={reducedMotion || !animateOnMount ? false : { pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.75 }}
                  transition={{ delay: 0.5 + index * 0.05, duration: 0.4 }}
                />
              );
            })}
          </g>

          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={ringRadius}
            fill="none"
            stroke="var(--color-hairline)"
            strokeWidth={stroke}
          />

          {/* Value */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={ringRadius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            initial={
              reducedMotion || !animateOnMount
                ? false
                : { strokeDashoffset: circumference }
            }
            animate={{ strokeDashoffset: circumference * (1 - score.overall / 100) }}
            transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
            style={{
              strokeDashoffset: circumference * (1 - score.overall / 100),
              filter: `drop-shadow(0 0 10px color-mix(in oklab, ${color} 45%, transparent))`,
            }}
          />
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div
            className="tabular text-[3.25rem] font-semibold leading-none tracking-[-0.04em]"
            style={{ color }}
          >
            {displayed}
          </div>
          <div className="mt-1 text-[11px] font-medium tracking-[0.14em] text-[var(--color-ink-faint)]">
            / 100
          </div>
          <div className="mt-2 text-[12px] font-medium text-[var(--color-ink-muted)]">
            {scoreLabel(score.overall)}
          </div>
        </div>
      </div>

      <div className="mt-4 text-center">
        <div className="eyebrow">{PRODUCT.scoreName}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Category breakdown                                                  */
/* ------------------------------------------------------------------ */

export function CategoryBreakdown({
  categories,
  onSelect,
  selected,
  className,
}: {
  categories: CategoryScore[];
  onSelect?: (category: CategoryScore) => void;
  selected?: string;
  className?: string;
}) {
  const reducedMotion = useMotionPreference();

  return (
    <ul className={cn('space-y-px', className)}>
      {categories.map((category, index) => {
        const meta = CATEGORY_META[category.category];
        const color = scoreColorVar(category.score);
        const Element = onSelect ? 'button' : 'div';

        return (
          <li key={category.category}>
            <Element
              {...(onSelect
                ? {
                    type: 'button' as const,
                    onClick: () => onSelect(category),
                    'aria-pressed': selected === category.category,
                  }
                : {})}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                onSelect && 'hover:bg-[var(--color-raised)]',
                selected === category.category && 'bg-[var(--color-raised)]',
              )}
              title={category.rationale}
            >
              <span aria-hidden className="w-5 shrink-0 text-center text-[13px]">
                {meta.emoji}
              </span>
              <span className="w-[124px] shrink-0 truncate text-[13px] font-medium">
                {meta.label}
              </span>

              <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-hairline)]">
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ backgroundColor: color }}
                  initial={reducedMotion ? false : { width: 0 }}
                  animate={{ width: `${category.score}%` }}
                  transition={{ delay: 0.15 + index * 0.06, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                />
              </span>

              <span className="tabular w-8 shrink-0 text-right text-[13px] font-semibold" style={{ color }}>
                {category.score}
              </span>
              <span className="tabular hidden w-12 shrink-0 text-right text-[11px] text-[var(--color-ink-faint)] sm:block">
                {Math.round(category.weight * 100)}%
              </span>
            </Element>
          </li>
        );
      })}
    </ul>
  );
}
