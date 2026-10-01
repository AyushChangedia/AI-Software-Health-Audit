import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 sm:px-6">
      <Panel className="p-10 text-center">
        <div className="eyebrow">404</div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          There is nothing at this address
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-pretty text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
          Scan results live for a limited time on this instance, so an old link may simply have
          expired. Running the analysis again takes seconds.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Link href="/">
            <Button variant="primary">Analyse a repository</Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="outline">Your dashboard</Button>
          </Link>
        </div>
      </Panel>
    </div>
  );
}
