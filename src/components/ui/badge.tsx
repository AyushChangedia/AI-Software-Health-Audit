import type { ReactNode } from 'react';
import type { CategoryId, Severity, ValidationStatus } from '@/types';
import { CATEGORY_META, SEVERITY_META, VALIDATION_META } from '@/lib/constants';
import { cn, severityClasses, validationClass } from '@/lib/utils';

export function Badge({
  children,
  className,
  tone = 'neutral',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'neutral' | 'signal' | 'healthy';
}) {
  const tones = {
    neutral: 'border-[var(--color-hairline-strong)] text-[var(--color-ink-muted)]',
    signal:
      'border-[color-mix(in_oklab,var(--color-signal)_40%,transparent)] text-[var(--color-signal-soft)] bg-[color-mix(in_oklab,var(--color-signal)_12%,transparent)]',
    healthy:
      'border-[color-mix(in_oklab,var(--color-healthy)_40%,transparent)] text-[var(--color-healthy)] bg-[color-mix(in_oklab,var(--color-healthy)_12%,transparent)]',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SeverityBadge({
  severity,
  size = 'md',
  className,
}: {
  severity: Severity;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const styles = severityClasses(severity);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-semibold uppercase tracking-wider',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]',
        styles.text,
        styles.bg,
        styles.border,
        className,
      )}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ backgroundColor: `var(--color-${severity})` }}
      />
      {SEVERITY_META[severity].label}
    </span>
  );
}

export function ValidationBadge({
  status,
  confidence,
  className,
}: {
  status: ValidationStatus;
  confidence?: number;
  className?: string;
}) {
  const meta = VALIDATION_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-[var(--color-hairline-strong)] px-2 py-1 text-[11px] font-medium',
        validationClass(status),
        className,
      )}
      title={meta.description}
    >
      <span aria-hidden>{meta.dot}</span>
      {meta.label}
      {confidence !== undefined ? (
        <span className="tabular text-[var(--color-ink-muted)]">{Math.round(confidence * 100)}%</span>
      ) : null}
    </span>
  );
}

export function CategoryBadge({ category, className }: { category: CategoryId; className?: string }) {
  const meta = CATEGORY_META[category];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-[var(--color-hairline)] bg-[var(--color-raised)] px-2 py-1 text-[11px] text-[var(--color-ink-muted)]',
        className,
      )}
    >
      <span aria-hidden>{meta.emoji}</span>
      {meta.label}
    </span>
  );
}

/** A small pill listing which agents raised a finding. */
export function DetectedBy({
  agents,
  className,
}: {
  agents: { emoji: string; name: string }[];
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {agents.map((agent) => (
        <span
          key={agent.name}
          title={agent.name}
          aria-label={agent.name}
          className="inline-flex size-5 items-center justify-center rounded-md border border-[var(--color-hairline)] bg-[var(--color-raised)] text-[11px]"
        >
          {agent.emoji}
        </span>
      ))}
    </span>
  );
}
