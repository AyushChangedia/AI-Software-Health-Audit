'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import { Activity, Github, Radio, Sparkles } from 'lucide-react';
import type { Scan, ScanState } from '@/types';
import { useScanStream } from '@/hooks/use-scan-stream';
import { AGENTS, SEVERITY_META } from '@/lib/constants';
import { cn, formatNumber, scoreColorVar, severityColorVar } from '@/lib/utils';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { DemoBanner } from '@/components/ui/misc';
import { AgentConstellation, AgentGrid } from './agent-constellation';
import { ActivityConsole } from './activity-console';
import { DebateList } from './debate-panel';
import { ScanErrorView } from './scan-error';

const PHASE_LABEL: Record<ScanState, string> = {
  queued: 'Queued',
  cloning: 'Fetching repository',
  indexing: 'Indexing',
  analyzing: 'Analysing',
  validating: 'Validating',
  generating_report: 'Building report',
  complete: 'Complete',
  failed: 'Failed',
};

const PHASES: ScanState[] = [
  'cloning',
  'indexing',
  'analyzing',
  'validating',
  'generating_report',
  'complete',
];

/**
 * The live analysis screen.
 *
 * Reads the server event stream and reflects exactly what the orchestrator is
 * doing. When the scan finishes it plays a short completion sequence and then
 * hands over to the report, which the server renders.
 */
export function ScanExperience({ scanId, initialScan }: { scanId: string; initialScan: Scan }) {
  const router = useRouter();
  const reducedMotion = useMotionPreference();
  const stream = useScanStream(scanId, initialScan);
  const [revealed, setRevealed] = useState(false);

  const totalFindings = stream.findings.length;
  const validated = stream.validations.filter((v) => v.status).length;

  // Once the score lands, move to the full report.
  useEffect(() => {
    if (stream.state !== 'complete') return;
    const timer = setTimeout(() => {
      setRevealed(true);
      router.refresh();
    }, reducedMotion ? 400 : 3_200);
    return () => clearTimeout(timer);
  }, [stream.state, router, reducedMotion]);

  if (stream.state === 'failed' && stream.error) {
    return <ScanErrorView error={stream.error} repo={initialScan.repo} />;
  }

  const phaseIndex = PHASES.indexOf(stream.state);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      {initialScan.mode === 'demo' ? <DemoBanner className="mb-5" /> : null}

      {/* ---------------------------------------------------------- */}
      {/* Header                                                      */}
      {/* ---------------------------------------------------------- */}
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="eyebrow flex items-center gap-2">
              <Radio
                className={cn(
                  'size-3',
                  stream.transport === 'stream'
                    ? 'text-[var(--color-healthy)]'
                    : stream.transport === 'polling'
                      ? 'text-[var(--color-medium)]'
                      : 'text-[var(--color-ink-faint)]',
                )}
                aria-hidden
              />
              {stream.state === 'complete'
                ? 'Analysis complete'
                : stream.transport === 'polling'
                  ? 'Analysing — polling for updates'
                  : 'Analysing repository'}
            </div>
            <h1 className="mt-2 flex items-center gap-2.5 text-2xl font-semibold tracking-tight sm:text-3xl">
              <Github className="size-6 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
              <span className="truncate">{initialScan.repo.slug}</span>
            </h1>
          </div>

          <div className="flex items-center gap-6">
            <Metric label="Findings" value={totalFindings} accent={totalFindings > 0 ? 'var(--color-high)' : undefined} />
            <Metric label="Validated" value={validated} />
            <Metric
              label="Progress"
              value={`${Math.round(stream.progress * 100)}%`}
              accent="var(--color-signal-soft)"
            />
          </div>
        </div>

        {/* Phase rail */}
        <div className="mt-6">
          <div className="relative h-1 overflow-hidden rounded-full bg-[var(--color-hairline)]">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-signal)]"
              initial={false}
              animate={{ width: `${Math.round(stream.progress * 100)}%` }}
              transition={{ type: 'spring', stiffness: 90, damping: 24 }}
            />
          </div>
          <ol className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {PHASES.map((phase, index) => {
              const done = phaseIndex > index;
              const active = phaseIndex === index;
              return (
                <li
                  key={phase}
                  className={cn(
                    'flex items-center gap-1.5 text-[12px]',
                    active
                      ? 'font-medium text-[var(--color-ink)]'
                      : done
                        ? 'text-[var(--color-ink-muted)]'
                        : 'text-[var(--color-ink-faint)]',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn('size-1.5 rounded-full', active && !reducedMotion && '[animation:var(--animate-breathe)]')}
                    style={{
                      backgroundColor: done
                        ? 'var(--color-healthy)'
                        : active
                          ? 'var(--color-signal)'
                          : 'var(--color-hairline-strong)',
                    }}
                  />
                  {PHASE_LABEL[phase]}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-[13px] text-[var(--color-ink-muted)]" aria-live="polite">
            {stream.message}
          </p>
        </div>
      </header>

      {/* ---------------------------------------------------------- */}
      {/* Completion overlay                                          */}
      {/* ---------------------------------------------------------- */}
      <AnimatePresence>
        {stream.state === 'complete' && !revealed ? (
          <CompletionSequence score={stream.score ?? 0} findings={totalFindings} />
        ) : null}
      </AnimatePresence>

      {/* ---------------------------------------------------------- */}
      {/* Constellation                                               */}
      {/* ---------------------------------------------------------- */}
      <Panel className="mb-3 hidden overflow-hidden lg:block">
        <AgentConstellation
          agents={stream.agents}
          findingCount={totalFindings}
          className="px-6 pb-4 pt-6"
        />
      </Panel>

      <div className="mb-3">
        <AgentGrid agents={stream.agents} />
      </div>

      {/* ---------------------------------------------------------- */}
      {/* Console + findings                                          */}
      {/* ---------------------------------------------------------- */}
      <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--color-hairline)] px-4 py-3">
            <div className="eyebrow flex items-center gap-2">
              <Activity className="size-3.5" aria-hidden />
              Live analysis
            </div>
            <span className="tabular text-[11px] text-[var(--color-ink-faint)]">
              {stream.console.length} events
            </span>
          </div>
          <ActivityConsole entries={stream.console} />
        </Panel>

        <div className="grid gap-3">
          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--color-hairline)] px-4 py-3">
              <div className="eyebrow">Findings as they surface</div>
              <span className="tabular text-[11px] text-[var(--color-ink-faint)]">
                {totalFindings}
              </span>
            </div>
            <div className="max-h-[340px] overflow-y-auto">
              {stream.findings.length === 0 ? (
                <p className="px-4 py-6 text-[13px] text-[var(--color-ink-faint)]">
                  Nothing raised yet. Findings appear here the moment an agent reports one, before
                  the validator has looked at them.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--color-hairline)]">
                  <AnimatePresence initial={false}>
                    {[...stream.findings].reverse().map((finding, index) => (
                      <motion.li
                        key={`${finding.agentId}-${finding.id}-${index}`}
                        initial={reducedMotion ? false : { opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2 }}
                        className="flex items-start gap-2.5 px-4 py-2.5"
                      >
                        <span
                          aria-hidden
                          className="mt-1.5 size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: severityColorVar(finding.severity) }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-medium">{finding.title}</p>
                          <p className="mono mt-0.5 truncate text-[var(--color-ink-faint)]">
                            {finding.path}
                            {finding.line ? `:${finding.line}` : ''}
                          </p>
                        </div>
                        <span
                          aria-label={AGENTS[finding.agentId].name}
                          title={AGENTS[finding.agentId].name}
                          className="shrink-0 text-[13px]"
                        >
                          {AGENTS[finding.agentId].emoji}
                        </span>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--color-hairline)] px-4 py-3">
              <div className="eyebrow">Validator</div>
              <span className="tabular text-[11px] text-[var(--color-ink-faint)]">
                {validated}/{stream.validations.length}
              </span>
            </div>
            <div className="max-h-[220px] overflow-y-auto px-4 py-2">
              {stream.validations.length === 0 ? (
                <p className="py-4 text-[13px] text-[var(--color-ink-faint)]">
                  The validator starts once the agents have finished and their findings have been
                  merged.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {[...stream.validations].reverse().map((entry) => (
                    <li key={entry.findingId} className="flex items-start gap-2 py-1">
                      <span aria-hidden className="mt-0.5 shrink-0 text-[11px]">
                        {entry.status ? SEVERITY_META.info.dot : '🔬'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-ink-muted)]">
                        {entry.title}
                      </span>
                      {entry.status ? (
                        <span className="tabular shrink-0 text-[11px] text-[var(--color-ink-faint)]">
                          {Math.round((entry.confidence ?? 0) * 100)}%
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11px] text-[var(--color-validator)]">
                          testing…
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        </div>
      </div>

      {/* ---------------------------------------------------------- */}
      {/* Debates                                                     */}
      {/* ---------------------------------------------------------- */}
      {stream.debates.length > 0 ? (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">
              Agent debate
              <span className="ml-2 text-[var(--color-ink-faint)]">{stream.debates.length}</span>
            </h2>
            <p className="hidden text-[12px] text-[var(--color-ink-muted)] sm:block">
              Recorded when the evidence for a finding conflicts with the evidence against it.
            </p>
          </div>
          <DebateList debates={stream.debates} />
        </section>
      ) : null}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="text-right">
      <div className="eyebrow">{label}</div>
      <div
        className="tabular mt-1 text-xl font-semibold tracking-tight"
        style={accent ? { color: accent } : undefined}
      >
        {typeof value === 'number' ? formatNumber(value) : value}
      </div>
    </div>
  );
}

/**
 * The completion moment: agents converge, the score counts up, the report opens.
 */
function CompletionSequence({ score, findings }: { score: number; findings: number }) {
  const reducedMotion = useMotionPreference();
  const [displayed, setDisplayed] = useState(reducedMotion ? score : 0);

  useEffect(() => {
    if (reducedMotion) return;
    let raf = 0;
    const start = performance.now();
    const duration = 1_500;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutExpo
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setDisplayed(Math.round(eased * score));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score, reducedMotion]);

  const color = scoreColorVar(score);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklab,var(--color-canvas)_92%,transparent)] backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <motion.div
        initial={reducedMotion ? false : { scale: 0.94, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 24 }}
        className="px-6 text-center"
      >
        <div className="eyebrow flex items-center justify-center gap-2">
          <Sparkles className="size-3.5" aria-hidden />
          Analysis complete
        </div>
        <div
          className="tabular mt-6 text-[7rem] font-semibold leading-none tracking-[-0.05em]"
          style={{ color, filter: `drop-shadow(0 0 40px color-mix(in oklab, ${color} 35%, transparent))` }}
        >
          {displayed}
        </div>
        <div className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Sentinel Software Health Score
        </div>
        <motion.p
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4 }}
          className="mt-8 text-[13px] text-[var(--color-ink-faint)]"
        >
          {findings} findings raised · opening the report
        </motion.p>
        <motion.div
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.8 }}
          className="mt-4"
        >
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Open now
          </Button>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
