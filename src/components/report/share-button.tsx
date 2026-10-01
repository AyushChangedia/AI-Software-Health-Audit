'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import { Check, Globe, Link2, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ScanError } from '@/types';

/**
 * Publishing a report.
 *
 * Deliberately a two-step action with the consequence stated before the link
 * exists: publishing makes the findings — including the file paths and code
 * excerpts they quote — readable by anyone with the URL. That is a decision,
 * not a convenience, so the button says what it does before it does it.
 */
export function ShareButton({
  scanId,
  initialShareId,
}: {
  scanId: string;
  initialShareId?: string;
}) {
  const reducedMotion = useMotionPreference();
  const [open, setOpen] = useState(false);
  const [shareId, setShareId] = useState(initialShareId);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<ScanError | null>(null);

  const url = shareId
    ? `${typeof window === 'undefined' ? '' : window.location.origin}/s/${shareId}`
    : null;

  async function publish() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/scans/${scanId}/share`, { method: 'POST' });
      const body = (await response.json()) as { shareId?: string; error?: ScanError };
      if (!response.ok || !body.shareId) {
        setError(
          body.error ?? { code: 'internal', message: 'Could not create the link.', retryable: true },
        );
      } else {
        setShareId(body.shareId);
      }
    } catch {
      setError({ code: 'network', message: 'Could not reach Sentinel.', retryable: true });
    }
    setPending(false);
  }

  async function revoke() {
    setPending(true);
    try {
      await fetch(`/api/scans/${scanId}/share`, { method: 'DELETE' });
      setShareId(undefined);
    } catch {
      setError({ code: 'network', message: 'Could not revoke the link.', retryable: true });
    }
    setPending(false);
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_800);
    } catch {
      setError({
        code: 'unsupported',
        message: 'Your browser blocked clipboard access.',
        hint: 'Select the link and copy it manually.',
        retryable: false,
      });
    }
  }

  return (
    <div className="relative">
      <Button
        variant={shareId ? 'secondary' : 'outline'}
        size="sm"
        icon={shareId ? <Globe className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {shareId ? 'Shared' : 'Share'}
      </Button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="panel absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] p-4 shadow-2xl"
            role="dialog"
            aria-label="Share this report"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[13px] font-semibold">
                {shareId ? 'This report is public' : 'Publish this report'}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="-mr-1 -mt-1 inline-flex size-6 items-center justify-center rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>

            {shareId && url ? (
              <>
                <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
                  Anyone with this link can read the report, including the file paths and code
                  excerpts it quotes.
                </p>
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--color-hairline-strong)] bg-[var(--color-canvas)] px-2.5 py-2">
                  <span className="mono min-w-0 flex-1 truncate text-[var(--color-ink-muted)]">
                    {url}
                  </span>
                  <button
                    type="button"
                    onClick={() => void copy()}
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors',
                      copied
                        ? 'text-[var(--color-healthy)]'
                        : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                    )}
                  >
                    {copied ? (
                      <span className="inline-flex items-center gap-1">
                        <Check className="size-3" aria-hidden />
                        Copied
                      </span>
                    ) : (
                      'Copy'
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void revoke()}
                  disabled={pending}
                  className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-[var(--color-critical)] hover:underline disabled:opacity-60"
                >
                  {pending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                  Revoke this link
                </button>
              </>
            ) : (
              <>
                <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
                  This creates an unguessable URL that anyone can open — no sign-in. The report
                  quotes source from the repository, so only publish what is already public.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-3 w-full"
                  loading={pending}
                  onClick={() => void publish()}
                >
                  Create public link
                </Button>
              </>
            )}

            {error ? (
              <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-high)]">
                {error.message} {error.hint}
              </p>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
