BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS trust_network_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id TEXT NOT NULL,
  source_entity_key TEXT NOT NULL,
  target_entity_key TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('account', 'device', 'payment_instrument', 'interaction_pattern')),
  confidence_score INTEGER NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  propagated_risk_score INTEGER NOT NULL CHECK (propagated_risk_score >= 0 AND propagated_risk_score <= 100),
  decay_expires_at TEXT,
  evidence_json TEXT NOT NULL,
  policy_version_id INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (policy_version_id) REFERENCES trust_ops_policy_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_network_links_cluster_updated
  ON trust_network_links (cluster_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_trust_network_links_source_updated
  ON trust_network_links (source_entity_key, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_trust_network_links_target_updated
  ON trust_network_links (target_entity_key, updated_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trust_network_links_unique_pair
  ON trust_network_links (source_entity_key, target_entity_key, link_type);

ALTER TABLE trust_operations_cases
  ADD COLUMN network_risk_score_at_trigger INTEGER NOT NULL DEFAULT 0
  CHECK (network_risk_score_at_trigger >= 0 AND network_risk_score_at_trigger <= 100);

ALTER TABLE trust_operations_cases
  ADD COLUMN intervention_ladder_step TEXT NOT NULL DEFAULT 'none'
  CHECK (intervention_ladder_step IN ('none', 'listing_throttle', 'transaction_cooloff', 'reserve_increase', 'verification_rechallenge', 'manual_review_gate'));

ALTER TABLE trust_operations_cases
  ADD COLUMN cluster_id TEXT;

ALTER TABLE trust_operations_cases
  ADD COLUMN recovery_status TEXT NOT NULL DEFAULT 'not_applicable'
  CHECK (recovery_status IN ('not_applicable', 'queued', 'processing', 'completed', 'failed'));

CREATE INDEX IF NOT EXISTS idx_trust_ops_cases_cluster_status
  ON trust_operations_cases (cluster_id, status, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS trust_cluster_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  cluster_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('preview', 'approve', 'override', 'clear')),
  reason_code TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES trust_operations_cases(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_cluster_actions_case_created
  ON trust_cluster_actions (case_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_trust_cluster_actions_cluster_created
  ON trust_cluster_actions (cluster_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS trust_recovery_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  transaction_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  reason_code TEXT NOT NULL,
  template_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  sla_due_at TEXT NOT NULL,
  processed_at TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES trust_operations_cases(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_recovery_jobs_status_schedule
  ON trust_recovery_jobs (status, scheduled_for ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_trust_recovery_jobs_case_created
  ON trust_recovery_jobs (case_id, created_at DESC, id DESC);

COMMIT;
