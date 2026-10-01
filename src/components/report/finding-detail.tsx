'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import { ArrowRight, ExternalLink, FileCode2, ShieldAlert, X } from 'lucide-react';
import type { Debate, Finding } from '@/types';
import { AGENTS, VALIDATION_META } from '@/lib/constants';
import { cn, severityColorVar, validationClass } from '@/lib/utils';
import { SeverityBadge, CategoryBadge, ValidationBadge, Badge } from '@/components/ui/badge';
import { CodeBlock, CopyButton, DiffView } from '@/components/ui/code-block';
import { Button } from '@/components/ui/button';
import { DebateCard } from '@/components/scan/debate-panel';

/**
 * Finding detail.
 *
 * Structured around the five questions every recommendation has to answer:
 * what, why it matters, the evidence, the impact path, and how to fix it.
 * Nothing here is generated prose over a vague signal — each section is backed
 * by something the engine recorded.
 */
export function FindingDetail({
  finding,
  debate,
  onClose,
}: {
  finding: Finding | null;
  debate?: Debate;
  onClose: () => void;
}) {
  const reducedMotion = useMotionPreference();
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes; focus moves into the panel so screen readers follow.
  useEffect(() => {
    if (!finding) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [finding, onClose]);

  return (
    <AnimatePresence>
      {finding ? (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-[color-mix(in_oklab,#000_65%,transparent)] backdrop-blur-[2px]"
            aria-hidden
          />
          <motion.div
            key="panel"
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={finding.title}
            initial={reducedMotion ? { opacity: 0 } : { x: '100%' }}
            animate={reducedMotion ? { opacity: 1 } : { x: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 36 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-[var(--color-hairline-strong)] bg-[var(--color-canvas)] shadow-2xl outline-none"
          >
            <DetailHeader finding={finding} onClose={onClose} />
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-6">
              <DetailBody finding={finding} debate={debate} />
            </div>
            {/* A real footer rather than a sticky element inside the scroll
                area: sticky leaves a gap below itself when the container has
                bottom padding, and content shows through it. */}
            <footer className="shrink-0 border-t border-[var(--color-hairline)] bg-[var(--color-canvas)] px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <GitHubActionButtons finding={finding} />
              </div>
            </footer>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

function DetailHeader({ finding, onClose }: { finding: Finding; onClose: () => void }) {
  return (
    <header className="shrink-0 border-b border-[var(--color-hairline)] px-5 py-4 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <ValidationBadge status={finding.validation} confidence={finding.confidence} />
            <CategoryBadge category={finding.category} />
          </div>
          <h2 className="mt-3 text-pretty text-lg font-semibold leading-snug tracking-tight">
            {finding.title}
          </h2>
          <p className="mono mt-1.5 text-[var(--color-ink-faint)]">
            {finding.location.path}
            {finding.location.startLine ? `:${finding.location.startLine}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close finding details"
          className="-mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </header>
  );
}

function Section({
  title,
  children,
  description,
}: {
  title: string;
  children: React.ReactNode;
  description?: string;
}) {
  return (
    <section className="mb-7">
      <h3 className="eyebrow mb-2.5">{title}</h3>
      {description ? (
        <p className="mb-3 text-[12px] text-[var(--color-ink-faint)]">{description}</p>
      ) : null}
      {children}
    </section>
  );
}

function DetailBody({ finding, debate }: { finding: Finding; debate?: Debate }) {
  const highlight = finding.location.startLine ? [finding.location.startLine] : [];

  return (
    <>
      <Section title="What happened">
        <p className="text-pretty text-[14px] leading-relaxed text-[var(--color-ink)]">
          {finding.summary}
        </p>
      </Section>

      <Section title="Why it matters">
        <p className="text-pretty text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
          {finding.impact}
        </p>
      </Section>

      {finding.location.snippet ? (
        <Section title="The code">
          <CodeBlock
            code={finding.location.snippet}
            language={finding.location.language}
            startLine={finding.location.snippetStartLine ?? finding.location.startLine ?? 1}
            highlightLines={highlight}
            filename={finding.location.path}
          />
        </Section>
      ) : null}

      {finding.dataFlow?.length ? (
        <Section title="Path to impact">
          <ol className="space-y-0">
            {finding.dataFlow.map((step, index) => (
              <li key={index} className="relative flex gap-3 pb-4 last:pb-0">
                {index < finding.dataFlow!.length - 1 ? (
                  <span
                    aria-hidden
                    className="absolute left-[11px] top-6 h-full w-px"
                    style={{
                      background: step.vulnerable
                        ? 'color-mix(in oklab, var(--color-critical) 40%, transparent)'
                        : 'var(--color-hairline)',
                    }}
                  />
                ) : null}
                <span
                  aria-hidden
                  className={cn(
                    'relative z-10 mt-0.5 inline-flex size-[23px] shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                    step.vulnerable
                      ? 'border-[var(--color-critical)] bg-[color-mix(in_oklab,var(--color-critical)_18%,transparent)] text-[var(--color-critical)]'
                      : 'border-[var(--color-hairline-strong)] bg-[var(--color-panel)] text-[var(--color-ink-faint)]',
                  )}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'text-[13px] font-medium',
                        step.vulnerable && 'text-[var(--color-critical)]',
                      )}
                    >
                      {step.label}
                    </span>
                    {step.vulnerable ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-critical)]">
                        <ShieldAlert className="size-3" aria-hidden />
                        control breaks down here
                      </span>
                    ) : null}
                  </div>
                  {step.detail ? (
                    <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
                      {step.detail}
                    </p>
                  ) : null}
                  {step.path ? (
                    <p className="mono mt-0.5 text-[var(--color-ink-faint)]">
                      {step.path}
                      {step.line ? `:${step.line}` : ''}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <Section
        title="Evidence"
        description="Everything the engine used to reach this conclusion, including what argued against it."
      >
        <ul className="space-y-2">
          {finding.evidence.map((item, index) => (
            <li key={index} className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-panel)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold">{item.label}</span>
                <Badge className="text-[10px]">{item.kind}</Badge>
                {item.source ? (
                  <span className="mono ml-auto text-[var(--color-ink-faint)]">{item.source}</span>
                ) : null}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-pretty text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
                {item.detail}
              </p>
              {item.path ? (
                <p className="mono mt-1.5 text-[var(--color-ink-faint)]">
                  {item.path}
                  {item.line ? `:${item.line}` : ''}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      {finding.otherLocations.length > 0 ? (
        <Section title={`Also at ${finding.otherLocations.length} other ${finding.otherLocations.length === 1 ? 'location' : 'locations'}`}>
          <ul className="space-y-1">
            {finding.otherLocations.map((location, index) => (
              <li key={index} className="mono flex items-center gap-2 text-[var(--color-ink-muted)]">
                <FileCode2 className="size-3.5 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
                {location.path}
                {location.startLine ? `:${location.startLine}` : ''}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="How to fix it">
        <p className="text-pretty text-[14px] leading-relaxed text-[var(--color-ink)]">
          {finding.recommendation}
        </p>
      </Section>

      {finding.patch ? (
        <Section title="Suggested patch">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] text-[var(--color-ink-muted)]">{finding.patch.description}</p>
            <CopyButton value={finding.patch.diff} label="Copy patch" />
          </div>
          <DiffView diff={finding.patch.diff} />
          {finding.patch.requiresReview ? (
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-medium)]">
              This patch was derived heuristically from the matched line. Read it before applying —
              Sentinel does not modify repositories.
            </p>
          ) : null}
        </Section>
      ) : null}

      {debate ? (
        <Section title="How the confidence was reached">
          <DebateCard debate={debate} defaultOpen />
        </Section>
      ) : null}

      <Section title="Provenance">
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[12.5px]">
          <dt className="text-[var(--color-ink-faint)]">Rule</dt>
          <dd className="mono text-[var(--color-ink-muted)]">{finding.ruleId}</dd>

          <dt className="text-[var(--color-ink-faint)]">Raised by</dt>
          <dd className="text-[var(--color-ink-muted)]">
            {finding.detectedBy.map((id) => `${AGENTS[id].emoji} ${AGENTS[id].name}`).join(', ')}
          </dd>

          <dt className="text-[var(--color-ink-faint)]">Analyzers</dt>
          <dd className="mono text-[var(--color-ink-muted)]">{finding.detectors.join(', ')}</dd>

          <dt className="text-[var(--color-ink-faint)]">Validation</dt>
          <dd className={validationClass(finding.validation)}>
            {VALIDATION_META[finding.validation].label} —{' '}
            <span className="text-[var(--color-ink-muted)]">
              {VALIDATION_META[finding.validation].description}
            </span>
          </dd>

          {finding.cwe ? (
            <>
              <dt className="text-[var(--color-ink-faint)]">CWE</dt>
              <dd className="text-[var(--color-ink-muted)]">{finding.cwe}</dd>
            </>
          ) : null}
          {finding.owasp ? (
            <>
              <dt className="text-[var(--color-ink-faint)]">OWASP</dt>
              <dd className="text-[var(--color-ink-muted)]">{finding.owasp}</dd>
            </>
          ) : null}

          <dt className="text-[var(--color-ink-faint)]">Effort</dt>
          <dd className="text-[var(--color-ink-muted)]">
            about {Math.max(1, Math.round(finding.effortMinutes / 15) * 15)} minutes
          </dd>
        </dl>
      </Section>

      {finding.references.length > 0 ? (
        <Section title="References">
          <ul className="space-y-1.5">
            {finding.references.map((reference) => (
              <li key={reference.url}>
                <a
                  href={reference.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 text-[13px] text-[var(--color-low)] hover:underline"
                >
                  {reference.label}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

    </>
  );
}

/**
 * GitHub write actions.
 *
 * Disabled unless the instance is configured for repository writes. Sentinel
 * never modifies a repository without an explicit, authorised action — a
 * button that silently did nothing would be worse than one that explains why.
 */
function GitHubActionButtons({ finding }: { finding: Finding }) {
  const body = [
    `**${finding.title}**`,
    '',
    `Severity: ${finding.severity} · Confidence: ${Math.round(finding.confidence * 100)}% · ${VALIDATION_META[finding.validation].label}`,
    `Location: \`${finding.location.path}${finding.location.startLine ? `:${finding.location.startLine}` : ''}\``,
    '',
    '### What happened',
    finding.summary,
    '',
    '### Why it matters',
    finding.impact,
    '',
    '### How to fix it',
    finding.recommendation,
    '',
    finding.patch ? `### Suggested patch\n\n\`\`\`diff\n${finding.patch.diff}\n\`\`\`` : '',
    '',
    `_Reported by Sentinel · rule \`${finding.ruleId}\`_`,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <>
      <CopyButton value={body} label="Copy as issue" className="h-9 rounded-lg px-3 text-[13px]" />
      <Button
        variant="outline"
        size="sm"
        disabled
        title="Connect GitHub with write access to create issues from findings."
      >
        Create GitHub issue
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled
        title="Connect GitHub with write access to open pull requests. Sentinel never pushes without an explicit action."
        iconRight={<ArrowRight className="size-3.5" aria-hidden />}
      >
        Open pull request
      </Button>
      <span className="self-center text-[11px] text-[var(--color-ink-faint)]">
        Write actions need GitHub to be connected.
      </span>
    </>
  );
}

/** Small severity marker used by list rows. */
export function SeverityDot({ severity }: { severity: Finding['severity'] }) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: severityColorVar(severity) }}
    />
  );
}
