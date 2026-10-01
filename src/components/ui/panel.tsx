import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Panel({
  className,
  interactive,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return <div className={cn('panel', interactive && 'panel-hover', className)} {...props} />;
}

export function PanelHeader({
  title,
  description,
  action,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-hairline)] px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        <h2 className="text-sm font-semibold tracking-tight text-[var(--color-ink)]">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow ? <div className="eyebrow mb-2">{eyebrow}</div> : null}
        <h2 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
        {description ? (
          <p className="mt-2 text-pretty text-sm leading-relaxed text-[var(--color-ink-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
