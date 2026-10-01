import { CATEGORY_META } from '@/lib/constants';
import type { CategoryId } from '@/types';
import { DependencyField } from './dependency-field';
import { RepoInput } from './repo-input';

const STRIP: CategoryId[] = [
  'security',
  'reliability',
  'architecture',
  'testing',
  'dependencies',
  'performance',
  'ai-code',
  'maintainability',
];

export function Hero({ demoOnly }: { demoOnly: boolean }) {
  return (
    <section className="relative isolate overflow-hidden border-b border-[var(--color-hairline)]">
      <DependencyField />
      <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0" />

      <div className="relative mx-auto max-w-[1400px] px-4 pb-16 pt-16 sm:px-6 sm:pt-24 lg:pb-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="eyebrow inline-flex items-center gap-2 rounded-full border border-[var(--color-hairline-strong)] bg-[color-mix(in_oklab,var(--color-panel)_70%,transparent)] px-3 py-1 backdrop-blur">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-[var(--color-signal)] [animation:var(--animate-breathe)]"
            />
            AI Software Health Auditor
          </div>

          <h1 className="mt-6 text-balance text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">
            Your AI engineering team
            <br />
            <span className="text-[var(--color-ink-muted)]">for every codebase.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-pretty text-[15px] leading-relaxed text-[var(--color-ink-muted)] sm:text-base">
            Paste a repository. Nine specialised agents read it alongside deterministic security
            tooling, argue with each other about what they find, and return a report where every
            claim names a file, a line and a confidence.
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-2xl">
          <RepoInput demoOnly={demoOnly} />
        </div>

        <ul className="mx-auto mt-12 flex max-w-4xl flex-wrap items-center justify-center gap-2">
          {STRIP.map((id) => {
            const meta = CATEGORY_META[id];
            return (
              <li
                key={id}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-hairline)] bg-[color-mix(in_oklab,var(--color-panel)_60%,transparent)] px-3 py-2 text-[13px] text-[var(--color-ink-muted)] backdrop-blur"
              >
                <span aria-hidden>{meta.emoji}</span>
                {meta.label}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
