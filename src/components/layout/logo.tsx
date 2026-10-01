import { cn } from '@/lib/utils';

/**
 * The Sentinel mark: a shield outline built from a scanning aperture.
 * Drawn rather than imported so it inherits colour and stays crisp at any size.
 */
export function SentinelMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn('size-6', className)}
      aria-hidden
      focusable="false"
    >
      <path
        d="M12 2.5 4.5 5.4v6.1c0 4.6 3.1 8.8 7.5 10 4.4-1.2 7.5-5.4 7.5-10V5.4L12 2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11" r="3.1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12 7.9v6.2M8.9 11h6.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <SentinelMark className="size-[22px] text-[var(--color-signal-soft)]" />
      <span className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
        Sentinel
      </span>
    </span>
  );
}
