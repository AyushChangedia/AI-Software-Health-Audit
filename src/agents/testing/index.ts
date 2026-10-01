import type { RawFinding } from '@/types';
import type { Agent, AgentContext, AgentResult } from '../types';
import { breathe } from '../types';

/** Paths whose failure modes cost money or leak data. */
const CRITICAL_PATH = /(payment|billing|checkout|charge|invoice|subscription|auth|login|session|permission|password|token|refund|order)/i;

/**
 * Testing agent.
 *
 * Coverage percentage is a weak signal on its own, so this agent focuses on
 * whether the paths that matter are tested at all.
 */
export const testingAgent: Agent = {
  id: 'testing',

  async run(ctx: AgentContext): Promise<AgentResult> {
    const { index, structure, emit } = ctx;
    const findings: RawFinding[] = [];
    const notes: string[] = [];

    const testFiles = index.files.filter((f) => f.isTest && !f.isVendor);
    const sourceFiles = index.sources;

    emit.activity(`Locating tests across ${index.files.length} files`, 0.15, 0);
    await breathe(ctx.pace);
    emit.log(`${testFiles.length} test files for ${sourceFiles.length} source files`);

    /* --- No tests at all ------------------------------------------ */
    if (testFiles.length === 0 && sourceFiles.length > 5) {
      const finding: RawFinding = {
        ruleId: 'test.none',
        title: 'No automated tests found',
        category: 'testing',
        severity: 'high',
        confidence: 0.9,
        detectedBy: 'testing',
        detectors: ['test-discovery'],
        location: { path: 'package.json' },
        summary: `Sentinel found no test files across ${sourceFiles.length} source files. Nothing prevents a regression from reaching production.`,
        impact:
          'Without tests, every change is verified by hand or not at all. The cost shows up as fear of refactoring long before it shows up as an outage.',
        evidence: [
          {
            kind: 'absence',
            label: 'Test discovery',
            detail:
              'No files matched the conventional test patterns (*.test.*, *.spec.*, test_*.py, *_test.go, tests/ directories).',
          },
        ],
        recommendation:
          'Start where failure is most expensive rather than aiming for a coverage number. One integration test per critical path buys more than a hundred unit tests on getters.',
        rootCauseId: 'no-test-safety-net',
        references: [],
        effortMinutes: 240,
      };
      findings.push(finding);
      emit.finding(finding);
    }

    /* --- Low ratio ------------------------------------------------- */
    const ratio = sourceFiles.length > 0 ? testFiles.length / sourceFiles.length : 0;
    if (testFiles.length > 0 && ratio < 0.15 && sourceFiles.length > 15) {
      const finding: RawFinding = {
        ruleId: 'test.thin-coverage',
        title: `Only ${testFiles.length} test files cover ${sourceFiles.length} source files`,
        category: 'testing',
        severity: 'medium',
        confidence: 0.8,
        detectedBy: 'testing',
        detectors: ['test-discovery'],
        location: { path: testFiles[0]!.path },
        summary: `The test-to-source ratio is ${(ratio * 100).toFixed(0)}%. A healthy codebase of this size usually sits above 30%.`,
        impact:
          'Thin coverage concentrates risk: the untested majority is exactly where regressions land, and there is no signal when they do.',
        evidence: [
          {
            kind: 'code',
            label: 'Ratio',
            detail: `${testFiles.length} test files / ${sourceFiles.length} source files = ${(ratio * 100).toFixed(1)}%`,
          },
          ...(structure.metrics.coverage !== undefined
            ? [
                {
                  kind: 'tool' as const,
                  label: 'Committed coverage report',
                  detail: `${(structure.metrics.coverage * 100).toFixed(1)}% line coverage`,
                  source: 'coverage-summary.json',
                },
              ]
            : []),
        ],
        recommendation:
          'Rank modules by (change frequency × blast radius) and add tests from the top of that list down.',
        rootCauseId: 'no-test-safety-net',
        references: [],
        effortMinutes: 180,
      };
      findings.push(finding);
      emit.finding(finding);
    }

    emit.activity('Mapping tests to critical paths', 0.5, testFiles.length);
    await breathe(ctx.pace);

    /* --- Untested critical paths ----------------------------------- */
    const criticalSources = sourceFiles.filter((f) => CRITICAL_PATH.test(f.path));
    const testCorpus = testFiles.map((f) => `${f.path}\n${f.content}`).join('\n');
    const untested = criticalSources.filter((f) => {
      const stem = f.base.replace(/\.[^.]+$/, '');
      if (stem.length < 4) return false;
      return !testCorpus.includes(stem);
    });

    if (untested.length > 0) {
      emit.log(`${untested.length} critical-path modules have no matching test`);
      const finding: RawFinding = {
        ruleId: 'test.untested-critical-path',
        title: `${untested.length} critical-path ${untested.length === 1 ? 'module has' : 'modules have'} no matching test`,
        category: 'testing',
        severity: untested.length > 3 ? 'high' : 'medium',
        confidence: 0.72,
        detectedBy: 'testing',
        detectors: ['test-discovery'],
        location: index.snippet(untested[0]!.path, 1, 4),
        otherLocations: untested.slice(1, 6).map((f) => ({ path: f.path })),
        summary: `These modules handle payments, authentication or authorisation, and no test file references them: ${untested
          .slice(0, 5)
          .map((f) => f.path)
          .join(', ')}${untested.length > 5 ? `, and ${untested.length - 5} more` : ''}.`,
        impact:
          'These are the paths where a silent regression costs real money or leaks real data. They are also the paths least likely to be exercised by manual testing, because the failure cases are hard to trigger by hand.',
        evidence: [
          {
            kind: 'absence',
            label: 'No referencing test',
            detail: untested
              .slice(0, 6)
              .map((f) => f.path)
              .join('\n'),
          },
          {
            kind: 'reasoning',
            label: 'Method',
            detail:
              'Each critical-path module name was searched for across the full text of every test file. A match is weak evidence of coverage; no match is strong evidence of none.',
          },
        ],
        recommendation:
          'Write one failure-path test per module first — declined payment, expired token, revoked permission. The happy path is usually covered by everyday use; the failure path never is.',
        rootCauseId: 'no-test-safety-net',
        references: [],
        effortMinutes: 120,
      };
      findings.push(finding);
      emit.finding(finding);
    }
    notes.push(`${criticalSources.length} critical-path modules checked`);

    /* --- Skipped tests --------------------------------------------- */
    emit.activity('Checking for disabled tests', 0.75, testFiles.length);
    const skipped = index.search(/\b(?:it|test|describe)\.(?:skip|todo)\s*\(|\bxit\s*\(|@pytest\.mark\.skip|t\.Skip\(/, {
      skipTests: false,
      maxMatches: 30,
    });
    if (skipped.length > 0) {
      const finding: RawFinding = {
        ruleId: 'test.skipped',
        title: `${skipped.length} disabled ${skipped.length === 1 ? 'test' : 'tests'}`,
        category: 'testing',
        severity: 'low',
        confidence: 0.92,
        detectedBy: 'testing',
        detectors: ['test-discovery'],
        location: index.snippet(skipped[0]!.file.path, skipped[0]!.line, 2),
        otherLocations: skipped.slice(1, 6).map((m) => ({ path: m.file.path, startLine: m.line })),
        summary: `${skipped.length} tests are skipped or marked todo. A skipped test looks like coverage in the count but verifies nothing.`,
        impact:
          'Skipped tests are the most misleading artefact in a test suite: they make the green run look more meaningful than it is.',
        evidence: skipped.slice(0, 5).map((m) => ({
          kind: 'code' as const,
          label: 'Skipped',
          detail: m.text.trim().slice(0, 160),
          path: m.file.path,
          line: m.line,
        })),
        recommendation: 'Fix them or delete them. A skipped test that nobody plans to fix is dead code with a misleading name.',
        rootCauseId: 'no-test-safety-net',
        references: [],
        effortMinutes: 45,
      };
      findings.push(finding);
      emit.finding(finding);
    }

    /* --- CI --------------------------------------------------------- */
    const hasCI = index.files.some((f) =>
      /(^\.github\/workflows\/|^\.gitlab-ci\.yml$|^\.circleci\/|^Jenkinsfile$|^\.travis\.yml$|^azure-pipelines\.yml$)/.test(
        f.path,
      ),
    );
    if (!hasCI && testFiles.length > 0) {
      const finding: RawFinding = {
        ruleId: 'test.no-ci',
        title: 'Tests exist but nothing runs them automatically',
        category: 'testing',
        severity: 'medium',
        confidence: 0.88,
        detectedBy: 'testing',
        detectors: ['test-discovery'],
        location: { path: '.github/workflows' },
        summary: `The repository has ${testFiles.length} test files and no CI configuration, so the suite only runs when someone remembers.`,
        impact:
          'A test suite that is not enforced decays. Within a few months it fails for reasons nobody investigates, and then it stops being run at all.',
        evidence: [
          {
            kind: 'absence',
            label: 'No CI configuration',
            detail:
              'Looked for .github/workflows, .gitlab-ci.yml, .circleci/, Jenkinsfile, .travis.yml and azure-pipelines.yml.',
          },
        ],
        recommendation:
          'Add a workflow that runs install, lint, typecheck and test on every pull request, and make it a required check.',
        rootCauseId: 'no-automated-verification',
        references: [],
        effortMinutes: 45,
        patch: {
          path: '.github/workflows/ci.yml',
          language: 'yaml',
          requiresReview: true,
          description: 'Run the test suite on every push and pull request.',
          diff: [
            '--- /dev/null',
            '+++ b/.github/workflows/ci.yml',
            '@@',
            '+name: CI',
            '+on:',
            '+  push:',
            '+    branches: [main]',
            '+  pull_request:',
            '+jobs:',
            '+  verify:',
            '+    runs-on: ubuntu-latest',
            '+    steps:',
            '+      - uses: actions/checkout@v4',
            '+      - uses: actions/setup-node@v4',
            '+        with:',
            '+          node-version: 20',
            '+          cache: npm',
            '+      - run: npm ci',
            '+      - run: npm test',
          ].join('\n'),
        },
      };
      findings.push(finding);
      emit.finding(finding);
    }

    notes.push(`${testFiles.length} test files`);
    if (structure.metrics.coverage !== undefined) {
      notes.push(`${(structure.metrics.coverage * 100).toFixed(0)}% reported line coverage`);
    }

    emit.activity(
      findings.length > 0 ? `${findings.length} testing gaps raised` : 'Test coverage looks proportionate',
      1,
      testFiles.length,
    );
    return { findings, filesScanned: testFiles.length + sourceFiles.length, notes };
  },
};
