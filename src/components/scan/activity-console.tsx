'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import { ArrowDownToLine } from 'lucide-react';
import type { ConsoleEntry } from '@/hooks/use-scan-stream';
import { AGENTS } from '@/lib/constants';
import { cn, formatClock, severityColorVar } from '@/lib/utils';

/**
 * Live analysis console.
 *
 * Auto-follows the tail, but stops the moment the reader scrolls up — being
 * yanked back to the bottom while reading is the fastest way to make a live
 * log useless. A button appears to re-attach.
 */
export function ActivityConsole({
  entries,
  className,
  height = 340,
}: {
  entries: ConsoleEntry[];
  className?: string;
  height?: number;
}) {
  const reducedMotion = useMotionPreference();
  const containerRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    if (!following) return;
    const element = containerRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [entries, following]);

  function onScroll() {
    const element = containerRef.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
    setFollowing(atBottom);
  }

  // Only the last few entries animate in; replaying 200 on mount would be a
  // firework show and would cost a layout pass per row.
  const animateFrom = Math.max(0, entries.length - 6);

  return (
    <div className={cn('relative', className)}>
      <div
        ref={containerRef}
        onScroll={onScroll}
        style={{ height }}
        className="overflow-y-auto overscroll-contain px-1 py-1"
        role="log"
        aria-live="polite"
        aria-label="Live analysis console"
      >
        {entries.length === 0 ? (
          <p className="px-3 py-6 text-[13px] text-[var(--color-ink-faint)]">
            Waiting for the first agent to report…
          </p>
        ) : null}

        <AnimatePresence initial={false}>
          {entries.map((entry, index) => {
            const agent = AGENTS[entry.agentId];
            const shouldAnimate = !reducedMotion && index >= animateFrom;
            return (
              <motion.div
                key={entry.id}
                initial={shouldAnimate ? { opacity: 0, y: 6 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className={cn(
                  'flex gap-2.5 rounded-md px-2.5 py-1.5',
                  entry.kind === 'error' && 'bg-[color-mix(in_oklab,var(--color-critical)_9%,transparent)]',
                  entry.kind === 'finding' && 'bg-[color-mix(in_oklab,var(--color-high)_6%,transparent)]',
                )}
              >
                <time className="mono shrink-0 pt-px text-[var(--color-ink-faint)]" dateTime={entry.at}>
                  {formatClock(entry.at)}
                </time>
                <span aria-hidden className="shrink-0 pt-px text-[13px] leading-[1.3]">
                  {agent.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mr-2 text-[12px] font-medium text-[var(--color-ink)]">
                    {agent.name}
                  </span>
                  <span
                    className="text-[12px] leading-relaxed text-[var(--color-ink-muted)]"
                    style={
                      entry.severity && entry.kind === 'finding'
                        ? { color: severityColorVar(entry.severity) }
                        : undefined
                    }
                  >
                    {entry.message}
                  </span>
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {!following ? (
        <button
          type="button"
          onClick={() => {
            setFollowing(true);
            const element = containerRef.current;
            if (element) element.scrollTop = element.scrollHeight;
          }}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--color-hairline-strong)] bg-[var(--color-raised)] px-3 py-1.5 text-[11px] font-medium shadow-lg"
        >
          <ArrowDownToLine className="size-3.5" aria-hidden />
          Follow live
        </button>
      ) : null}
    </div>
  );
}
