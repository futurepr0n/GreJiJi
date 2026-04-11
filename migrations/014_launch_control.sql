BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS launch_control_flags (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  rollout_percentage INTEGER NOT NULL DEFAULT 100 CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
  allowlist_user_ids_json TEXT NOT NULL DEFAULT '[]',
  region_allowlist_json TEXT NOT NULL DEFAULT '[]',
  environment TEXT,
  reason TEXT,
  deployment_run_id TEXT,
  metadata_json TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS launch_control_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flag_key TEXT NOT NULL,
  previous_enabled INTEGER,
  next_enabled INTEGER NOT NULL CHECK (next_enabled IN (0, 1)),
  previous_rollout_percentage INTEGER,
  next_rollout_percentage INTEGER NOT NULL,
  previous_allowlist_user_ids_json TEXT,
  next_allowlist_user_ids_json TEXT NOT NULL,
  previous_region_allowlist_json TEXT,
  next_region_allowlist_json TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT,
  source TEXT NOT NULL,
  deployment_run_id TEXT,
  metadata_json TEXT,
  correlation_id TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (flag_key) REFERENCES launch_control_flags(key)
);

CREATE INDEX IF NOT EXISTS idx_launch_control_audit_flag_created
  ON launch_control_audit_events (flag_key, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS launch_control_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_key TEXT UNIQUE,
  signal_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  details_json TEXT NOT NULL,
  auto_rollback_applied INTEGER NOT NULL CHECK (auto_rollback_applied IN (0, 1)),
  correlation_id TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_launch_control_incidents_created
  ON launch_control_incidents (created_at DESC, id DESC);

COMMIT;
