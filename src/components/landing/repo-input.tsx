'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotionPreference } from '@/hooks/use-motion-preference';
import { AlertTriangle, ArrowRight, CheckCircle2, Github, Lock } from 'lucide-react';
import { parseRepoUrl } from '@/lib/github/url';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Scan, ScanError } from '@/types';

const EXAMPLES = [
  'https://github.com/vercel/next.js',
  'https://github.com/expressjs/express',
  'https://github.com/pallets/flask',
];

/**
 * The repository input.
 *
 * Validation is local and immediate — the same parser the API uses runs on
 * every keystroke, so the feedback under the field is never a guess about what
 * the server will say.
 */
export function RepoInput({ demoOnly = false }: { demoOnly?: boolean }) {
  const router = useRouter();
  const reducedMotion = useMotionPreference();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<ScanError | null>(null);
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);

  const parsed = useMemo(() => (value.trim() ? parseRepoUrl(value) : null), [value]);
  const valid = parsed?.ok ?? false;
  // Feedback appears as soon as there is enough to judge, not on blur: telling
  // someone their URL is wrong after they have moved on is the least useful
  // moment to tell them.
  const showValidation = value.trim().length > 2;

  async function startScan(payload: { url?: string; mode?: 'demo' }) {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { scan?: Scan; error?: ScanError };

      if (!response.ok || !body.scan) {
        setError(
          body.error ?? {
            code: 'internal',
            message: 'Could not start the analysis.',
            retryable: true,
          },
        );
        setSubmitting(false);
        return;
      }
      startTransition(() => router.push(`/scan/${body.scan!.id}`));
    } catch {
      setError({
        code: 'network',
        message: 'Could not reach Sentinel to start the analysis.',
        hint: 'Check your connection and try again.',
        retryable: true,
      });
      setSubmitting(false);
    }
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) {
      inputRef.current?.focus();
      return;
    }
    void startScan({ url: value.trim() });
  }

  const busy = submitting || pending;

  return (
    <div className="w-full">
      <form onSubmit={onSubmit} className="w-full">
        <div
          className={cn(
            'group relative flex flex-col gap-2 overflow-hidden rounded-xl border p-2 transition-colors sm:flex-row sm:items-center',
            'bg-[color-mix(in_oklab,var(--color-panel)_92%,transparent)] backdrop-blur',
            showValidation && !valid
              ? 'border-[color-mix(in_oklab,var(--color-high)_45%,transparent)]'
              : valid
                ? 'border-[color-mix(in_oklab,var(--color-healthy)_45%,transparent)]'
                : 'border-[var(--color-hairline-strong)] focus-within:border-[color-mix(in_oklab,var(--color-signal)_55%,transparent)]',
          )}
        >
          {/*
            Scanning sweep — a quiet hint that this field does something.
            Rendered unconditionally: the `prefers-reduced-motion` rule in
            globals.css neuters the animation, and branching on the JS media
            query here would render differently on the server than on the
            client.
          */}
          {!busy ? (
            <span
              aria-hidden
              className="scanline pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-focus-within:opacity-100"
            />
          ) : null}

          <div className="relative flex flex-1 items-center gap-3 px-3">
            <Github className="size-[18px] shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="https://github.com/username/repository"
              aria-label="GitHub repository URL"
              aria-invalid={showValidation && !valid}
              aria-describedby="repo-input-feedback"
              disabled={busy}
              className="h-11 w-full min-w-0 bg-transparent text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)] disabled:opacity-60"
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={busy}
            iconRight={busy ? undefined : <ArrowRight className="size-4" aria-hidden />}
            className="relative w-full sm:w-auto"
          >
            {busy ? 'Starting' : 'Analyse repository'}
          </Button>
        </div>
      </form>

      <div id="repo-input-feedback" aria-live="polite" className="min-h-[44px] px-1 pt-3">
        <AnimatePresence mode="wait" initial={false}>
          {error ? (
            <Feedback key="error" tone="error" reducedMotion={reducedMotion}>
              <span className="font-medium text-[var(--color-ink)]">{error.message}</span>
              {error.hint ? <span className="text-[var(--color-ink-muted)]"> {error.hint}</span> : null}
            </Feedback>
          ) : showValidation && parsed?.ok ? (
            <Feedback key="valid" tone="valid" reducedMotion={reducedMotion}>
              GitHub repository detected —{' '}
              <span className="mono text-[var(--color-ink)]">{parsed.repo.slug}</span>
              {parsed.repo.ref ? (
                <span className="text-[var(--color-ink-faint)]"> @ {parsed.repo.ref}</span>
              ) : null}
            </Feedback>
          ) : showValidation && parsed && !parsed.ok ? (
            <Feedback key="invalid" tone="warn" reducedMotion={reducedMotion}>
              {parsed.message}
            </Feedback>
          ) : (
            <Feedback key="idle" tone="idle" reducedMotion={reducedMotion}>
              <Lock className="size-3.5" aria-hidden />
              Public repositories analyse instantly. Private repositories need GitHub sign-in, and
              their source is never made public.
            </Feedback>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 px-1 text-[12px]">
        <button
          type="button"
          onClick={() => void startScan({ mode: 'demo' })}
          disabled={busy}
          className="rounded-md border border-[color-mix(in_oklab,var(--color-signal)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-signal)_10%,transparent)] px-2.5 py-1 font-medium text-[var(--color-signal-soft)] transition-colors hover:bg-[color-mix(in_oklab,var(--color-signal)_18%,transparent)] disabled:opacity-50"
        >
          Run the demo analysis
        </button>
        {!demoOnly ? (
          <>
            <span className="text-[var(--color-ink-faint)]">or try</span>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                disabled={busy}
                onClick={() => {
                  setValue(example);
                  inputRef.current?.focus();
                }}
                className="mono rounded-md px-1.5 py-1 text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink-muted)] disabled:opacity-50"
              >
                {example.replace('https://github.com/', '')}
              </button>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

function Feedback({
  children,
  tone,
  reducedMotion,
}: {
  children: React.ReactNode;
  tone: 'idle' | 'valid' | 'warn' | 'error';
  reducedMotion: boolean | null;
}) {
  const icons = {
    idle: null,
    valid: <CheckCircle2 className="size-3.5 text-[var(--color-healthy)]" aria-hidden />,
    warn: <AlertTriangle className="size-3.5 text-[var(--color-high)]" aria-hidden />,
    error: <AlertTriangle className="size-3.5 text-[var(--color-critical)]" aria-hidden />,
  };

  return (
    <motion.p
      initial={reducedMotion ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? undefined : { opacity: 0, y: 4 }}
      transition={{ duration: 0.16 }}
      className="flex items-start gap-2 text-pretty text-[13px] leading-relaxed text-[var(--color-ink-muted)]"
    >
      <span className="mt-0.5 shrink-0">{icons[tone]}</span>
      <span>{children}</span>
    </motion.p>
  );
}
