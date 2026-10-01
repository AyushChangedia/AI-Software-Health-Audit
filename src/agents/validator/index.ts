import { z } from 'zod';
import type {
  AgentId,
  Debate,
  DebateTurn,
  Finding,
  ValidationStatus,
} from '@/types';
import type { AgentContext } from '../types';
import { breathe } from '../types';
import { issueClass } from '@/lib/analysis/dedupe';
import { isFrameworkEntry } from '@/lib/analysis/graph';
import { AGENTS } from '@/lib/constants';
import { stableId } from '@/lib/id';

/**
 * The Validator.
 *
 * This is the part of Sentinel that makes the rest trustworthy. Its job is not
 * to agree with the other agents — it is to look for the reason they might be
 * wrong, state it, and downgrade the finding when it holds.
 *
 * Each check below is a concrete question answered against the repository:
 * is this file reachable? does a mitigating control exist? is the package
 * actually imported? The answers become the debate transcript the report shows,
 * so a reader can follow exactly how the confidence number was reached.
 */

export interface ValidationOutcome {
  status: ValidationStatus;
  confidence: number;
  rationale: string;
  debate?: Debate;
}

interface Signal {
  /** Positive values support the finding, negative undermine it. */
  weight: number;
  label: string;
  detail: string;
  /** The agent best placed to raise this point in a debate. */
  voice: AgentId;
  citation?: { path: string; line?: number };
}

/* ------------------------------------------------------------------ */
/* Reachability                                                        */
/* ------------------------------------------------------------------ */

/**
 * Files reachable from a framework entry point by following imports.
 *
 * A finding in an unreachable file is real code but not a live risk, and
 * saying so is more useful than inflating the critical count.
 */
function computeReachable(ctx: AgentContext): Set<string> {
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const node of ctx.graph.nodes.values()) {
    if (isFrameworkEntry(node.path)) {
      reachable.add(node.path);
      queue.push(node.path);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = ctx.graph.nodes.get(current);
    if (!node) continue;
    for (const ref of node.imports) {
      if (!ref.resolved || reachable.has(ref.resolved)) continue;
      reachable.add(ref.resolved);
      queue.push(ref.resolved);
    }
  }
  return reachable;
}

/* ------------------------------------------------------------------ */
/* Deterministic checks                                                */
/* ------------------------------------------------------------------ */

function gatherSignals(ctx: AgentContext, finding: Finding, reachable: Set<string>): Signal[] {
  const signals: Signal[] = [];
  const { index } = ctx;
  const path = finding.location.path;
  const file = index.file(path);
  const klass = issueClass(finding.ruleId);

  /* --- Corroboration -------------------------------------------- */
  if (finding.detectedBy.length > 1) {
    signals.push({
      weight: 0.12,
      label: 'Independent corroboration',
      detail: `${finding.detectedBy.map((id) => AGENTS[id].name).join(' and ')} reached the same conclusion from different starting points.`,
      voice: 'orchestrator',
    });
  }

  /* --- Reachability ---------------------------------------------- */
  if (file && !finding.ruleId.startsWith('dep.') && ctx.graph.nodes.size > 0) {
    if (reachable.size > 0 && !reachable.has(path) && !isFrameworkEntry(path)) {
      signals.push({
        weight: -0.28,
        label: 'Not reachable from an entry point',
        detail: `Following imports from every framework entry point never arrives at \`${path}\`. The code is present but nothing appears to call it.`,
        voice: 'architecture',
        citation: { path },
      });
    } else if (reachable.has(path)) {
      signals.push({
        weight: 0.08,
        label: 'Reachable from an entry point',
        detail: `\`${path}\` is reachable by following imports from an application entry point.`,
        voice: 'architecture',
        citation: { path },
      });
    }
  }

  if (file?.isTest) {
    signals.push({
      weight: -0.3,
      label: 'Test-only code',
      detail: 'The match is inside a test file, which does not ship and does not handle live input.',
      voice: 'testing',
      citation: { path },
    });
  }

  /* --- Issue-specific mitigations --------------------------------- */
  switch (klass) {
    case 'injection.sql': {
      const line = finding.location.startLine
        ? (file?.lines[finding.location.startLine - 1] ?? '')
        : '';
      if (/\$\d|\?\s*[,)]|:\w+/.test(line)) {
        signals.push({
          weight: -0.45,
          label: 'Parameter placeholders present',
          detail: 'The same statement already uses bind placeholders, so the interpolated part is likely a table or column name rather than a value.',
          voice: 'architecture',
          citation: { path, ...(finding.location.startLine ? { line: finding.location.startLine } : {}) },
        });
      }
      const usesOrm = index.exists(/@prisma\/client|drizzle-orm|sequelize|typeorm|sqlalchemy|knex/, {
        pathFilter: (p) => p === path || p.endsWith('package.json'),
        skipTests: false,
      });
      if (usesOrm) {
        signals.push({
          weight: -0.08,
          label: 'ORM available',
          detail: 'The project uses an ORM elsewhere, so this raw query is a deliberate exception — worth asking why.',
          voice: 'architecture',
        });
      }
      break;
    }

    case 'ssrf': {
      const guard = index.exists(
        /isPrivateIp|isAllowedHost|allowlist|allowList|ALLOWED_HOSTS|blockPrivate|ipaddress\.ip_address/i,
      );
      if (guard) {
        signals.push({
          weight: -0.3,
          label: 'Host-validation helper exists',
          detail: 'The repository defines a host allow-list or private-IP check. Whether this call site uses it could not be confirmed statically.',
          voice: 'security',
        });
      } else {
        signals.push({
          weight: 0.12,
          label: 'No host validation anywhere',
          detail: 'No allow-list or private-address check exists anywhere in the repository, so no call site can be using one.',
          voice: 'security',
        });
      }
      break;
    }

    case 'input-validation': {
      const hasValidator = index.exists(/from ['"](?:zod|yup|joi|valibot|superstruct|pydantic)/, {
        skipTests: false,
      });
      signals.push(
        hasValidator
          ? {
              weight: -0.2,
              label: 'Validation library present',
              detail: 'A schema validation library is used elsewhere in the project, so the convention exists — this endpoint is an exception rather than a gap in the design.',
              voice: 'architecture',
            }
          : {
              weight: 0.15,
              label: 'No validation library anywhere',
              detail: 'No schema validation library is imported anywhere in the repository. Input validation is absent by design, not by omission.',
              voice: 'security',
            },
      );
      break;
    }

    case 'exposed-credential': {
      const gitignore = index.file('.gitignore')?.content ?? '';
      if (/\.env/.test(gitignore) && /\.env/.test(path)) {
        signals.push({
          weight: 0.1,
          label: 'Ignored but still tracked',
          detail: '.gitignore lists .env, yet the file is present in the archive — it was committed before the rule was added and is still tracked.',
          voice: 'security',
          citation: { path: '.gitignore' },
        });
      }
      if (/example|sample|template|fixture/i.test(path)) {
        signals.push({
          weight: -0.35,
          label: 'Template file',
          detail: 'The value lives in a file whose name marks it as an example, so it is probably illustrative.',
          voice: 'maintainability',
          citation: { path },
        });
      }
      break;
    }

    case 'dependency': {
      const packageName = /`([^`]+)`/.exec(finding.summary)?.[1] ?? '';
      const node = ctx.dependencies.report.nodes.find((n) => n.name === packageName);
      if (node) {
        if (node.usedIn.length === 0) {
          signals.push({
            weight: -0.2,
            label: 'No import site found',
            detail: `\`${node.name}\` is declared but Sentinel found no import of it. The vulnerable code may never load at runtime.`,
            voice: 'dependencies',
          });
        } else {
          signals.push({
            weight: 0.15,
            label: 'Package is imported',
            detail: `\`${node.name}\` is imported in ${node.usedIn.length} ${node.usedIn.length === 1 ? 'file' : 'files'}, including ${node.usedIn[0]}.`,
            voice: 'dependencies',
            citation: { path: node.usedIn[0]! },
          });
        }
        if (node.dev) {
          signals.push({
            weight: -0.15,
            label: 'Development dependency',
            detail: 'The package is declared as a dev dependency, so it does not ship to production.',
            voice: 'dependencies',
          });
        }
      }
      break;
    }

    case 'injection.xss': {
      if (index.exists(/dompurify|sanitize-html|bleach/i, { skipTests: false })) {
        signals.push({
          weight: -0.22,
          label: 'Sanitiser available',
          detail: 'A HTML sanitiser is a dependency of this project. Whether it wraps this specific injection point could not be confirmed from the snippet.',
          voice: 'security',
        });
      }
      break;
    }

    case 'auth-verification': {
      const verifies = index.exists(/jwt\.verify|jwtVerify|verifyToken|decode\([^)]*verify\s*=\s*True/);
      if (verifies) {
        signals.push({
          weight: -0.2,
          label: 'Verification exists elsewhere',
          detail: 'The project calls a verifying API somewhere. This call site may be a deliberate read of an already-verified token.',
          voice: 'architecture',
        });
      }
      break;
    }

    default:
      break;
  }

  /* --- Evidence quality ------------------------------------------- */
  const hasDirectCode = finding.evidence.some((e) => e.kind === 'code' && e.line !== undefined);
  if (!hasDirectCode && !finding.ruleId.startsWith('dep.') && !finding.ruleId.startsWith('test.')) {
    signals.push({
      weight: -0.1,
      label: 'No line-level evidence',
      detail: 'The finding is supported by file-level observation rather than a specific line.',
      voice: 'validator',
    });
  }

  return signals;
}

/* ------------------------------------------------------------------ */
/* AI adjudication                                                     */
/* ------------------------------------------------------------------ */

const verdictSchema = z.object({
  verdict: z.enum(['confirmed', 'likely', 'potential', 'dismissed']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(20).max(600),
  counterargument: z.string().max(600).optional(),
});

async function adjudicateWithAI(
  ctx: AgentContext,
  finding: Finding,
  signals: Signal[],
): Promise<z.infer<typeof verdictSchema> | null> {
  if (!ctx.ai.available) return null;

  return ctx.ai.structured({
    purpose: 'validate-finding',
    system:
      'You are the validator in a multi-agent code audit. Other agents propose findings; you decide what survives. ' +
      'You are rewarded for catching false positives, not for agreeing. ' +
      'Judge only from the evidence provided — if exploitability is not demonstrated by the code shown, the verdict is at most "likely". ' +
      'Use "dismissed" when a mitigating control makes the finding wrong.',
    prompt: [
      `Finding: ${finding.title}`,
      `Rule: ${finding.ruleId}`,
      `Severity claimed: ${finding.severity}`,
      `Detector confidence: ${finding.confidence.toFixed(2)}`,
      `Raised by: ${finding.detectedBy.join(', ')}`,
      `Location: ${finding.location.path}${finding.location.startLine ? `:${finding.location.startLine}` : ''}`,
      '',
      'Code:',
      '```',
      finding.location.snippet?.slice(0, 1_200) ?? '(no snippet)',
      '```',
      '',
      'Analyzer summary:',
      finding.summary,
      '',
      'Static checks the validator already ran:',
      ...signals.map((s) => `- ${s.weight >= 0 ? 'SUPPORTS' : 'UNDERMINES'}: ${s.label} — ${s.detail}`),
      '',
      'Return {"verdict":"confirmed|likely|potential|dismissed","confidence":0.0,"rationale":"...","counterargument":"..."}.',
      'The counterargument is the strongest case *against* this finding, even if you confirm it.',
    ].join('\n'),
    schema: verdictSchema,
    maxTokens: 700,
  });
}

/* ------------------------------------------------------------------ */
/* Debate construction                                                 */
/* ------------------------------------------------------------------ */

function buildDebate(
  scanId: string,
  finding: Finding,
  signals: Signal[],
  before: number,
  after: number,
  status: ValidationStatus,
  rationale: string,
  aiCounter?: string,
): Debate | null {
  const objections = signals.filter((s) => s.weight < 0);
  // A debate is only interesting when somebody actually disagreed.
  if (objections.length === 0 && !aiCounter) return null;

  const claimant = finding.detectedBy[0] ?? 'security';
  const strongest = objections.sort((a, b) => a.weight - b.weight)[0];
  const challenger = strongest?.voice ?? 'validator';

  const turns: DebateTurn[] = [
    {
      agent: claimant,
      stance: 'claim',
      message: `${finding.title}. ${finding.summary}`,
      confidence: before,
      ...(finding.location.startLine
        ? { citation: { path: finding.location.path, line: finding.location.startLine } }
        : { citation: { path: finding.location.path } }),
    },
  ];

  if (strongest) {
    turns.push({
      agent: challenger,
      stance: 'challenge',
      message: `${strongest.label}. ${strongest.detail}`,
      ...(strongest.citation ? { citation: strongest.citation } : {}),
    });
  }

  const supports = signals.filter((s) => s.weight > 0).sort((a, b) => b.weight - a.weight)[0];
  if (supports) {
    turns.push({
      agent: claimant,
      stance: 'rebuttal',
      message: `${supports.label}. ${supports.detail}`,
      ...(supports.citation ? { citation: supports.citation } : {}),
    });
  }

  turns.push({
    agent: 'validator',
    stance: 'test',
    message: `Weighing ${signals.length} static ${signals.length === 1 ? 'signal' : 'signals'} against the detector's own confidence of ${(before * 100).toFixed(0)}%.`,
  });

  if (aiCounter) {
    turns.push({
      agent: 'validator',
      stance: 'challenge',
      message: `Strongest case against: ${aiCounter}`,
    });
  }

  turns.push({
    agent: 'validator',
    stance: 'verdict',
    message: rationale,
    confidence: after,
  });

  return {
    id: stableId('dbt', scanId, finding.id),
    scanId,
    findingId: finding.id,
    topic: finding.title,
    turns,
    outcome: {
      status,
      confidenceBefore: before,
      confidenceAfter: after,
      rationale,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

function statusFor(confidence: number, dismissed: boolean): ValidationStatus {
  if (dismissed) return 'dismissed';
  if (confidence >= 0.85) return 'confirmed';
  if (confidence >= 0.65) return 'likely';
  return 'potential';
}

export interface ValidationRun {
  findings: Finding[];
  debates: Debate[];
  confirmed: number;
  dismissed: number;
}

/** How many findings get the (slower) AI adjudication pass. */
const AI_BUDGET = 8;

export async function runValidator(
  ctx: AgentContext,
  findings: Finding[],
  hooks: {
    onStart(finding: Finding): void;
    onComplete(finding: Finding, status: ValidationStatus, confidence: number): void;
    onDebate(debate: Debate): void;
  },
): Promise<ValidationRun> {
  const { emit } = ctx;
  const reachable = computeReachable(ctx);
  const debates: Debate[] = [];
  let confirmed = 0;
  let dismissed = 0;
  let aiUsed = 0;

  emit.activity(`Validating ${findings.length} candidate findings`, 0.05, 0);
  emit.log(
    `Reachability map: ${reachable.size} of ${ctx.graph.nodes.size} modules reachable from an entry point`,
  );

  for (let i = 0; i < findings.length; i += 1) {
    const finding = findings[i]!;
    hooks.onStart(finding);
    emit.activity(
      `Testing: ${finding.title.slice(0, 60)}`,
      0.05 + (i / Math.max(1, findings.length)) * 0.9,
      i,
    );

    const signals = gatherSignals(ctx, finding, reachable);
    const before = finding.confidence;

    const delta = signals.reduce((sum, s) => sum + s.weight, 0);
    let confidence = Math.max(0.05, Math.min(0.97, before + delta));
    let isDismissed = confidence < 0.3 || signals.some((s) => s.weight <= -0.4);
    let rationale =
      signals.length === 0
        ? 'No mitigating control found and no counter-evidence available; the detector confidence stands.'
        : describeOutcome(signals, before, confidence);
    let aiCounter: string | undefined;

    // Spend the AI budget on the findings where a wrong call costs most.
    const worthAI =
      aiUsed < AI_BUDGET &&
      (finding.severity === 'critical' || finding.severity === 'high') &&
      finding.location.snippet !== undefined;

    if (worthAI) {
      const verdict = await adjudicateWithAI(ctx, finding, signals);
      aiUsed += 1;
      if (verdict) {
        confidence = Math.max(0.05, Math.min(0.97, (confidence + verdict.confidence) / 2));
        isDismissed = verdict.verdict === 'dismissed';
        rationale = verdict.rationale;
        aiCounter = verdict.counterargument;
        finding.detectors.push(`ai:${ctx.ai.name}`);
      }
    }

    const status = statusFor(confidence, isDismissed);
    finding.confidence = confidence;
    finding.validation = status;
    finding.validatedBy = 'validator';
    finding.evidence.push({
      kind: 'reasoning',
      label: `Validation — ${status}`,
      detail: rationale,
      source: 'validator',
    });

    if (status === 'confirmed') confirmed += 1;
    if (status === 'dismissed') dismissed += 1;

    const debate = buildDebate(
      ctx.scanId,
      finding,
      signals,
      before,
      confidence,
      status,
      rationale,
      aiCounter,
    );
    if (debate) {
      debates.push(debate);
      hooks.onDebate(debate);
    }

    hooks.onComplete(finding, status, confidence);
    await breathe(Math.round(ctx.pace / 2));
  }

  emit.activity(
    `${confirmed} confirmed, ${dismissed} dismissed of ${findings.length}`,
    1,
    findings.length,
  );

  return { findings, debates, confirmed, dismissed };
}

function describeOutcome(signals: Signal[], before: number, after: number): string {
  const against = signals.filter((s) => s.weight < 0);
  const forSignals = signals.filter((s) => s.weight > 0);
  const direction = after > before ? 'raised' : after < before ? 'lowered' : 'unchanged';

  const parts: string[] = [];
  if (forSignals.length > 0) {
    parts.push(`Supporting: ${forSignals.map((s) => s.label.toLowerCase()).join(', ')}.`);
  }
  if (against.length > 0) {
    parts.push(`Against: ${against.map((s) => s.label.toLowerCase()).join(', ')}.`);
  }
  parts.push(
    `Confidence ${direction} from ${(before * 100).toFixed(0)}% to ${(after * 100).toFixed(0)}%.`,
  );
  return parts.join(' ');
}
