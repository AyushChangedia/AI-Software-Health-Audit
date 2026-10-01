import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Github, RotateCw } from 'lucide-react';
import { getStore } from '@/lib/db';
import { getWorkspace } from '@/lib/http/session';
import { Panel, SectionHeading } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { HealthTrend } from '@/components/charts/trend';
import { CategoryBreakdown } from '@/components/report/health-score';
import { formatDuration, formatRelativeTime, scoreColorVar } from '@/lib/utils';
import { SEVERITY_META, SEVERITIES_ORDERED } from '@/lib/constants';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: decodeURIComponent(slug),
    robots: { index: false, follow: false },
  };
}

export default async function RepositoryPage({ params }: PageProps) {
  const { slug: raw } = await params;
  const slug = decodeURIComponent(raw);
  const session = await getWorkspace();
  const store = getStore();

  const repository = await store.getRepository(session.id, slug);
  if (!repository) notFound();

  const [history, scans] = await Promise.all([
    store.history(session.id, slug),
    store.listScansForRepo(session.id, slug, 20),
  ]);

  const latestReport = repository.latestScanId
    ? await store.getReport(repository.latestScanId)
    : null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="mb-2">
            <Link
              href="/dashboard"
              className="text-[12px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              ← Dashboard
            </Link>
          </nav>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight sm:text-3xl">
            <Github className="size-6 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
            <span className="truncate">{repository.repo.slug}</span>
          </h1>
          {repository.repo.description ? (
            <p className="mt-2 max-w-2xl text-pretty text-[14px] text-[var(--color-ink-muted)]">
              {repository.repo.description}
            </p>
          ) : null}
        </div>

        <div className="flex gap-2">
          {repository.latestScanId ? (
            <Link href={`/scan/${repository.latestScanId}`}>
              <Button variant="secondary">Latest report</Button>
            </Link>
          ) : null}
          <Link href="/">
            <Button variant="outline" icon={<RotateCw className="size-4" aria-hidden />}>
              Re-run
            </Button>
          </Link>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <Panel className="p-5">
          <div className="eyebrow mb-4">Health over time</div>
          <HealthTrend history={history} />
        </Panel>

        {latestReport ? (
          <Panel className="p-5">
            <div className="eyebrow mb-3">Latest category scores</div>
            <CategoryBreakdown categories={latestReport.score.categories} />
          </Panel>
        ) : (
          <Panel className="flex items-center justify-center p-5">
            <p className="text-[13px] text-[var(--color-ink-faint)]">
              No completed scan for this repository yet.
            </p>
          </Panel>
        )}
      </div>

      {latestReport ? (
        <section className="mt-8">
          <SectionHeading
            eyebrow="Latest scan"
            title="Findings at a glance"
            action={
              repository.latestScanId ? (
                <Link
                  href={`/scan/${repository.latestScanId}`}
                  className="text-[13px] font-medium text-[var(--color-low)] hover:underline"
                >
                  Open full report →
                </Link>
              ) : null
            }
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SEVERITIES_ORDERED.filter((s) => s !== 'info').map((severity) => (
              <Panel key={severity} className="p-5">
                <div className="eyebrow flex items-center gap-2">
                  <span aria-hidden>{SEVERITY_META[severity].dot}</span>
                  {SEVERITY_META[severity].label}
                </div>
                <div className="tabular mt-2 text-3xl font-semibold tracking-tight">
                  {latestReport.summary.counts[severity]}
                </div>
              </Panel>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <SectionHeading eyebrow="History" title={`${scans.length} scans`} />
        <Panel className="overflow-hidden">
          <ul className="divide-y divide-[var(--color-hairline)]">
            {scans.map((scan, index) => (
              <li key={scan.id}>
                <Link
                  href={`/scan/${scan.id}`}
                  className="flex flex-wrap items-center gap-x-5 gap-y-1 px-5 py-3.5 transition-colors hover:bg-[var(--color-raised)]"
                >
                  <span className="tabular w-16 shrink-0 text-[12px] text-[var(--color-ink-faint)]">
                    #{scans.length - index}
                  </span>
                  <span
                    className="tabular w-10 shrink-0 text-[15px] font-semibold"
                    style={{
                      color: scan.score !== undefined ? scoreColorVar(scan.score) : undefined,
                    }}
                  >
                    {scan.score ?? '—'}
                  </span>
                  <span
                    className={
                      scan.state === 'failed'
                        ? 'text-[12px] text-[var(--color-critical)]'
                        : 'text-[12px] text-[var(--color-ink-muted)]'
                    }
                  >
                    {scan.state}
                  </span>
                  {scan.mode === 'demo' ? (
                    <span className="rounded bg-[color-mix(in_oklab,var(--color-signal)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-[var(--color-signal-soft)]">
                      DEMO
                    </span>
                  ) : null}
                  <span className="ml-auto text-[12px] text-[var(--color-ink-faint)]">
                    {scan.durationMs ? formatDuration(scan.durationMs) : '—'}
                    {' · '}
                    {formatRelativeTime(scan.finishedAt ?? scan.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </section>
    </div>
  );
}
