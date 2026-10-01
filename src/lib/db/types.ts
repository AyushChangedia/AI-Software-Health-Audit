import type {
  Report,
  Scan,
  ScanHistoryPoint,
  SequencedEvent,
  TrackedRepository,
} from '@/types';

/**
 * Persistence port.
 *
 * Two adapters ship with Sentinel:
 *   - `MemoryStore`   — in-process, optionally mirrored to `.sentinel/store.json`.
 *                       The default; works with zero configuration.
 *   - `PostgresStore` — durable, multi-instance. Enabled by `DATABASE_URL`.
 *
 * The interface is intentionally narrow: everything the product needs, nothing
 * that assumes a particular engine.
 */
export interface Store {
  readonly kind: 'memory' | 'postgres';

  /* Scans ---------------------------------------------------------- */
  createScan(scan: Scan): Promise<Scan>;
  getScan(id: string): Promise<Scan | null>;
  updateScan(id: string, patch: Partial<Scan>): Promise<Scan | null>;
  listScans(workspaceId: string, limit?: number): Promise<Scan[]>;
  listScansForRepo(workspaceId: string, slug: string, limit?: number): Promise<Scan[]>;

  /* Reports -------------------------------------------------------- */
  saveReport(report: Report): Promise<void>;
  getReport(scanId: string): Promise<Report | null>;
  getReportByShareId(shareId: string): Promise<{ report: Report; scan: Scan } | null>;

  /* Event log (drives SSE replay) ---------------------------------- */
  appendEvents(scanId: string, events: SequencedEvent[]): Promise<void>;
  getEvents(scanId: string, sinceSeq?: number): Promise<SequencedEvent[]>;

  /* Repositories --------------------------------------------------- */
  listRepositories(workspaceId: string): Promise<TrackedRepository[]>;
  getRepository(workspaceId: string, slug: string): Promise<TrackedRepository | null>;
  history(workspaceId: string, slug: string): Promise<ScanHistoryPoint[]>;

  /** Called on boot by the Postgres adapter; a no-op in memory. */
  migrate?(): Promise<void>;
}
