'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import type { ScanHistoryPoint } from '@/types';
import { formatRelativeTime, scoreColorVar } from '@/lib/utils';

/**
 * Health trend.
 *
 * Hand-drawn SVG rather than a chart library: one series, fixed axes, and a
 * hover readout is the whole requirement. Importing a charting runtime for
 * that would cost more than the page it sits on.
 */
export function HealthTrend({
  history,
  height = 180,
  className,
}: {
  history: ScanHistoryPoint[];
  height?: number;
  className?: string;
}) {
  const reducedMotion = useMotionPreference();
  const [hover, setHover] = useState<number | null>(null);

  const width = 720;
  const padding = { top: 16, right: 16, bottom: 28, left: 32 };

  const geometry = useMemo(() => {
    if (history.length === 0) return null;
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const step = history.length > 1 ? innerW / (history.length - 1) : 0;

    const points = history.map((point, index) => ({
      point,
      x: padding.left + step * index,
      y: padding.top + innerH * (1 - point.score / 100),
    }));

    const line = points
      .map((p, index) => `${index === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');

    const area = `${line} L ${points.at(-1)!.x.toFixed(1)} ${height - padding.bottom} L ${points[0]!.x.toFixed(1)} ${height - padding.bottom} Z`;

    return { points, line, area, innerH };
  }, [history, height, padding.bottom, padding.left, padding.right, padding.top]);

  if (!geometry || history.length === 0) {
    return (
      <p className={className}>
        <span className="text-[13px] text-[var(--color-ink-faint)]">
          Run a second scan to see how the score moves.
        </span>
      </p>
    );
  }

  const latest = history.at(-1)!;
  const previous = history.at(-2);
  const delta = previous ? latest.score - previous.score : 0;
  const active = hover !== null ? geometry.points[hover] : null;

  return (
    <div className={className}>
      <div className="mb-3 flex items-baseline gap-3">
        <span
          className="tabular text-3xl font-semibold tracking-tight"
          style={{ color: scoreColorVar(latest.score) }}
        >
          {latest.score}
        </span>
        {previous ? (
          <span
            className="tabular text-[13px] font-medium"
            style={{
              color:
                delta > 0
                  ? 'var(--color-healthy)'
                  : delta < 0
                    ? 'var(--color-critical)'
                    : 'var(--color-ink-faint)',
            }}
          >
            {delta > 0 ? '↑ +' : delta < 0 ? '↓ ' : ''}
            {delta === 0 ? 'no change' : Math.abs(delta)}
          </span>
        ) : null}
        <span className="text-[12px] text-[var(--color-ink-faint)]">
            across {history.length} {history.length === 1 ? 'scan' : 'scans'}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Health score trend: ${history.map((h) => `scan ${h.index} scored ${h.score}`).join(', ')}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={scoreColorVar(latest.score)} stopOpacity="0.22" />
            <stop offset="100%" stopColor={scoreColorVar(latest.score)} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 50, 100].map((value) => {
          const y = padding.top + geometry.innerH * (1 - value / 100);
          return (
            <g key={value}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="var(--color-hairline)"
                strokeWidth={1}
              />
              <text x={4} y={y + 3.5} fontSize={10} fill="var(--color-ink-faint)">
                {value}
              </text>
            </g>
          );
        })}

        <motion.path
          d={geometry.area}
          fill="url(#trend-fill)"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        />
        <motion.path
          d={geometry.line}
          fill="none"
          stroke={scoreColorVar(latest.score)}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reducedMotion ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />

        {geometry.points.map((entry, index) => (
          <g key={entry.point.scanId}>
            <circle
              cx={entry.x}
              cy={entry.y}
              r={hover === index ? 5 : 3.5}
              fill="var(--color-canvas)"
              stroke={scoreColorVar(entry.point.score)}
              strokeWidth={2}
            />
            {/* Generous hit area for pointer and touch. */}
            <rect
              x={entry.x - 16}
              y={padding.top}
              width={32}
              height={geometry.innerH}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
              onFocus={() => setHover(index)}
              tabIndex={0}
              role="button"
              aria-label={`Scan ${entry.point.index}: ${entry.point.score} out of 100`}
            />
          </g>
        ))}
      </svg>

      <div className="mt-2 min-h-[36px] text-[12px]">
        {active ? (
          <p className="text-[var(--color-ink-muted)]">
            <span className="font-medium text-[var(--color-ink)]">
              Scan #{active.point.index} · {active.point.score}/100
            </span>
            {' — '}
            {active.point.criticalCount} critical, {active.point.highCount} high ·{' '}
            {formatRelativeTime(active.point.at)}
          </p>
        ) : (
          <p className="text-[var(--color-ink-faint)]">
            Hover a point for the counts at that scan.
          </p>
        )}
      </div>
    </div>
  );
}
