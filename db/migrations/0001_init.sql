-- Sentinel initial schema.
--
-- Applied automatically at boot by `PostgresStore.migrate()` and kept in sync
-- with `prisma/schema.prisma`. Safe to re-run.

CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repositories (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  slug          TEXT NOT NULL,
  owner         TEXT NOT NULL,
  name          TEXT NOT NULL,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS scans (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  repo_slug       TEXT NOT NULL,
  repo            JSONB NOT NULL,
  state           TEXT NOT NULL,
  mode            TEXT NOT NULL,
  progress        DOUBLE PRECISION NOT NULL DEFAULT 0,
  status_message  TEXT NOT NULL DEFAULT '',
  score           INTEGER,
  share_id        TEXT UNIQUE,
  error           JSONB,
  agents          JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  duration_ms     INTEGER
);

CREATE INDEX IF NOT EXISTS scans_workspace_created_idx ON scans (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scans_repo_idx ON scans (workspace_id, repo_slug, created_at DESC);

-- The event log powering SSE replay. Bounded by a retention job, not by the app.
CREATE TABLE IF NOT EXISTS scan_events (
  scan_id  TEXT NOT NULL,
  seq      INTEGER NOT NULL,
  payload  JSONB NOT NULL,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scan_id, seq)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  scan_id        TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  state          TEXT NOT NULL,
  activity       TEXT NOT NULL DEFAULT '',
  files_scanned  INTEGER NOT NULL DEFAULT 0,
  finding_count  INTEGER NOT NULL DEFAULT 0,
  progress       DOUBLE PRECISION NOT NULL DEFAULT 0,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  error          TEXT,
  PRIMARY KEY (scan_id, agent_id)
);

CREATE TABLE IF NOT EXISTS reports (
  scan_id       TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  repo_slug     TEXT NOT NULL,
  mode          TEXT NOT NULL,
  payload       JSONB NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
  id          TEXT NOT NULL,
  scan_id     TEXT NOT NULL,
  rule_id     TEXT NOT NULL,
  category    TEXT NOT NULL,
  severity    TEXT NOT NULL,
  confidence  DOUBLE PRECISION NOT NULL,
  validation  TEXT NOT NULL,
  title       TEXT NOT NULL,
  path        TEXT NOT NULL,
  start_line  INTEGER,
  root_cause  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  PRIMARY KEY (scan_id, id)
);

CREATE INDEX IF NOT EXISTS findings_severity_idx ON findings (scan_id, severity);
CREATE INDEX IF NOT EXISTS findings_rule_idx ON findings (rule_id);

CREATE TABLE IF NOT EXISTS debates (
  id          TEXT NOT NULL,
  scan_id     TEXT NOT NULL,
  finding_id  TEXT NOT NULL,
  topic       TEXT NOT NULL,
  payload     JSONB NOT NULL,
  PRIMARY KEY (scan_id, id)
);

CREATE TABLE IF NOT EXISTS project_scores (
  scan_id   TEXT NOT NULL,
  category  TEXT NOT NULL,
  score     INTEGER NOT NULL,
  weight    DOUBLE PRECISION NOT NULL,
  findings  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scan_id, category)
);

CREATE TABLE IF NOT EXISTS dependencies (
  scan_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  ecosystem  TEXT NOT NULL,
  version    TEXT NOT NULL,
  risk       TEXT,
  payload    JSONB NOT NULL,
  PRIMARY KEY (scan_id, ecosystem, name)
);

CREATE TABLE IF NOT EXISTS architecture_nodes (
  scan_id  TEXT NOT NULL,
  node_id  TEXT NOT NULL,
  label    TEXT NOT NULL,
  kind     TEXT NOT NULL,
  risk     TEXT,
  payload  JSONB NOT NULL,
  PRIMARY KEY (scan_id, node_id)
);

CREATE TABLE IF NOT EXISTS recommendations (
  scan_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  ecosystem  TEXT NOT NULL,
  reason     TEXT NOT NULL,
  payload    JSONB NOT NULL,
  PRIMARY KEY (scan_id, ecosystem, name)
);
