'use client';

import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { highlightLine, TOKEN_CLASS } from '@/lib/highlight';
import { cn } from '@/lib/utils';

/**
 * Code rendering.
 *
 * Repository source is untrusted input. It is tokenized into an array and
 * rendered as React children, never as HTML, so nothing in a scanned file can
 * become markup on this page.
 */
export function CodeBlock({
  code,
  language,
  startLine = 1,
  highlightLines = [],
  className,
  maxHeight = 340,
  showLineNumbers = true,
  filename,
}: {
  code: string;
  language?: string;
  startLine?: number;
  /** Absolute line numbers to mark. */
  highlightLines?: number[];
  className?: string;
  maxHeight?: number;
  showLineNumbers?: boolean;
  filename?: string;
}) {
  const lines = useMemo(() => code.replace(/\n$/, '').split('\n'), [code]);
  const marked = useMemo(() => new Set(highlightLines), [highlightLines]);
  const gutterWidth = String(startLine + lines.length).length;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[#0a0c0f]',
        className,
      )}
    >
      {filename ? (
        <div className="flex items-center justify-between border-b border-[var(--color-hairline)] bg-[var(--color-panel)] px-3 py-2">
          <span className="mono truncate text-[var(--color-ink-muted)]">{filename}</span>
          <CopyButton value={code} />
        </div>
      ) : null}
      <div className="overflow-auto" style={{ maxHeight }}>
        <pre className="mono w-max min-w-full leading-[1.7]">
          <code>
            {lines.map((line, index) => {
              const lineNumber = startLine + index;
              const isMarked = marked.has(lineNumber);
              return (
                <div
                  key={lineNumber}
                  className={cn(
                    'flex px-3',
                    isMarked &&
                      'bg-[color-mix(in_oklab,var(--color-critical)_12%,transparent)] shadow-[inset_2px_0_0_var(--color-critical)]',
                  )}
                >
                  {showLineNumbers ? (
                    <span
                      aria-hidden
                      className="tabular mr-4 shrink-0 select-none text-right text-[var(--color-ink-faint)]"
                      style={{ width: `${gutterWidth}ch` }}
                    >
                      {lineNumber}
                    </span>
                  ) : null}
                  <span className="whitespace-pre">
                    {highlightLine(line, language ?? '').map((token, i) => (
                      <span key={i} className={TOKEN_CLASS[token.kind]}>
                        {token.text}
                      </span>
                    ))}
                    {line === '' ? ' ' : null}
                  </span>
                </div>
              );
            })}
          </code>
        </pre>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diff                                                                */
/* ------------------------------------------------------------------ */

type DiffLineKind = 'add' | 'remove' | 'context' | 'meta' | 'hunk';

function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'remove';
  return 'context';
}

const DIFF_CLASS: Record<DiffLineKind, string> = {
  add: 'bg-[color-mix(in_oklab,var(--color-healthy)_12%,transparent)] text-[#8ddb9c]',
  remove: 'bg-[color-mix(in_oklab,var(--color-critical)_12%,transparent)] text-[#ff9d97]',
  context: 'text-[var(--color-ink-muted)]',
  meta: 'text-[var(--color-ink-faint)]',
  hunk: 'text-[var(--color-signal-soft)] bg-[color-mix(in_oklab,var(--color-signal)_8%,transparent)]',
};

export function DiffView({ diff, className }: { diff: string; className?: string }) {
  const lines = useMemo(() => diff.replace(/\n$/, '').split('\n'), [diff]);
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-[#0a0c0f]',
        className,
      )}
    >
      <div className="max-h-[420px] overflow-auto">
        <pre className="mono w-max min-w-full leading-[1.7]">
          <code>
            {lines.map((line, index) => {
              const kind = classifyDiffLine(line);
              return (
                <div key={index} className={cn('px-3 whitespace-pre', DIFF_CLASS[kind])}>
                  {line || ' '}
                </div>
              );
            })}
          </code>
        </pre>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

export function CopyButton({
  value,
  label = 'Copy',
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      // Clipboard access is denied in some embedded contexts; say so rather
      // than showing a success tick that did nothing.
      setState('failed');
    }
    setTimeout(() => setState('idle'), 1_800);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
        state === 'copied'
          ? 'text-[var(--color-healthy)]'
          : state === 'failed'
            ? 'text-[var(--color-high)]'
            : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]',
        className,
      )}
      aria-live="polite"
    >
      {state === 'copied' ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy blocked' : label}
    </button>
  );
}
