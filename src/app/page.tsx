import { capabilities } from '@/lib/env';
import { getDemoReport } from '@/lib/demo/report';
import { Hero } from '@/components/landing/hero';
import { ExampleReport } from '@/components/landing/example-report';
import {
  AgentRoster,
  FinalCta,
  HowItWorks,
  Integration,
  WhySentinel,
} from '@/components/landing/sections';

// The example-report section renders a live run of the demo pipeline, so the
// page is dynamic on first request and memoised in-process afterwards.
export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  const caps = capabilities();
  const demoReport = await getDemoReport();

  return (
    <>
      <Hero demoOnly={caps.demoOnly} />
      <HowItWorks />
      <AgentRoster />
      <ExampleReport report={demoReport} />
      <WhySentinel />
      <Integration capabilities={caps} />
      <FinalCta />
    </>
  );
}
