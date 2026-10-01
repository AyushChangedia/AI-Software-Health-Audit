#!/usr/bin/env tsx
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeIndex } from '@/lib/analysis/pipeline';
import { ingestLocalDirectory } from '@/lib/analysis/ingest-local';
import { getAIProvider } from '@/lib/ai';
import { toSarif } from '@/lib/export/sarif';
import { SEVERITIES_ORDERED, SEVERITY_META, SEVERITY_ORDER } from '@/lib/constants';
import type { Report, Severity } from '@/types';

/**
 * Sentinel CLI.
 *
 * Audits a checkout already on disk, which is what CI has. It runs the exact
 * same pipeline as the web product — same rules, same validator, same score —
 * so a green CI run and a green report mean the same thing.
 *
 *   npx tsx scripts/audit.ts .
 *   npx tsx scripts/audit.ts . --sarif sentinel.sarif --fail-on high
 */

interface Options {
  root: string;
  json?: string;
  sarif?: string;
  failOn?: Severity;
  quiet: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { root: '.', quiet: false };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--json':
        options.json = argv[++i];
        break;
      case '--sarif':
        options.sarif = argv[++i];
        break;
      case '--fail-on': {
        const value = argv[++i];
        if (!value || !SEVERITIES_ORDERED.includes(value as Severity)) {
          throw new Error(`--fail-on expects one of: ${SEVERITIES_ORDERED.join(', ')}`);
        }
        options.failOn = value as Severity;
        break;
      }
      case '--quiet':
        options.quiet = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}`);
        positional.push(arg);
    }
  }

  if (positional[0]) options.root = positional[0];
  return options;
}

function printUsage() {
  process.stdout.write(
    [
      'Sentinel — audit a repository on disk',
      '',
      'Usage: tsx scripts/audit.ts [path] [options]',
      '',
      'Options:',
      '  --json <file>     Write the full report as JSON',
      '  --sarif <file>    Write SARIF 2.1.0 for code scanning',
      '  --fail-on <sev>   Exit non-zero if any finding is at or above this severity',
      '                    (critical, high, medium, low, info)',
      '  --quiet           Only print the summary line',
      '  -h, --help        Show this message',
      '',
    ].join('\n'),
  );
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

const BOLD = '\u001b[1m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';
const COLOR: Record<Severity, string> = {
  critical: '\u001b[31m',
  high: '\u001b[33m',
  medium: '\u001b[93m',
  low: '\u001b[34m',
  info: '\u001b[90m',
};

const supportsColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const paint = (text: string, code: string) => (supportsColor ? `${code}${text}${RESET}` : text);

function printReport(report: Report, quiet: boolean) {
  const out = (line = '') => process.stdout.write(`${line}\n`);
  const live = report.findings.filter((f) => f.validation !== 'dismissed');

  out();
  out(`${paint('Sentinel', BOLD)} — ${report.repo.slug}`);
  out(
    paint(
      `${report.metrics.analyzedFiles} files · ${report.metrics.loc.toLocaleString('en-US')} lines · analysed in ${(report.durationMs / 1000).toFixed(1)}s`,
      DIM,
    ),
  );
  out();
  out(`${paint('Software health', BOLD)}  ${report.score.overall}/100`);
  out();

  for (const category of report.score.categories) {
    const width = 24;
    const filled = Math.round((category.score / 100) * width);
    const bar = '█'.repeat(filled) + paint('░'.repeat(width - filled), DIM);
    out(`  ${category.category.padEnd(16)} ${bar} ${String(category.score).padStart(3)}`);
  }

  out();
  const counts = report.summary.counts;
  out(
    `  ${SEVERITIES_ORDERED.filter((s) => s !== 'info')
      .map((s) => paint(`${counts[s]} ${SEVERITY_META[s].label.toLowerCase()}`, COLOR[s]))
      .join('   ')}`,
  );
  out();
  out(`  ${report.summary.headline}`);
  if (!quiet) {
    out(paint(`  ${report.summary.detail}`, DIM));
  }

  if (!quiet && live.length > 0) {
    out();
    out(paint('Top findings', BOLD));
    out();
    for (const finding of live.slice(0, 12)) {
      const tag = paint(SEVERITY_META[finding.severity].label.toUpperCase().padEnd(8), COLOR[finding.severity]);
      const where = `${finding.location.path}${finding.location.startLine ? `:${finding.location.startLine}` : ''}`;
      out(`  ${tag} ${finding.title}`);
      out(paint(`           ${where} · ${Math.round(finding.confidence * 100)}% ${finding.validation}`, DIM));
    }
    if (live.length > 12) out(paint(`  …and ${live.length - 12} more`, DIM));
  }

  if (!quiet && report.plan.rootCauses.length > 0) {
    out();
    out(paint('Improvement plan', BOLD));
    out();
    for (const phase of report.plan.phases) {
      out(
        `  ${paint(`Phase ${phase.order}`, DIM)} ${phase.title} ` +
          paint(`(+${phase.expectedScoreGain.toFixed(1)}, ${phase.effortHours[0]}–${phase.effortHours[1]}h)`, DIM),
      );
      for (const action of phase.actions.slice(0, 3)) {
        out(`     ${paint('•', COLOR[action.severity])} ${action.title}`);
      }
    }
  }

  out();
  const unavailable = report.toolchain.filter((tool) => !tool.available);
  if (unavailable.length > 0) {
    out(paint(`Not available: ${unavailable.map((t) => t.name).join(', ')}`, DIM));
  }
  out(paint(report.summary.caveat, DIM));
  out();
}

/* ------------------------------------------------------------------ */

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const quiet = options.quiet;

  if (!quiet) process.stderr.write(`Indexing ${path.resolve(options.root)}…\n`);
  const index = await ingestLocalDirectory(options.root);

  if (index.files.length === 0) {
    process.stderr.write('No analysable files found.\n');
    process.exit(2);
  }

  const ai = getAIProvider();
  const { report } = await analyzeIndex(index, {
    scanId: `cli_${Date.now().toString(36)}`,
    mode: 'live',
    ai,
    pace: 0,
    allowNetwork: process.env.SENTINEL_OFFLINE !== 'true',
    hooks: quiet
      ? {}
      : {
          agentCompleted: (agentId, result) => {
            process.stderr.write(
              `  ${agentId.padEnd(16)} ${String(result.findings.length).padStart(3)} findings\n`,
            );
          },
        },
  });

  printReport(report, quiet);

  if (options.json) {
    await mkdir(path.dirname(path.resolve(options.json)), { recursive: true });
    await writeFile(options.json, JSON.stringify(report, null, 2), 'utf8');
    process.stderr.write(`Wrote ${options.json}\n`);
  }
  if (options.sarif) {
    await mkdir(path.dirname(path.resolve(options.sarif)), { recursive: true });
    await writeFile(options.sarif, JSON.stringify(toSarif(report), null, 2), 'utf8');
    process.stderr.write(`Wrote ${options.sarif}\n`);
  }

  if (options.failOn) {
    const threshold = SEVERITY_ORDER[options.failOn];
    const breaching = report.findings.filter(
      (f) => f.validation !== 'dismissed' && SEVERITY_ORDER[f.severity] <= threshold,
    );
    if (breaching.length > 0) {
      process.stderr.write(
        `\nFailing: ${breaching.length} findings at or above ${options.failOn}.\n`,
      );
      process.exit(1);
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\nSentinel failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
});
