'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertOctagon, RotateCw } from 'lucide-react';
import type { RepoMeta, Scan, ScanError } from '@/types';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';

/**
 * Scan failure.
 *
 * Shows the reason in plain language, the wait when there is one, and always a
 * way forward — a retry, or the demo, which needs no network and no
 * credentials. A dead end here is a dead end for the whole product.
 */
export function ScanErrorView({ error, repo }: { error: ScanError; repo: RepoMeta }) {
  const router = useRouter();
  const [remaining, setRemaining] = useState(error.retryAfterSeconds ?? 0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!remaining) return;
    const timer = setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1_000);
    return () => clearInterval(timer);
  }, [remaining]);

  async function retry(mode?: 'demo') {
    setRetrying(true);
    try {
      const response = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'demo' ? { mode: 'demo' } : { url: repo.url }),
      });
      const body = (await response.json()) as { scan?: Scan };
      if (body.scan) {
        router.push(`/scan/${body.scan.id}`);
        return;
      }
    } catch {
      // Fall through to re-enabling the button.
    }
    setRetrying(false);
  }

  const waiting = remaining > 0;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <Panel className="p-8">
        <div className="flex items-start gap-4">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-[color-mix(in_oklab,var(--color-critical)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-critical)_10%,transparent)]">
            <AlertOctagon className="size-5 text-[var(--color-critical)]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">
              We could not finish this analysis
            </h1>
            <p className="mono mt-1 text-[var(--color-ink-faint)]">{repo.slug}</p>
          </div>
        </div>

        <dl className="mt-7 space-y-4 border-t border-[var(--color-hairline)] pt-6">
          <div>
            <dt className="eyebrow">Reason</dt>
            <dd className="mt-1.5 text-pretty text-[14px] leading-relaxed text-[var(--color-ink)]">
              {error.message}
            </dd>
          </div>
          {error.hint ? (
            <div>
              <dt className="eyebrow">What to do</dt>
              <dd className="mt-1.5 text-pretty text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                {error.hint}
              </dd>
            </div>
          ) : null}
          {waiting ? (
            <div>
              <dt className="eyebrow">Try again in</dt>
              <dd className="tabular mt-1.5 text-2xl font-semibold">
                {minutes > 0 ? `${minutes}m ` : ''}
                {String(seconds).padStart(2, '0')}s
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-8 flex flex-wrap gap-2">
          {error.retryable ? (
            <Button
              variant="primary"
              onClick={() => void retry()}
              disabled={waiting}
              loading={retrying}
              icon={<RotateCw className="size-4" aria-hidden />}
            >
              {waiting ? 'Retry when ready' : 'Retry analysis'}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => void retry('demo')} disabled={retrying}>
            Run the demo analysis instead
          </Button>
          <Link href="/">
            <Button variant="ghost">Start over</Button>
          </Link>
        </div>
      </Panel>
    </div>
  );
}
