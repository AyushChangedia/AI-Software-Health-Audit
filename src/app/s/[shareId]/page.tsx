import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getStore } from '@/lib/db';
import { ReportView } from '@/components/report/report-view';
import { PRODUCT } from '@/lib/constants';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ shareId: string }>;
}

/**
 * Public, read-only report.
 *
 * Only reachable when the person who ran the scan opted in to sharing. The
 * share id is unguessable and a private repository's report is never given
 * one — see the scan creation route.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { shareId } = await params;
  const shared = await getStore().getReportByShareId(shareId);
  if (!shared) return { title: 'Report not found' };

  const { report } = shared;
  const security = report.score.categories.find((c) => c.category === 'security');
  const reliability = report.score.categories.find((c) => c.category === 'reliability');

  const description = [
    `Software health ${report.score.overall}/100`,
    security ? `Security ${security.score}` : null,
    reliability ? `Reliability ${reliability.score}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    title: `${report.repo.slug} — ${report.score.overall}/100`,
    description,
    openGraph: {
      title: `${report.repo.slug} · ${PRODUCT.name}`,
      description,
      type: 'article',
    },
    twitter: { card: 'summary', title: `${report.repo.slug} · ${PRODUCT.name}`, description },
  };
}

export default async function SharedReportPage({ params }: PageProps) {
  const { shareId } = await params;
  const shared = await getStore().getReportByShareId(shareId);
  if (!shared) notFound();

  return <ReportView report={shared.report} scan={shared.scan} readOnly />;
}
