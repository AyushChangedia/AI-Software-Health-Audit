import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Severity, ValidationStatus } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

export function formatHourRange([min, max]: [number, number]): string {
  if (min === max) return `${min} ${min === 1 ? 'hour' : 'hours'}`;
  return `${min}–${max} hours`;
}

/* ------------------------------------------------------------------ */
/* Severity + validation styling                                       */
/* ------------------------------------------------------------------ */

const SEVERITY_CLASSES: Record<Severity, { text: string; bg: string; border: string; ring: string }> =
  {
    critical: {
      text: 'text-[var(--color-critical)]',
      bg: 'bg-[color-mix(in_oklab,var(--color-critical)_14%,transparent)]',
      border: 'border-[color-mix(in_oklab,var(--color-critical)_38%,transparent)]',
      ring: 'shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-critical)_30%,transparent)]',
    },
    high: {
      text: 'text-[var(--color-high)]',
      bg: 'bg-[color-mix(in_oklab,var(--color-high)_14%,transparent)]',
      border: 'border-[color-mix(in_oklab,var(--color-high)_38%,transparent)]',
      ring: 'shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-high)_30%,transparent)]',
    },
    medium: {
      text: 'text-[var(--color-medium)]',
      bg: 'bg-[color-mix(in_oklab,var(--color-medium)_14%,transparent)]',
      border: 'border-[color-mix(in_oklab,var(--color-medium)_34%,transparent)]',
      ring: 'shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-medium)_26%,transparent)]',
    },
    low: {
      text: 'text-[var(--color-low)]',
      bg: 'bg-[color-mix(in_oklab,var(--color-low)_14%,transparent)]',
      border: 'border-[color-mix(in_oklab,var(--color-low)_34%,transparent)]',
      ring: 'shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-low)_26%,transparent)]',
    },
    info: {
      text: 'text-[var(--color-info)]',
      bg: 'bg-[color-mix(in_oklab,var(--color-info)_14%,transparent)]',
      border: 'border-[color-mix(in_oklab,var(--color-info)_30%,transparent)]',
      ring: '',
    },
  };

export function severityClasses(severity: Severity) {
  return SEVERITY_CLASSES[severity];
}

export function severityColorVar(severity: Severity): string {
  return `var(--color-${severity})`;
}

const VALIDATION_CLASSES: Record<ValidationStatus, string> = {
  confirmed: 'text-[var(--color-healthy)]',
  likely: 'text-[var(--color-medium)]',
  potential: 'text-[var(--color-low)]',
  dismissed: 'text-[var(--color-ink-faint)]',
};

export function validationClass(status: ValidationStatus): string {
  return VALIDATION_CLASSES[status];
}

/**
 * Score colour ramp. Anything under 50 is red; 50–69 orange; 70–84 amber;
 * 85+ green. Used by the radial score and every category bar.
 */
export function scoreColorVar(score: number): string {
  if (score >= 85) return 'var(--color-healthy)';
  if (score >= 70) return 'var(--color-medium)';
  if (score >= 50) return 'var(--color-high)';
  return 'var(--color-critical)';
}

export function scoreLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Healthy';
  if (score >= 70) return 'Fair';
  if (score >= 50) return 'At risk';
  return 'Critical';
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

export function truncateMiddle(text: string, max = 48): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 1) / 2);
  return `${text.slice(0, half)}…${text.slice(text.length - half)}`;
}

/** Groups an array by a derived key, preserving insertion order. */
export function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}
