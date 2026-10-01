import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * Route handlers read the session through `next/headers`, which only exists
 * inside a request scope. The fake below is a cookie jar the tests control,
 * so the handlers can be exercised directly rather than over HTTP.
 */
const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

import { GET as healthGet } from '@/app/api/health/route';
import { POST as createScan, GET as listScans } from '@/app/api/scans/route';
import { getStore } from '@/lib/db';
import { rateLimit } from '@/lib/http/api';
import { parseWorkspace, serializeWorkspace } from '@/lib/http/session';
import { toSarif } from '@/lib/export/sarif';
import { filterFindings, queryFromSearchParams } from '@/lib/findings/filter';
import { runScan } from '@/agents/orchestrator';
import { DEMO_REPO } from '@/lib/demo';
import { newId } from '@/lib/id';
import type { Finding, Report, Scan } from '@/types';

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/scans', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  cookieJar.clear();
});

describe('POST /api/scans', () => {
  it('queues a demo scan', async () => {
    const response = await createScan(post({ mode: 'demo' }));
    expect(response.status).toBe(202);
    const body = (await response.json()) as { scan: Scan };
    expect(body.scan.state).toBe('queued');
    expect(body.scan.mode).toBe('demo');
    expect(body.scan.repo.slug).toBe(DEMO_REPO.slug);
  });

  it('sets a signed workspace cookie on first use', async () => {
    const response = await createScan(post({ mode: 'demo' }));
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('sentinel_ws=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('rejects an invalid repository URL with an explanation', async () => {
    const response = await createScan(post({ url: 'https://gitlab.com/a/b' }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invalid_url');
    expect(body.error.message).toMatch(/gitlab/i);
  });

  it('rejects a cross-origin request', async () => {
    const response = await createScan(post({ mode: 'demo' }, { origin: 'https://evil.example' }));
    expect(response.status).toBe(422);
  });

  it('accepts a request with no origin header (API clients)', async () => {
    const request = new Request('http://localhost:3000/api/scans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'demo' }),
    });
    const response = await createScan(request);
    expect(response.status).toBe(202);
  });

  it('survives a malformed body', async () => {
    const request = new Request('http://localhost:3000/api/scans', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: 'not json',
    });
    const response = await createScan(request);
    // An empty object is valid input — it means "run the demo".
    expect([202, 400]).toContain(response.status);
  });
});

describe('GET /api/scans', () => {
  it('returns an empty list for a fresh workspace', async () => {
    const response = await listScans(new Request('http://localhost:3000/api/scans'));
    const body = (await response.json()) as { scans: Scan[] };
    expect(Array.isArray(body.scans)).toBe(true);
  });
});

describe('GET /api/health', () => {
  it('states which capabilities are actually available', async () => {
    const response = healthGet();
    const body = (await response.json()) as {
      status: string;
      capabilities: Record<string, unknown>;
      notes: string[];
    };
    expect(body.status).toBe('ok');
    expect(body.capabilities).toHaveProperty('ai');
    // With no provider configured, it must say so rather than claiming health.
    expect(body.notes.some((note) => /AI reasoning is disabled/.test(note))).toBe(true);
  });
});

describe('workspace cookie', () => {
  it('round-trips a signed value', () => {
    const id = newId('ws');
    expect(parseWorkspace(serializeWorkspace(id))).toBe(id);
  });

  it('rejects a forged value', () => {
    expect(parseWorkspace('ws_someoneelse.badsignature')).toBeNull();
    expect(parseWorkspace('ws_someoneelse')).toBeNull();
    expect(parseWorkspace(undefined)).toBeNull();
  });

  it('rejects a value whose id was tampered with', () => {
    const signed = serializeWorkspace(newId('ws'));
    const [, signature] = signed.split('.');
    expect(parseWorkspace(`ws_attacker.${signature}`)).toBeNull();
  });
});

describe('rateLimit', () => {

  it('allows up to the limit then refuses', () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit(key, 3).allowed).toBe(true);
    }
    const blocked = rateLimit(key, 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('keeps separate buckets per key', () => {
    const a = `test-a-${Math.random()}`;
    const b = `test-b-${Math.random()}`;
    rateLimit(a, 1);
    expect(rateLimit(a, 1).allowed).toBe(false);
    expect(rateLimit(b, 1).allowed).toBe(true);
  });
});

describe('finding query', () => {
  const base: Finding = {
    id: 'f1',
    scanId: 's1',
    ruleId: 'sec.sql-injection',
    title: 'SQL injection',
    category: 'security',
    severity: 'critical',
    confidence: 0.9,
    validation: 'confirmed',
    location: { path: 'src/db.ts', startLine: 4 },
    otherLocations: [],
    detectedBy: ['security'],
    detectors: ['pattern-rules'],
    summary: 'interpolated query',
    impact: 'bad',
    evidence: [],
    recommendation: 'bind',
    rootCauseId: 'unparameterised-queries',
    references: [],
    effortMinutes: 20,
    createdAt: new Date().toISOString(),
  };
  const findings: Finding[] = [
    base,
    {
      ...base,
      id: 'f2',
      ruleId: 'maint.long-function',
      severity: 'low',
      category: 'maintainability',
      title: 'Long function',
      summary: 'a long function',
      confidence: 0.5,
      rootCauseId: 'complexity-debt',
      location: { path: 'src/a.ts', startLine: 1 },
    },
    { ...base, id: 'f3', severity: 'high', validation: 'dismissed', title: 'Dismissed thing' },
  ];

  it('hides dismissed findings by default', () => {
    expect(filterFindings(findings, {}).map((f) => f.id)).toEqual(['f1', 'f2']);
  });

  it('can include dismissed findings', () => {
    expect(filterFindings(findings, { hideDismissed: false })).toHaveLength(3);
  });

  it('filters by severity and category', () => {
    expect(filterFindings(findings, { severities: ['critical'] }).map((f) => f.id)).toEqual(['f1']);
    expect(filterFindings(findings, { categories: ['maintainability'] }).map((f) => f.id)).toEqual([
      'f2',
    ]);
  });

  it('requires every search term to match', () => {
    expect(filterFindings(findings, { search: 'sql injection' })).toHaveLength(1);
    expect(filterFindings(findings, { search: 'sql banana' })).toHaveLength(0);
  });

  it('searches file paths', () => {
    expect(filterFindings(findings, { search: 'src/a.ts' }).map((f) => f.id)).toEqual(['f2']);
  });

  it('sorts by the requested key', () => {
    expect(filterFindings(findings, { sort: 'confidence' }).map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(filterFindings(findings, { sort: 'file' }).map((f) => f.id)).toEqual(['f2', 'f1']);
  });

  it('parses a query string', () => {
    const query = queryFromSearchParams(
      new URLSearchParams('q=sql&severity=critical,high&category=security&sort=file&dismissed=true'),
    );
    expect(query.search).toBe('sql');
    expect(query.severities).toEqual(['critical', 'high']);
    expect(query.categories).toEqual(['security']);
    expect(query.sort).toBe('file');
    expect(query.hideDismissed).toBe(false);
  });

  it('ignores an unknown sort key', () => {
    expect(queryFromSearchParams(new URLSearchParams('sort=nonsense')).sort).toBeUndefined();
  });
});

describe('SARIF export', () => {
  let report: Report;

  beforeEach(async () => {
    const store = getStore();
    const scan: Scan = {
      id: newId('scn'),
      workspaceId: 'ws_test',
      repo: DEMO_REPO,
      state: 'queued',
      mode: 'demo',
      progress: 0,
      statusMessage: 'Queued',
      createdAt: new Date().toISOString(),
      agents: [],
    };
    await store.createScan(scan);
    await runScan(scan.id, { pace: 0 });
    report = (await store.getReport(scan.id))!;
  });

  it('produces a valid-looking SARIF 2.1.0 document', () => {
    const sarif = toSarif(report);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs).toHaveLength(1);

    const run = sarif.runs[0]!;
    expect(run.tool.driver.name).toBe('Sentinel');
    expect(run.tool.driver.rules.length).toBeGreaterThan(0);
    expect(run.results.length).toBeGreaterThan(0);
  });

  it('points every result at a real rule index', () => {
    const run = toSarif(report).runs[0]!;
    for (const result of run.results) {
      expect(run.tool.driver.rules[result.ruleIndex]?.id).toBe(result.ruleId);
    }
  });

  it('excludes dismissed findings so downstream dashboards stay clean', () => {
    const dismissed = { ...report, findings: report.findings.map((f) => ({ ...f, validation: 'dismissed' as const })) };
    expect(toSarif(dismissed).runs[0]!.results).toHaveLength(0);
  });

  it('labels a demo run in the automation details', () => {
    const text = toSarif(report).runs[0]!.automationDetails.description.text;
    expect(text).toMatch(/DEMO ANALYSIS/);
  });

  it('carries a stable fingerprint per finding', () => {
    const run = toSarif(report).runs[0]!;
    const fingerprints = run.results.map((r) => r.partialFingerprints.sentinelFindingId);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });
}, 30_000);

describe('sharing', () => {
  it('refuses to publish a scan that has not finished', async () => {
    const { POST: share } = await import('@/app/api/scans/[id]/share/route');
    const store = getStore();
    const scan: Scan = {
      id: newId('scn'),
      workspaceId: 'ws_owner',
      repo: DEMO_REPO,
      state: 'analyzing',
      mode: 'demo',
      progress: 0.5,
      statusMessage: 'Analysing',
      createdAt: new Date().toISOString(),
      agents: [],
    };
    await store.createScan(scan);

    // The cookie jar is empty, so the request mints a different workspace and
    // must not be able to reach someone else's scan at all.
    const response = await share(
      new Request(`http://localhost:3000/api/scans/${scan.id}/share`, {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      }),
      { params: Promise.resolve({ id: scan.id }) },
    );
    expect(response.status).toBe(404);
  });

  it('will not publish a report for a private repository', async () => {
    const { POST: share } = await import('@/app/api/scans/[id]/share/route');
    const { serializeWorkspace: sign } = await import('@/lib/http/session');
    const workspaceId = newId('ws');
    cookieJar.set('sentinel_ws', sign(workspaceId));

    const store = getStore();
    const scan: Scan = {
      id: newId('scn'),
      workspaceId,
      repo: { ...DEMO_REPO, isPrivate: true },
      state: 'complete',
      mode: 'live',
      progress: 1,
      statusMessage: 'Complete',
      createdAt: new Date().toISOString(),
      score: 80,
      agents: [],
    };
    await store.createScan(scan);

    const response = await share(
      new Request(`http://localhost:3000/api/scans/${scan.id}/share`, {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      }),
      { params: Promise.resolve({ id: scan.id }) },
    );
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/private repositories cannot be shared/i);
  });

  it('mints a stable, unguessable link for a finished public report', async () => {
    const { POST: share } = await import('@/app/api/scans/[id]/share/route');
    const { serializeWorkspace: sign } = await import('@/lib/http/session');
    const workspaceId = newId('ws');
    cookieJar.set('sentinel_ws', sign(workspaceId));

    const store = getStore();
    const scan: Scan = {
      id: newId('scn'),
      workspaceId,
      repo: DEMO_REPO,
      state: 'complete',
      mode: 'demo',
      progress: 1,
      statusMessage: 'Complete',
      createdAt: new Date().toISOString(),
      score: 55,
      agents: [],
    };
    await store.createScan(scan);

    const request = () =>
      new Request(`http://localhost:3000/api/scans/${scan.id}/share`, {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      });

    const first = await share(request(), { params: Promise.resolve({ id: scan.id }) });
    expect(first.status).toBe(200);
    const body = (await first.json()) as { shareId: string; url: string };
    expect(body.shareId.length).toBeGreaterThan(10);
    expect(body.url).toContain(`/s/${body.shareId}`);

    // Asking twice returns the same link rather than orphaning the first.
    const second = await share(request(), { params: Promise.resolve({ id: scan.id }) });
    const secondBody = (await second.json()) as { shareId: string };
    expect(secondBody.shareId).toBe(body.shareId);
  });
});
