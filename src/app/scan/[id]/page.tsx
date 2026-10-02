import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getStore } from '@/lib/db';
import { getWorkspace } from '@/lib/http/session';
import { decodeScanTicket, scanFromTicket } from '@/lib/scan-token';
import { ScanExperience } from '@/components/scan/scan-experience';
import { ReportView } from '@/components/report/report-view';
import { ScanErrorView } from '@/components/scan/scan-error';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  // A ticket id describes its own scan, which is all the title needs.
  const ticket = decodeScanTicket(id);
  if (ticket) return { title: `Analysing ${ticket.repo.slug}`, robots: { index: false } };

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
  const session = await getWorkspace();

  const scan = await store.getScan(id);
  if (!scan) {
    // Not in this instance's store. If the id is a signed ticket the scan has
    // simply never been run here yet — hand it to the live view, which opens
    // the stream that runs it. Anything else really is a dead URL.
    const pending = scanFromTicket(id, session.id);
    if (!pending) notFound();
    return <ScanExperience scanId={id} initialScan={pending} />;
  }

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
