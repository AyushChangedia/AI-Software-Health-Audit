import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
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

const logger = createLogger('store:memory');

/** Events kept per scan. Enough to replay a full run into a late subscriber. */
const MAX_EVENTS_PER_SCAN = 4_000;
/** Scans retained before the oldest are evicted. */
const MAX_SCANS = 500;

interface Snapshot {
  version: 1;
  scans: Scan[];
  reports: Report[];
  events: [string, SequencedEvent[]][];
}

/**
 * Default store. Everything lives in memory; if `persistDir` is set the state
 * is mirrored to a JSON file so a dev-server restart does not wipe the
 * dashboard. Writes are debounced and atomic (write-temp + rename).
 */
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  readonly durable = false;

  private scans = new Map<string, Scan>();
  private reports = new Map<string, Report>();
  private events = new Map<string, SequencedEvent[]>();
  private flushTimer: NodeJS.Timeout | null = null;
  private loaded: Promise<void> | null = null;

  constructor(private readonly persistDir: string | null = null) {}

  /* ---------------------------------------------------------------- */
  /* Persistence                                                       */
  /* ---------------------------------------------------------------- */

  private get file() {
    return this.persistDir ? path.join(this.persistDir, 'store.json') : null;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.file) return;
    if (!this.loaded) {
      this.loaded = (async () => {
        try {
          const raw = await readFile(this.file!, 'utf8');
          const snapshot = JSON.parse(raw) as Snapshot;
          if (snapshot.version !== 1) return;
          for (const scan of snapshot.scans) this.scans.set(scan.id, scan);
          for (const report of snapshot.reports) this.reports.set(report.scanId, report);
          for (const [id, list] of snapshot.events) this.events.set(id, list);
          logger.info('snapshot.loaded', { scans: this.scans.size });
        } catch (error) {
          const err = error as NodeJS.ErrnoException;
          if (err.code !== 'ENOENT') logger.warn('snapshot.load_failed', { error: err.message });
        }
      })();
    }
    return this.loaded;
  }

  private scheduleFlush() {
    if (!this.file) return;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 400);
    // Never keep the process alive just to write a dev snapshot.
    this.flushTimer.unref?.();
  }

  private async flush() {
    const file = this.file;
    if (!file) return;
    try {
      await mkdir(path.dirname(file), { recursive: true });
      const snapshot: Snapshot = {
        version: 1,
        scans: [...this.scans.values()],
        reports: [...this.reports.values()],
        events: [...this.events.entries()],
      };
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(snapshot), 'utf8');
      await rename(tmp, file);
    } catch (error) {
      logger.warn('snapshot.write_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private evict() {
    if (this.scans.size <= MAX_SCANS) return;
    const ordered = [...this.scans.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const drop = ordered.slice(0, this.scans.size - MAX_SCANS);
    for (const scan of drop) {
      this.scans.delete(scan.id);
      this.reports.delete(scan.id);
      this.events.delete(scan.id);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Scans                                                             */
  /* ---------------------------------------------------------------- */

  async createScan(scan: Scan): Promise<Scan> {
    await this.ensureLoaded();
    this.scans.set(scan.id, scan);
    this.evict();
    this.scheduleFlush();
    return scan;
  }

  async getScan(id: string): Promise<Scan | null> {
    await this.ensureLoaded();
    return this.scans.get(id) ?? null;
  }

  async updateScan(id: string, patch: Partial<Scan>): Promise<Scan | null> {
    await this.ensureLoaded();
    const existing = this.scans.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    this.scans.set(id, next);
    this.scheduleFlush();
    return next;
  }

  async listScans(workspaceId: string, limit = 50): Promise<Scan[]> {
    await this.ensureLoaded();
    return [...this.scans.values()]
      .filter((s) => s.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async listScansForRepo(workspaceId: string, slug: string, limit = 25): Promise<Scan[]> {
    await this.ensureLoaded();
    return [...this.scans.values()]
      .filter((s) => s.workspaceId === workspaceId && s.repo.slug.toLowerCase() === slug.toLowerCase())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  /* ---------------------------------------------------------------- */
  /* Reports                                                           */
  /* ---------------------------------------------------------------- */

  async saveReport(report: Report): Promise<void> {
    await this.ensureLoaded();
    this.reports.set(report.scanId, report);
    this.scheduleFlush();
  }

  async getReport(scanId: string): Promise<Report | null> {
    await this.ensureLoaded();
    return this.reports.get(scanId) ?? null;
  }

  async getReportByShareId(shareId: string): Promise<{ report: Report; scan: Scan } | null> {
    await this.ensureLoaded();
    for (const scan of this.scans.values()) {
      if (scan.shareId && scan.shareId === shareId) {
        const report = this.reports.get(scan.id);
        if (report) return { report, scan };
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Events                                                            */
  /* ---------------------------------------------------------------- */

  async appendEvents(scanId: string, incoming: SequencedEvent[]): Promise<void> {
    await this.ensureLoaded();
    const list = this.events.get(scanId) ?? [];
    list.push(...incoming);
    if (list.length > MAX_EVENTS_PER_SCAN) list.splice(0, list.length - MAX_EVENTS_PER_SCAN);
    this.events.set(scanId, list);
    this.scheduleFlush();
  }

  async getEvents(scanId: string, sinceSeq = 0): Promise<SequencedEvent[]> {
    await this.ensureLoaded();
    const list = this.events.get(scanId) ?? [];
    return sinceSeq > 0 ? list.filter((e) => e.seq > sinceSeq) : [...list];
  }

  /* ---------------------------------------------------------------- */
  /* Repositories                                                      */
  /* ---------------------------------------------------------------- */

  async listRepositories(workspaceId: string): Promise<TrackedRepository[]> {
    await this.ensureLoaded();
    const scans = [...this.scans.values()]
      .filter((s) => s.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const bySlug = new Map<string, Scan[]>();
    for (const scan of scans) {
      const key = scan.repo.slug.toLowerCase();
      const bucket = bySlug.get(key);
      if (bucket) bucket.push(scan);
      else bySlug.set(key, [scan]);
    }

    const out: TrackedRepository[] = [];
    for (const [slug, list] of bySlug) {
      const completed = list.filter((s) => s.state === 'complete');
      const latest = completed.at(-1) ?? list.at(-1)!;
      const previous = completed.at(-2);
      const report = this.reports.get(latest.id);
      out.push({
        id: stableId('repo', workspaceId, slug),
        workspaceId,
        repo: latest.repo,
        latestScanId: latest.id,
        ...(latest.score !== undefined ? { latestScore: latest.score } : {}),
        ...(previous?.score !== undefined ? { previousScore: previous.score } : {}),
        criticalCount: report?.summary.counts.critical ?? 0,
        highCount: report?.summary.counts.high ?? 0,
        ...(latest.finishedAt ? { lastScannedAt: latest.finishedAt } : {}),
        scanCount: list.length,
      });
    }
    return out.sort((a, b) => (b.lastScannedAt ?? '').localeCompare(a.lastScannedAt ?? ''));
  }

  async getRepository(workspaceId: string, slug: string): Promise<TrackedRepository | null> {
    const all = await this.listRepositories(workspaceId);
    return all.find((r) => r.repo.slug.toLowerCase() === slug.toLowerCase()) ?? null;
  }

  async history(workspaceId: string, slug: string): Promise<ScanHistoryPoint[]> {
    const scans = (await this.listScansForRepo(workspaceId, slug, 40))
      .filter((s) => s.state === 'complete' && s.score !== undefined)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return scans.map((scan, index) => {
      const report = this.reports.get(scan.id);
      return {
        scanId: scan.id,
        index: index + 1,
        score: scan.score ?? 0,
        at: scan.finishedAt ?? scan.createdAt,
        criticalCount: report?.summary.counts.critical ?? 0,
        highCount: report?.summary.counts.high ?? 0,
      };
    });
  }
}
