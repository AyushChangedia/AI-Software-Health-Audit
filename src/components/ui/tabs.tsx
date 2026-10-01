'use client';

import { useId, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: ReactNode;
}

/**
 * Accessible tab strip.
 *
 * Keyboard behaviour follows the WAI-ARIA tabs pattern: arrows move between
 * tabs, Home/End jump to the ends.
 */
export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const groupId = useId();

  function onKeyDown(event: React.KeyboardEvent) {
    const index = items.findIndex((item) => item.id === value);
    if (index === -1) return;
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    onChange(items[next]!.id);
  }

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn(
        '-mx-1 flex gap-1 overflow-x-auto px-1 pb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            role="tab"
            id={`${groupId}-${item.id}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={cn(
              'relative shrink-0 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
              active
                ? 'text-[var(--color-ink)]'
                : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
            )}
          >
            {active ? (
              <motion.span
                layoutId={`${groupId}-tab-bg`}
                className="absolute inset-0 rounded-lg border border-[var(--color-hairline-strong)] bg-[var(--color-raised)]"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            ) : null}
            <span className="relative inline-flex items-center gap-1.5">
              {item.icon}
              {item.label}
              {item.count !== undefined ? (
                <span className="tabular rounded px-1 text-[11px] text-[var(--color-ink-faint)]">
                  {item.count}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
