import Link from 'next/link';
import { SentinelMark } from './logo';
import { NO_FINDINGS_COPY } from '@/lib/constants';

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-[var(--color-hairline)]">
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-2">
              <SentinelMark className="size-5 text-[var(--color-signal-soft)]" />
              <span className="text-sm font-semibold">Sentinel</span>
            </div>
            <p className="mt-3 text-pretty text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              An audit is only useful if you can check it. Every finding Sentinel reports names a
              file and a line, states what the validator tested, and says how confident it is.
            </p>
            <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-ink-faint)]">
              {NO_FINDINGS_COPY}
            </p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-[13px] sm:gap-x-16">
            <div className="space-y-2">
              <div className="eyebrow">Product</div>
              <Link className="block text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" href="/">
                Analyse a repository
              </Link>
              <Link className="block text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" href="/dashboard">
                Dashboard
              </Link>
              <Link className="block text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" href="/#report">
                Example report
              </Link>
            </div>
            <div className="space-y-2">
              <div className="eyebrow">Project</div>
              <a
                className="block text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                href="https://github.com/AyushChangedia/AI-Software-Health-Audit"
                target="_blank"
                rel="noreferrer noopener"
              >
                Source
              </a>
              <a
                className="block text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                href="https://github.com/AyushChangedia/AI-Software-Health-Audit/blob/main/SECURITY.md"
                target="_blank"
                rel="noreferrer noopener"
              >
                Security model
              </a>
              <Link className="block text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" href="/api/health">
                Instance status
              </Link>
            </div>
          </nav>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-hairline)] pt-6 text-[12px] text-[var(--color-ink-faint)]">
          <span>Sentinel is an analysis aid, not a substitute for a security review.</span>
          <span>MIT licensed</span>
        </div>
      </div>
    </footer>
  );
}
