import Link from 'next/link';
import { Github, LayoutDashboard } from 'lucide-react';
import { Wordmark } from './logo';
import { capabilities } from '@/lib/env';

const NAV = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#agents', label: 'Agents' },
  { href: '/#report', label: 'Example report' },
];

export function SiteHeader() {
  const caps = capabilities();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-hairline)] bg-[color-mix(in_oklab,var(--color-canvas)_85%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="shrink-0 rounded-md" aria-label="Sentinel home">
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-[13px] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {caps.demoOnly ? (
            <span className="hidden rounded-md border border-[color-mix(in_oklab,var(--color-signal)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-signal)_10%,transparent)] px-2 py-1 text-[11px] font-medium text-[var(--color-signal-soft)] sm:inline-flex">
              Demo mode
            </span>
          ) : null}
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
          >
            <LayoutDashboard className="size-4" aria-hidden />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <a
            href="https://github.com/AyushChangedia/AI-Software-Health-Audit"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex size-9 items-center justify-center rounded-lg text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
            aria-label="Sentinel on GitHub"
          >
            <Github className="size-4" aria-hidden />
          </a>
        </div>
      </div>
    </header>
  );
}
