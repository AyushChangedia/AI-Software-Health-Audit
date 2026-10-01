'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';

/**
 * Root error boundary.
 *
 * Users see an explanation and a way out — never a stack trace. The digest is
 * shown so it can be quoted when reporting the problem; the detail itself
 * stays in the server logs.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[sentinel] render error', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl px-4 py-24 sm:px-6">
      <Panel className="p-10 text-center">
        <div className="eyebrow text-[var(--color-critical)]">Something broke</div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          This page could not be rendered
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-pretty text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
          The failure has been logged. Retrying usually works — the analysis data itself is
          unaffected.
        </p>
        {error.digest ? (
          <p className="mono mt-4 text-[var(--color-ink-faint)]">reference {error.digest}</p>
        ) : null}
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <Link href="/">
            <Button variant="outline">Start over</Button>
          </Link>
        </div>
      </Panel>
    </div>
  );
}
