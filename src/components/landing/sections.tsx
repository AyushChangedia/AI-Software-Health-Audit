import Link from 'next/link';
import {
  ArrowRight,
  FileSearch,
  GitPullRequest,
  MessagesSquare,
  ScanSearch,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { AGENTS, PRODUCT } from '@/lib/constants';
import type { AgentId } from '@/types';
import { Panel, SectionHeading } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import type { Capabilities } from '@/lib/env';

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    icon: ScanSearch,
    title: 'Index the repository',
    body: 'The archive is read in memory — never written to disk, never executed. Files, languages, the module graph and every dependency manifest are indexed before an agent runs.',
  },
  {
    icon: FileSearch,
    title: 'Deploy the engineering team',
    body: 'Eight agents work the same index in parallel. Each runs deterministic detectors first, then asks the model to reason about what those detectors actually found.',
  },
  {
    icon: MessagesSquare,
    title: 'Make them disagree',
    body: 'Findings that describe the same issue are merged. Where the evidence conflicts, the agents argue it out and the exchange is recorded in the report.',
  },
  {
    icon: ShieldCheck,
    title: 'Validate before reporting',
    body: 'The validator looks for reasons each finding is wrong: is the file reachable, is there a mitigating control, is it test-only code. Confidence moves accordingly.',
  },
  {
    icon: Wrench,
    title: 'Fix what matters',
    body: 'Findings are grouped by root cause and ordered by score gained per hour of work, with a patch where one can be generated safely.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-[1400px] scroll-mt-20 px-4 py-20 sm:px-6">
      <SectionHeading
        eyebrow="How it works"
        title="Deterministic first, AI second."
        description="Static analysis finds what is provably there. Models are good at judging whether it matters. Sentinel runs them in that order, and the report shows which did what."
      />

      <ol className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <Panel interactive className="flex h-full flex-col p-5">
              <div className="flex items-center gap-3">
                <span className="inline-flex size-8 items-center justify-center rounded-lg border border-[var(--color-hairline-strong)] bg-[var(--color-raised)]">
                  <step.icon className="size-4 text-[var(--color-signal-soft)]" aria-hidden />
                </span>
                <span className="tabular text-[11px] font-semibold text-[var(--color-ink-faint)]">
                  0{index + 1}
                </span>
              </div>
              <h3 className="mt-4 text-[14px] font-semibold tracking-tight">{step.title}</h3>
              <p className="mt-2 text-pretty text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                {step.body}
              </p>
            </Panel>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Agent roster                                                        */
/* ------------------------------------------------------------------ */

const ROSTER: AgentId[] = [
  'security',
  'bugs',
  'architecture',
  'testing',
  'dependencies',
  'performance',
  'ai-code',
  'maintainability',
];

export function AgentRoster() {
  return (
    <section
      id="agents"
      className="scroll-mt-20 border-y border-[var(--color-hairline)] bg-[var(--color-surface)]"
    >
      <div className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6">
        <SectionHeading
          eyebrow="The engineering team"
          title="Nine agents, one interface."
          description="Each agent owns a category, exposes the same contract, and can be replaced or extended without touching the others. Two of them never produce findings — they coordinate and they challenge."
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ROSTER.map((id) => {
            const agent = AGENTS[id];
            return (
              <Panel interactive key={id} className="p-5">
                <div className="flex items-start gap-3">
                  <span aria-hidden className="text-xl leading-none">
                    {agent.emoji}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[14px] font-semibold tracking-tight">{agent.name}</h3>
                    <p className="mt-1.5 text-pretty text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                      {agent.role}
                    </p>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {(['orchestrator', 'validator'] as AgentId[]).map((id) => {
            const agent = AGENTS[id];
            return (
              <Panel
                key={id}
                className="border-[color-mix(in_oklab,var(--color-signal)_28%,transparent)] bg-[color-mix(in_oklab,var(--color-signal)_6%,transparent)] p-5"
              >
                <div className="flex items-start gap-3">
                  <span aria-hidden className="text-xl leading-none">
                    {agent.emoji}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[14px] font-semibold tracking-tight">{agent.name}</h3>
                    <p className="mt-1.5 text-pretty text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                      {agent.role}
                    </p>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Why Sentinel                                                        */
/* ------------------------------------------------------------------ */

const PRINCIPLES = [
  {
    title: 'Evidence over assertion',
    body: 'Every finding names a file, a line and the check that produced it. If Sentinel cannot show you the evidence, it does not report the finding.',
  },
  {
    title: 'Confidence you can argue with',
    body: 'Each finding carries a validation status and a number. The report shows what raised it and what lowered it, including the case against.',
  },
  {
    title: 'Deterministic tools do the finding',
    body: 'Secret scanning, dependency advisories, the module graph and structural metrics are ordinary static analysis. The model interprets; it does not replace them.',
  },
  {
    title: 'Untrusted by construction',
    body: 'Repository contents are never written to disk and never executed. Archives are read in memory with traversal, symlink and size-bomb guards.',
  },
  {
    title: 'Root causes, not warning counts',
    body: 'Forty-seven findings usually come from six decisions. The plan targets the decisions and shows the score you get back.',
  },
  {
    title: 'It works with nothing configured',
    body: 'No API key, no database, no queue — Sentinel still runs a real analysis and tells you exactly which capabilities are switched off.',
  },
];

export function WhySentinel() {
  return (
    <section className="mx-auto max-w-[1400px] px-4 py-20 sm:px-6">
      <SectionHeading
        eyebrow="Why Sentinel"
        title="A security tool is only as good as its restraint."
        description="Anything can produce a list of warnings. The hard part is being right often enough that people keep reading."
      />
      <div className="grid gap-px overflow-hidden rounded-xl border border-[var(--color-hairline)] bg-[var(--color-hairline)] sm:grid-cols-2 lg:grid-cols-3">
        {PRINCIPLES.map((principle) => (
          <div key={principle.title} className="bg-[var(--color-panel)] p-6">
            <h3 className="text-[14px] font-semibold tracking-tight">{principle.title}</h3>
            <p className="mt-2 text-pretty text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              {principle.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Integration                                                         */
/* ------------------------------------------------------------------ */

export function Integration({ capabilities }: { capabilities: Capabilities }) {
  const rows = [
    {
      label: 'AI reasoning',
      on: capabilities.ai,
      detail: capabilities.ai
        ? `Enabled via ${capabilities.aiProvider}.`
        : 'Not configured. Agents run their deterministic paths and the report says so.',
    },
    {
      label: 'Live dependency advisories',
      on: true,
      detail: 'OSV.dev when outbound network access is available, with a bundled snapshot as fallback.',
    },
    {
      label: 'GitHub sign-in',
      on: capabilities.githubOAuth,
      detail: capabilities.githubOAuth
        ? 'Available for private repositories.'
        : 'Not configured. Public repositories analyse without any sign-in.',
    },
    {
      label: 'Durable storage',
      on: capabilities.database,
      detail: capabilities.database
        ? 'PostgreSQL.'
        : 'In-process store. Scans persist for this instance only.',
    },
    {
      label: 'Distributed queue',
      on: capabilities.queue,
      detail: capabilities.queue
        ? 'Redis-backed workers.'
        : 'In-process queue with bounded concurrency.',
    },
  ];

  return (
    <section className="border-y border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <SectionHeading
            eyebrow="Fits your pipeline"
            title="Export as SARIF, or keep it in the browser."
            description="Reports download as JSON or SARIF 2.1.0, which is what GitHub code scanning ingests — so a Sentinel run can become an annotation on a pull request rather than another dashboard nobody opens."
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" icon={<GitPullRequest className="size-4" aria-hidden />}>
              SARIF export
            </Button>
            <Button variant="outline" size="sm">
              JSON export
            </Button>
            <Button variant="outline" size="sm">
              Shareable report link
            </Button>
          </div>
        </div>

        <Panel className="overflow-hidden">
          <div className="border-b border-[var(--color-hairline)] px-5 py-3">
            <div className="eyebrow">This instance</div>
          </div>
          <ul className="divide-y divide-[var(--color-hairline)]">
            {rows.map((row) => (
              <li key={row.label} className="flex items-start gap-3 px-5 py-3.5">
                <span
                  aria-hidden
                  className="mt-1.5 size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: row.on ? 'var(--color-healthy)' : 'var(--color-ink-faint)',
                  }}
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{row.label}</div>
                  <div className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
                    {row.detail}
                  </div>
                </div>
                <span className="ml-auto shrink-0 text-[11px] font-medium text-[var(--color-ink-faint)]">
                  {row.on ? 'on' : 'off'}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* CTA                                                                 */
/* ------------------------------------------------------------------ */

export function FinalCta() {
  return (
    <section className="mx-auto max-w-[1400px] px-4 py-24 sm:px-6">
      <Panel className="relative overflow-hidden px-6 py-14 text-center sm:px-12">
        <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative mx-auto max-w-2xl">
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            {PRODUCT.subTagline}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-pretty text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
            One paste, one audit. If nothing serious turns up, Sentinel will tell you that plainly —
            it will not tell you your code is safe.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/#main">
              <Button variant="primary" size="lg" iconRight={<ArrowRight className="size-4" aria-hidden />}>
                Analyse your repository
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="outline" size="lg">
                View dashboard
              </Button>
            </Link>
          </div>
        </div>
      </Panel>
    </section>
  );
}
