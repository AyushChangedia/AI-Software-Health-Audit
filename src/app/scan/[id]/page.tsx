import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getStore } from '@/lib/db';
import { getWorkspace } from '@/lib/http/session';
import { ScanExperience } from '@/components/scan/scan-experience';
import { ReportView } from '@/components/report/report-view';
import { ScanErrorView } from '@/components/scan/scan-error';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const scan = await getStore().getScan(id);
  if (!scan) return { title: 'Scan not found' };
  const title =
    scan.state === 'complete' && scan.score !== undefined
      ? `${scan.repo.slug} — ${scan.score}/100`
      : `Analysing ${scan.repo.slug}`;
  return {
    title,
    description:
      scan.state === 'complete'
        ? `Sentinel software health report for ${scan.repo.slug}.`
        : `Sentinel is auditing ${scan.repo.slug}.`,
    // A scan URL is unlisted rather than public; keep it out of search results.
    robots: { index: false, follow: false },
  };
}

export default async function ScanPage({ params }: PageProps) {
  const { id } = await params;
  const store = getStore();
  const scan = await store.getScan(id);
  if (!scan) notFound();

  const session = await getWorkspace();
  const ownsScan = scan.workspaceId === session.id;
  if (!ownsScan && !scan.shareId) notFound();

  if (scan.state === 'failed' && scan.error) {
    return <ScanErrorView error={scan.error} repo={scan.repo} />;
  }

  if (scan.state === 'complete') {
    const report = await store.getReport(id);
    if (report) return <ReportView report={report} scan={scan} readOnly={!ownsScan} />;
  }

  return <ScanExperience scanId={id} initialScan={scan} />;
}
