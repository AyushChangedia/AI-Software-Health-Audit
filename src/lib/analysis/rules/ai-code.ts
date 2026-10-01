import type { PatternRule } from '../rule-engine';
import { JS_LANGS } from '../rule-engine';

/**
 * AI-assisted code patterns.
 *
 * Important: none of these detect "this was written by an AI". They detect
 * patterns that correlate with fast, high-volume, assistant-supported
 * development — the same patterns appear in code written under deadline
 * pressure. The wording throughout says "pattern", never "generated".
 */
export const AI_CODE_RULES: PatternRule[] = [
  {
    id: 'ai.placeholder-implementation',
    title: 'Placeholder left in place of an implementation',
    category: 'ai-code',
    agent: 'ai-code',
    severity: 'high',
    confidence: 0.88,
    pattern:
      /throw new Error\s*\(\s*['"](?:not implemented|unimplemented|todo)/i,
    rootCauseId: 'incomplete-implementations',
    effortMinutes: 60,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` throws instead of doing the work it is named for.`,
    impact:
      'A placeholder that survives into main fails at runtime rather than at build time. Whoever calls it discovers the gap in production.',
    recommendation:
      'Implement the function, or remove it and its call sites. If it is a deliberate interface stub, mark it abstract so the type system enforces the contract.',
    references: [],
  },
  {
    id: 'ai.todo-implement',
    title: 'Unfinished work marked in a comment',
    category: 'ai-code',
    agent: 'ai-code',
    severity: 'low',
    confidence: 0.9,
    pattern: /(?:\/\/|#|\*)\s*(?:TODO|FIXME|HACK|XXX)\b[:\s]/,
    pathFilter: (p) => !/\.(md|mdx|txt)$/i.test(p),
    maxMatches: 30,
    rootCauseId: 'incomplete-implementations',
    effortMinutes: 20,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` — ${ctx.match.text.trim().slice(0, 120)}`,
    impact:
      'Individually harmless. In volume, these mark the seams where the implementation stopped short, and they cluster around the parts of the system nobody has revisited.',
    recommendation:
      'Convert the ones that matter into tracked issues and delete the rest. A comment is not a backlog.',
    references: [],
  },
  {
    id: 'ai.redundant-wrapper',
    title: 'Wrapper function that only forwards its arguments',
    category: 'ai-code',
    agent: 'ai-code',
    severity: 'low',
    confidence: 0.7,
    languages: JS_LANGS,
    pattern:
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{\s*return\s+(?:await\s+)?\w+\(\s*\2\s*\)\s*;?\s*\}/,
    rootCauseId: 'unnecessary-indirection',
    effortMinutes: 15,
    summary: (ctx) =>
      `\`${ctx.match.groups[0] || 'A wrapper'}\` in \`${ctx.match.file.path}:${ctx.match.line}\` forwards its arguments unchanged to another function.`,
    impact:
      'Each layer of pass-through indirection costs a jump when reading, and hides where behaviour actually lives. It is the most common shape of accidental abstraction.',
    recommendation:
      'Call the underlying function directly and delete the wrapper — unless it exists to pin a stable public API, in which case document that.',
    references: [],
  },
  {
    id: 'ai.inconsistent-error-shape',
    title: 'Errors returned as values in one place and thrown in another',
    category: 'ai-code',
    agent: 'ai-code',
    severity: 'medium',
    confidence: 0.55,
    languages: JS_LANGS,
    pattern: /return\s*\{\s*(?:error|success)\s*:/,
    nearby: { pattern: /throw new/, before: 30, after: 30, mustExist: true },
    maxMatches: 15,
    rootCauseId: 'inconsistent-error-contract',
    effortMinutes: 45,
    summary: (ctx) =>
      `\`${ctx.match.file.path}\` both returns error objects and throws exceptions (line ${ctx.match.line}).`,
    impact:
      'Callers cannot know which convention applies without reading each function. Mixed conventions are where "the error disappeared" bugs come from.',
    recommendation:
      'Pick one contract per layer — throw across boundaries, return typed results inside a module — and apply it consistently.',
    references: [],
  },
  {
    id: 'ai.console-logging',
    title: 'Ad-hoc console logging in application code',
    category: 'ai-code',
    agent: 'ai-code',
    severity: 'low',
    confidence: 0.85,
    languages: JS_LANGS,
    pattern: /console\.(?:log|debug|info)\s*\(/,
    pathFilter: (p) => !/(scripts?|bin|cli|tools)\//.test(p),
    maxMatches: 25,
    rootCauseId: 'no-logging-strategy',
    effortMinutes: 30,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` logs to the console directly.`,
    impact:
      'Console output has no level, no structure and no correlation id, so it cannot be filtered or searched in production. It also leaks whatever was passed in, including request bodies.',
    recommendation:
      'Route logs through one logger module with levels and structured fields, and redact known-sensitive keys there once.',
    references: [],
  },
  {
    id: 'ai.magic-config',
    title: 'Configuration value hard-coded at the call site',
    category: 'ai-code',
    agent: 'ai-code',
    severity: 'low',
    confidence: 0.6,
    pattern: /https?:\/\/(?:localhost|127\.0\.0\.1|\w+\.(?:com|io|dev|net))[^\s'"`)]*/,
    pathFilter: (p) => !/(test|spec|example|readme|doc)/i.test(p),
    excludeLine: /(?:@|https?:\/\/(?:github|cwe\.mitre|owasp|developer\.mozilla|www\.w3))/i,
    maxMatches: 20,
    rootCauseId: 'hardcoded-configuration',
    effortMinutes: 20,
    summary: (ctx) =>
      `\`${ctx.match.file.path}:${ctx.match.line}\` hard-codes the URL \`${ctx.match.match.slice(0, 60)}\`.`,
    impact:
      'Environment-specific values in source mean the same build cannot be promoted between environments, and a staging URL can reach production unnoticed.',
    recommendation:
      'Move the value into configuration, validated once at startup so a missing variable fails fast rather than at first use.',
    references: [],
  },
];
