import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  Report,
  Scan,
  ScanHistoryPoint,
  SequencedEvent,
  TrackedRepository,
} from '@/types';
import type { Store } from './types';
import { createLogger } from '@/lib/logger';
import { stableId } from '@/lib/id';

const logger = createLogger('store:postgres');

/**
 * Minimal structural type for the bits of `pg` we use, so this file compiles
 * without `@types/pg` being installed.
 */
interface PgQueryResult<R> {
  rows: R[];
  rowCount: number | null;
}
interface PgClient {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PgQueryResult<R>>;
  release(): void;
}
interface PgPool {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PgQueryResult<R>>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}

type ScanRow = {
  id: string;
  workspace_id: string;
  repo: Scan['repo'];
  state: Scan['state'];
  mode: Scan['mode'];
  progress: number;
  status_message: string;
  score: number | null;
  share_id: string | null;
  error: Scan['error'] | null;
  agents: Scan['agents'];
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  duration_ms: number | null;
};

function rowToScan(row: ScanRow): Scan {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    repo: row.repo,
    state: row.state,
    mode: row.mode,
    progress: Number(row.progress),
    statusMessage: row.status_message,
    agents: row.agents ?? [],
    createdAt: row.created_at.toISOString(),
    ...(row.started_at ? { startedAt: row.started_at.toISOString() } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at.toISOString() } : {}),
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
    ...(row.score !== null ? { score: row.score } : {}),
    ...(row.share_id ? { shareId: row.share_id } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

/**
 * Durable adapter. Enabled by setting `DATABASE_URL`.
 *
 * `pg` is loaded lazily with `webpackIgnore` so that the default, zero-config
 * deployment does not need the dependency installed at all.
 */
export class PostgresStore implements Store {
  readonly kind = 'postgres' as const;
  readonly durable = true;
  private pool: PgPool | null = null;
  private migrated: Promise<void> | null = null;

  constructor(private readonly connectionString: string) {}

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    type PgModule = { Pool: new (config: { connectionString: string; max: number }) => PgPool };
    let pg: PgModule;
    try {
      // Indirect specifier: `pg` is an optional peer dependency, so neither the
      // type checker nor the bundler should try to resolve it at build time.
      const specifier = 'pg';
      pg = (await import(/* webpackIgnore: true */ specifier)) as unknown as PgModule;
    } catch {
      throw new Error(
        'DATABASE_URL is set but the "pg" package is not installed. Run `npm install pg` ' +
          'or unset DATABASE_URL to use the built-in store.',
      );
    }
    this.pool = new pg.Pool({ connectionString: this.connectionString, max: 8 });
    return this.pool;
  }

  async migrate(): Promise<void> {
    if (!this.migrated) {
      this.migrated = (async () => {
        const pool = await this.getPool();
        const file = path.join(process.cwd(), 'db', 'migrations', '0001_init.sql');
        const sql = await readFile(file, 'utf8');
        await pool.query(sql);
        logger.info('migrated');
      })();
    }
    return this.migrated;
  }

  private async q<R = Record<string, unknown>>(text: string, values?: unknown[]) {
    await this.migrate();
    const pool = await this.getPool();
    return pool.query<R>(text, values);
  }

  /* ---------------------------------------------------------------- */
  /* Scans                                                             */
  /* ---------------------------------------------------------------- */

  async createScan(scan: Scan): Promise<Scan> {
    await this.q(
      `INSERT INTO workspaces (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
      [scan.workspaceId],
    );
    await this.q(
      `INSERT INTO repositories (id, workspace_id, slug, owner, name, meta)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, slug)
       DO UPDATE SET meta = EXCLUDED.meta, updated_at = now()`,
      [
        stableId('repo', scan.workspaceId, scan.repo.slug.toLowerCase()),
        scan.workspaceId,
        scan.repo.slug,
        scan.repo.owner,
        scan.repo.name,
        JSON.stringify(scan.repo),
      ],
    );
    await this.q(
      `INSERT INTO scans
         (id, workspace_id, repo_slug, repo, state, mode, progress, status_message,
          score, share_id, error, agents, created_at, started_at, finished_at, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO NOTHING`,
      [
        scan.id,
        scan.workspaceId,
        scan.repo.slug,
        JSON.stringify(scan.repo),
        scan.state,
        scan.mode,
        scan.progress,
        scan.statusMessage,
        scan.score ?? null,
        scan.shareId ?? null,
        scan.error ? JSON.stringify(scan.error) : null,
        JSON.stringify(scan.agents),
        scan.createdAt,
        scan.startedAt ?? null,
        scan.finishedAt ?? null,
        scan.durationMs ?? null,
      ],
    );
    return scan;
  }

  async getScan(id: string): Promise<Scan | null> {
    const res = await this.q<ScanRow>(`SELECT * FROM scans WHERE id = $1`, [id]);
    const row = res.rows[0];
    return row ? rowToScan(row) : null;
  }

  async updateScan(id: string, patch: Partial<Scan>): Promise<Scan | null> {
    const current = await this.getScan(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    await this.q(
      `UPDATE scans SET state=$2, mode=$3, progress=$4, status_message=$5, score=$6,
              share_id=$7, error=$8, agents=$9, started_at=$10, finished_at=$11, duration_ms=$12
       WHERE id=$1`,
      [
        id,
        next.state,
        next.mode,
        next.progress,
        next.statusMessage,
        next.score ?? null,
        next.shareId ?? null,
        next.error ? JSON.stringify(next.error) : null,
        JSON.stringify(next.agents),
        next.startedAt ?? null,
        next.finishedAt ?? null,
        next.durationMs ?? null,
      ],
    );
    return next;
  }

  async listScans(workspaceId: string, limit = 50): Promise<Scan[]> {
    const res = await this.q<ScanRow>(
      `SELECT * FROM scans WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [workspaceId, limit],
    );
    return res.rows.map(rowToScan);
  }

  async listScansForRepo(workspaceId: string, slug: string, limit = 25): Promise<Scan[]> {
    const res = await this.q<ScanRow>(
      `SELECT * FROM scans WHERE workspace_id=$1 AND lower(repo_slug)=lower($2)
       ORDER BY created_at DESC LIMIT $3`,
      [workspaceId, slug, limit],
    );
    return res.rows.map(rowToScan);
  }

  /* ---------------------------------------------------------------- */
  /* Reports                                                           */
  /* ---------------------------------------------------------------- */

  async saveReport(report: Report): Promise<void> {
    await this.migrate();
    const pool = await this.getPool();
    const scan = await this.getScan(report.scanId);
    const workspaceId = scan?.workspaceId ?? 'unknown';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO reports (scan_id, workspace_id, repo_slug, mode, payload, generated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (scan_id) DO UPDATE SET payload = EXCLUDED.payload,
                                             generated_at = EXCLUDED.generated_at`,
        [
          report.scanId,
          workspaceId,
          report.repo.slug,
          report.mode,
          JSON.stringify(report),
          report.generatedAt,
        ],
      );

      // Projections. These exist so findings can be queried without unpacking
      // the report blob (dashboards, "is this finding still open?", SARIF export).
      const wipe = [
        'findings',
        'debates',
        'project_scores',
        'dependencies',
        'architecture_nodes',
        'recommendations',
        'agent_runs',
      ];
      for (const table of wipe) {
        await client.query(`DELETE FROM ${table} WHERE scan_id = $1`, [report.scanId]);
      }

      for (const f of report.findings) {
        await client.query(
          `INSERT INTO findings
             (id, scan_id, rule_id, category, severity, confidence, validation, title,
              path, start_line, root_cause, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            f.id,
            report.scanId,
            f.ruleId,
            f.category,
            f.severity,
            f.confidence,
            f.validation,
            f.title,
            f.location.path,
            f.location.startLine ?? null,
            f.rootCauseId,
            JSON.stringify(f),
          ],
        );
      }

      for (const d of report.debates) {
        await client.query(
          `INSERT INTO debates (id, scan_id, finding_id, topic, payload) VALUES ($1,$2,$3,$4,$5)`,
          [d.id, report.scanId, d.findingId, d.topic, JSON.stringify(d)],
        );
      }

      for (const c of report.score.categories) {
        await client.query(
          `INSERT INTO project_scores (scan_id, category, score, weight, findings)
           VALUES ($1,$2,$3,$4,$5)`,
          [report.scanId, c.category, c.score, c.weight, c.findingCount],
        );
      }

      for (const dep of report.dependencies.nodes) {
        await client.query(
          `INSERT INTO dependencies (scan_id, name, ecosystem, version, risk, payload)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (scan_id, ecosystem, name) DO NOTHING`,
          [report.scanId, dep.name, dep.ecosystem, dep.version, dep.risk, JSON.stringify(dep)],
        );
      }

      for (const node of report.architecture.nodes) {
        await client.query(
          `INSERT INTO architecture_nodes (scan_id, node_id, label, kind, risk, payload)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [report.scanId, node.id, node.label, node.kind, node.risk, JSON.stringify(node)],
        );
      }

      for (const rec of report.plan.dependencyRecommendations) {
        await client.query(
          `INSERT INTO recommendations (scan_id, name, ecosystem, reason, payload)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (scan_id, ecosystem, name) DO NOTHING`,
          [report.scanId, rec.name, rec.ecosystem, rec.reason, JSON.stringify(rec)],
        );
      }

      for (const agent of report.agents) {
        await client.query(
          `INSERT INTO agent_runs
             (scan_id, agent_id, state, activity, files_scanned, finding_count, progress,
              started_at, finished_at, error)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            report.scanId,
            agent.agentId,
            agent.state,
            agent.activity,
            agent.filesScanned,
            agent.findingCount,
            agent.progress,
            agent.startedAt ?? null,
            agent.finishedAt ?? null,
            agent.error ?? null,
          ],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getReport(scanId: string): Promise<Report | null> {
    const res = await this.q<{ payload: Report }>(
      `SELECT payload FROM reports WHERE scan_id = $1`,
      [scanId],
    );
    return res.rows[0]?.payload ?? null;
  }

  async getReportByShareId(shareId: string): Promise<{ report: Report; scan: Scan } | null> {
    const res = await this.q<ScanRow>(`SELECT * FROM scans WHERE share_id = $1`, [shareId]);
    const row = res.rows[0];
    if (!row) return null;
    const report = await this.getReport(row.id);
    return report ? { report, scan: rowToScan(row) } : null;
  }

  /* ---------------------------------------------------------------- */
  /* Events                                                            */
  /* ---------------------------------------------------------------- */

  async appendEvents(scanId: string, events: SequencedEvent[]): Promise<void> {
    if (events.length === 0) return;
    const values: unknown[] = [];
    const tuples = events.map((e, i) => {
      values.push(scanId, e.seq, JSON.stringify(e.event));
      return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`;
    });
    await this.q(
      `INSERT INTO scan_events (scan_id, seq, payload) VALUES ${tuples.join(', ')}
       ON CONFLICT (scan_id, seq) DO NOTHING`,
      values,
    );
  }

  async getEvents(scanId: string, sinceSeq = 0): Promise<SequencedEvent[]> {
    const res = await this.q<{ seq: number; payload: SequencedEvent['event'] }>(
      `SELECT seq, payload FROM scan_events WHERE scan_id=$1 AND seq > $2 ORDER BY seq ASC`,
      [scanId, sinceSeq],
    );
    return res.rows.map((r) => ({ seq: r.seq, event: r.payload }));
  }

  /* ---------------------------------------------------------------- */
  /* Repositories                                                      */
  /* ---------------------------------------------------------------- */

  async listRepositories(workspaceId: string): Promise<TrackedRepository[]> {
    const res = await this.q<{
      repo_slug: string;
      repo: Scan['repo'];
      scan_count: string;
      latest_scan_id: string | null;
      latest_score: number | null;
      previous_score: number | null;
      last_scanned_at: Date | null;
      critical_count: string | null;
      high_count: string | null;
    }>(
      `WITH completed AS (
         SELECT s.*, row_number() OVER (PARTITION BY lower(s.repo_slug) ORDER BY s.created_at DESC) AS rn
         FROM scans s WHERE s.workspace_id = $1 AND s.state = 'complete'
       )
       SELECT
         base.repo_slug,
         base.repo,
         base.scan_count,
         latest.id  AS latest_scan_id,
         latest.score AS latest_score,
         prev.score AS previous_score,
         latest.finished_at AS last_scanned_at,
         (SELECT count(*) FROM findings f WHERE f.scan_id = latest.id AND f.severity='critical') AS critical_count,
         (SELECT count(*) FROM findings f WHERE f.scan_id = latest.id AND f.severity='high') AS high_count
       FROM (
         SELECT lower(repo_slug) AS key, max(repo_slug) AS repo_slug,
                (array_agg(repo ORDER BY created_at DESC))[1] AS repo,
                count(*) AS scan_count
         FROM scans WHERE workspace_id = $1 GROUP BY lower(repo_slug)
       ) base
       LEFT JOIN completed latest ON lower(latest.repo_slug) = base.key AND latest.rn = 1
       LEFT JOIN completed prev   ON lower(prev.repo_slug)   = base.key AND prev.rn = 2
       ORDER BY last_scanned_at DESC NULLS LAST`,
      [workspaceId],
    );

    return res.rows.map((row) => ({
      id: stableId('repo', workspaceId, row.repo_slug.toLowerCase()),
      workspaceId,
      repo: row.repo,
      ...(row.latest_scan_id ? { latestScanId: row.latest_scan_id } : {}),
      ...(row.latest_score !== null ? { latestScore: row.latest_score } : {}),
      ...(row.previous_score !== null ? { previousScore: row.previous_score } : {}),
      criticalCount: Number(row.critical_count ?? 0),
      highCount: Number(row.high_count ?? 0),
      ...(row.last_scanned_at ? { lastScannedAt: row.last_scanned_at.toISOString() } : {}),
      scanCount: Number(row.scan_count),
    }));
  }

  async getRepository(workspaceId: string, slug: string): Promise<TrackedRepository | null> {
    const all = await this.listRepositories(workspaceId);
    return all.find((r) => r.repo.slug.toLowerCase() === slug.toLowerCase()) ?? null;
  }

  async history(workspaceId: string, slug: string): Promise<ScanHistoryPoint[]> {
    const res = await this.q<{
      id: string;
      score: number;
      finished_at: Date | null;
      created_at: Date;
      critical_count: string;
      high_count: string;
    }>(
      `SELECT s.id, s.score, s.finished_at, s.created_at,
              (SELECT count(*) FROM findings f WHERE f.scan_id=s.id AND f.severity='critical') AS critical_count,
              (SELECT count(*) FROM findings f WHERE f.scan_id=s.id AND f.severity='high') AS high_count
       FROM scans s
       WHERE s.workspace_id=$1 AND lower(s.repo_slug)=lower($2) AND s.state='complete' AND s.score IS NOT NULL
       ORDER BY s.created_at ASC
       LIMIT 40`,
      [workspaceId, slug],
    );
    return res.rows.map((row, index) => ({
      scanId: row.id,
      index: index + 1,
      score: row.score,
      at: (row.finished_at ?? row.created_at).toISOString(),
      criticalCount: Number(row.critical_count),
      highCount: Number(row.high_count),
    }));
  }
}
