import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowUpRight, FolderGit2, Plus } from 'lucide-react';
import { getStore } from '@/lib/db';
import { getWorkspace } from '@/lib/http/session';
import { Panel, SectionHeading } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';
import { formatRelativeTime, scoreColorVar, scoreLabel } from '@/lib/utils';
import { SEVERITY_META } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Repositories you have audited with Sentinel.',
  robots: { index: false, follow: false },
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default async function DashboardPage() {
  const session = await getWorkspace();
  const store = getStore();
  const [repositories, scans] = await Promise.all([
    store.listRepositories(session.id),
    store.listScans(session.id, 12),
  ]);

  const running = scans.filter((scan) => !['complete', 'failed'].includes(scan.state));

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{greeting()} 👋</h1>
          <p className="mt-2 text-[14px] text-[var(--color-ink-muted)]">
            {repositories.length === 0
              ? 'Nothing audited yet from this browser.'
              : `${repositories.length} ${repositories.length === 1 ? 'repository' : 'repositories'} audited from this browser.`}
          </p>
        </div>
        <Link href="/">
          <Button variant="primary" icon={<Plus className="size-4" aria-hidden />}>
            New analysis
          </Button>
        </Link>
      </div>

      {running.length > 0 ? (
        <section className="mb-8">
          <SectionHeading eyebrow="In progress" title="Running now" />
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {running.map((scan) => (
              <li key={scan.id}>
                <Link href={`/scan/${scan.id}`} className="block">
                  <Panel interactive className="p-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-[14px] font-semibold">{scan.repo.slug}</span>
                      <span className="shrink-0 text-[11px] uppercase tracking-wider text-[var(--color-signal-soft)]">
                        {scan.state}
                      </span>
                    </div>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--color-hairline)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-signal)]"
                        style={{ width: `${Math.round(scan.progress * 100)}%` }}
                      />
                    </div>
                    <p className="mt-2 truncate text-[12px] text-[var(--color-ink-muted)]">
                      {scan.statusMessage}
                    </p>
                  </Panel>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionHeading
          eyebrow="Your projects"
          title="Repositories"
          description="Health is the score from the most recent completed scan. The arrow compares it to the one before."
        />

        {repositories.length === 0 ? (
          <EmptyState
            icon={<FolderGit2 className="size-7" aria-hidden />}
            title="No scans yet"
            description="Your codebase is waiting. Paste a GitHub URL to run the full audit, or start with the bundled demo repository."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/">
                  <Button variant="primary">Analyse a repository</Button>
                </Link>
                <Link href="/demo">
                  <Button variant="outline">Run the demo</Button>
                </Link>
              </div>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {repositories.map((repository) => {
              const score = repository.latestScore;
              const delta =
                score !== undefined && repository.previousScore !== undefined
                  ? score - repository.previousScore
                  : null;

              return (
                <li key={repository.id}>
                  <Link
                    href={`/repositories/${encodeURIComponent(repository.repo.slug)}`}
                    className="block"
                  >
                    <Panel interactive className="group p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-[14px] font-semibold tracking-tight">
                            {repository.repo.name}
                          </h3>
                          <p className="mono mt-0.5 truncate text-[var(--color-ink-faint)]">
                            {repository.repo.owner}
                          </p>
                        </div>
                        <ArrowUpRight
                          className="size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                          aria-hidden
                        />
                      </div>

                      <div className="mt-5 flex items-end justify-between gap-3">
                        <div>
                          <div className="eyebrow">Health</div>
                          <div className="mt-1 flex items-baseline gap-2">
                            <span
                              className="tabular text-2xl font-semibold"
                              style={{
                                color: score !== undefined ? scoreColorVar(score) : undefined,
                              }}
                            >
                              {score ?? '—'}
                            </span>
                            {delta !== null && delta !== 0 ? (
                              <span
                                className="tabular text-[12px] font-medium"
                                style={{
                                  color:
                                    delta > 0 ? 'var(--color-healthy)' : 'var(--color-critical)',
                                }}
                              >
                                {delta > 0 ? '↑' : '↓'} {Math.abs(delta)}
                              </span>
                            ) : null}
                          </div>
                          {score !== undefined ? (
                            <div className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">
                              {scoreLabel(score)}
                            </div>
                          ) : null}
                        </div>

                        <div className="text-right text-[12px]">
                          {repository.criticalCount > 0 ? (
                            <div className="text-[var(--color-critical)]">
                              {SEVERITY_META.critical.dot} {repository.criticalCount} critical
                            </div>
                          ) : null}
                          {repository.highCount > 0 ? (
                            <div className="text-[var(--color-high)]">
                              {SEVERITY_META.high.dot} {repository.highCount} high
                            </div>
                          ) : null}
                          {repository.criticalCount === 0 && repository.highCount === 0 ? (
                            <div className="text-[var(--color-ink-faint)]">
                              nothing above medium
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <p className="mt-4 border-t border-[var(--color-hairline)] pt-3 text-[11px] text-[var(--color-ink-faint)]">
                        {repository.lastScannedAt
                          ? `Last scan ${formatRelativeTime(repository.lastScannedAt)}`
                          : 'No completed scan yet'}
                        {' · '}
                        {repository.scanCount} total
                      </p>
                    </Panel>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="mt-10 max-w-2xl text-pretty text-[12px] leading-relaxed text-[var(--color-ink-faint)]">
        Scans are associated with an anonymous workspace stored in a cookie on this browser. No
        account is created and nothing here is shared with anyone else unless you publish a report
        link.
      </p>
    </div>
  );
}
