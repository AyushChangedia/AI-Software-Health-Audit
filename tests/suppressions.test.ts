import { describe, expect, it } from 'vitest';
import {
  applySuppressions,
  buildSuppressions,
  globToRegExp,
  parseIgnoreFile,
} from '@/lib/analysis/ignore';
import { RepoIndex, buildRepoFile, type RepoFile } from '@/lib/analysis/repo-index';
import { DEMO_REPO } from '@/lib/demo';
import type { Finding } from '@/types';

function indexOf(files: Record<string, string>): RepoIndex {
  const built: RepoFile[] = [];
  for (const [path, content] of Object.entries(files)) {
    const file = buildRepoFile(path, new TextEncoder().encode(content));
    if (file) built.push(file);
  }
  return new RepoIndex(DEMO_REPO, 'demo', built, {
    totalFiles: built.length,
    skippedFiles: 0,
    truncated: false,
    totalBytes: 0,
  });
}

function finding(path: string, ruleId = 'sec.sql-injection', startLine?: number): Finding {
  return {
    id: `f_${path}_${ruleId}_${startLine ?? 0}`,
    scanId: 's',
    ruleId,
    title: 't',
    category: 'security',
    severity: 'high',
    confidence: 0.8,
    validation: 'likely',
    location: { path, ...(startLine !== undefined ? { startLine } : {}) },
    otherLocations: [],
    detectedBy: ['security'],
    detectors: [],
    summary: '',
    impact: '',
    evidence: [],
    recommendation: '',
    rootCauseId: 'x',
    references: [],
    effortMinutes: 10,
    createdAt: new Date().toISOString(),
  };
}

describe('globToRegExp', () => {
  it('matches a bare filename at any depth', () => {
    const re = globToRegExp('secrets.ts');
    expect(re.test('secrets.ts')).toBe(true);
    expect(re.test('src/lib/secrets.ts')).toBe(true);
    expect(re.test('src/lib/other.ts')).toBe(false);
  });

  it('anchors a path containing a slash', () => {
    const re = globToRegExp('src/demo/file.ts');
    expect(re.test('src/demo/file.ts')).toBe(true);
    expect(re.test('other/src/demo/file.ts')).toBe(false);
  });

  it('treats a single star as one segment', () => {
    const re = globToRegExp('src/rules/*.ts');
    expect(re.test('src/rules/security.ts')).toBe(true);
    expect(re.test('src/rules/nested/security.ts')).toBe(false);
  });

  it('treats a double star as any depth', () => {
    const re = globToRegExp('tests/**');
    expect(re.test('tests/a.test.ts')).toBe(true);
    expect(re.test('tests/deep/nested/a.test.ts')).toBe(true);
    expect(re.test('src/a.ts')).toBe(false);
  });

  it('matches a directory prefix', () => {
    const re = globToRegExp('fixtures/');
    expect(re.test('fixtures/a.ts')).toBe(true);
  });

  it('escapes regex metacharacters in the glob', () => {
    const re = globToRegExp('src/a+b(c).ts');
    expect(re.test('src/a+b(c).ts')).toBe(true);
    expect(re.test('src/aXbc.ts')).toBe(false);
  });
});

describe('parseIgnoreFile', () => {
  it('skips comments and blank lines', () => {
    expect(parseIgnoreFile('# note\n\n  \nsrc/a.ts\n')).toHaveLength(1);
  });

  it('reads the rule scope after the glob', () => {
    const rules = parseIgnoreFile('tests/**   sec. dep.known-vulnerability');
    expect(rules[0]!.rules).toEqual(['sec.', 'dep.known-vulnerability']);
  });

  it('marks negations', () => {
    const rules = parseIgnoreFile('tests/**\n!tests/real.ts');
    expect(rules[1]!.negated).toBe(true);
  });
});

describe('buildSuppressions', () => {
  it('does nothing when no config is present', () => {
    const matcher = buildSuppressions(indexOf({ 'src/a.ts': 'const a = 1;' }));
    expect(matcher.configured).toBe(false);
    expect(matcher.suppresses(finding('src/a.ts'))).toBe(false);
  });

  it('suppresses every rule for a path with no scope', () => {
    const matcher = buildSuppressions(
      indexOf({ '.sentinelignore': 'src/demo/**', 'src/demo/a.ts': 'x' }),
    );
    expect(matcher.suppresses(finding('src/demo/a.ts'))).toBe(true);
    expect(matcher.suppresses(finding('src/demo/a.ts', 'bug.empty-catch'))).toBe(true);
    expect(matcher.suppresses(finding('src/real.ts'))).toBe(false);
  });

  it('honours a rule scope', () => {
    const matcher = buildSuppressions(
      indexOf({ '.sentinelignore': 'tests/**  sec.', 'tests/a.ts': 'x' }),
    );
    expect(matcher.suppresses(finding('tests/a.ts', 'sec.sql-injection'))).toBe(true);
    expect(matcher.suppresses(finding('tests/a.ts', 'bug.empty-catch'))).toBe(false);
  });

  it('accepts both `sec.` and `sec.*` as prefixes', () => {
    const dot = buildSuppressions(indexOf({ '.sentinelignore': 'a/**  sec.', 'a/x.ts': 'x' }));
    const star = buildSuppressions(indexOf({ '.sentinelignore': 'a/**  sec.*', 'a/x.ts': 'x' }));
    expect(dot.suppresses(finding('a/x.ts', 'sec.ssrf'))).toBe(true);
    expect(star.suppresses(finding('a/x.ts', 'sec.ssrf'))).toBe(true);
  });

  it('lets a later negation re-include a path', () => {
    const matcher = buildSuppressions(
      indexOf({
        '.sentinelignore': 'tests/**\n!tests/real-config.ts',
        'tests/a.ts': 'x',
        'tests/real-config.ts': 'x',
      }),
    );
    expect(matcher.suppresses(finding('tests/a.ts'))).toBe(true);
    expect(matcher.suppresses(finding('tests/real-config.ts'))).toBe(false);
  });

  it('honours an inline next-line comment', () => {
    const matcher = buildSuppressions(
      indexOf({
        'src/a.ts': ['const x = 1;', '// sentinel-disable-next-line sec.sql-injection', 'query(x);'].join('\n'),
      }),
    );
    expect(matcher.suppresses(finding('src/a.ts', 'sec.sql-injection', 3))).toBe(true);
    expect(matcher.suppresses(finding('src/a.ts', 'sec.sql-injection', 1))).toBe(false);
    expect(matcher.suppresses(finding('src/a.ts', 'bug.empty-catch', 3))).toBe(false);
  });

  it('honours an inline file-level comment', () => {
    const matcher = buildSuppressions(
      indexOf({ 'src/a.ts': '// sentinel-disable-file\nconst x = 1;' }),
    );
    expect(matcher.suppresses(finding('src/a.ts', 'anything', 2))).toBe(true);
  });

  it('honours a same-line comment', () => {
    const matcher = buildSuppressions(
      indexOf({ 'src/a.ts': 'query(x); // sentinel-disable-line sec.sql-injection' }),
    );
    expect(matcher.suppresses(finding('src/a.ts', 'sec.sql-injection', 1))).toBe(true);
  });
});

describe('applySuppressions', () => {
  it('partitions rather than discards, so the count can be reported', () => {
    const matcher = buildSuppressions(
      indexOf({ '.sentinelignore': 'src/demo/**', 'src/demo/a.ts': 'x' }),
    );
    const result = applySuppressions([finding('src/demo/a.ts'), finding('src/real.ts')], matcher);
    expect(result.kept).toHaveLength(1);
    expect(result.suppressed).toHaveLength(1);
  });

  it('is a pass-through when nothing is configured', () => {
    const matcher = buildSuppressions(indexOf({ 'src/a.ts': 'x' }));
    const findings = [finding('src/a.ts')];
    expect(applySuppressions(findings, matcher).kept).toBe(findings);
  });
});
