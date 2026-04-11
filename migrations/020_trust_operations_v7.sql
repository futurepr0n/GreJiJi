BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS dispute_evidence_integrity (
  evidence_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  metadata_consistency_score INTEGER NOT NULL CHECK (metadata_consistency_score >= 0 AND metadata_consistency_score <= 100),
  duplicate_within_transaction INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_within_transaction IN (0, 1)),
  replay_seen_globally INTEGER NOT NULL DEFAULT 0 CHECK (replay_seen_globally IN (0, 1)),
  anomaly_score INTEGER NOT NULL CHECK (anomaly_score >= 0 AND anomaly_score <= 100),
  integrity_flags_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (evidence_id) REFERENCES dispute_evidence(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_integrity_transaction
  ON dispute_evidence_integrity (transaction_id, updated_at DESC, evidence_id);

CREATE TABLE IF NOT EXISTS fulfillment_proofs (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  proof_type TEXT NOT NULL,
  artifact_checksum_sha256 TEXT,
  metadata_json TEXT NOT NULL,
  recorded_at TEXT,
  integrity_score INTEGER NOT NULL CHECK (integrity_score >= 0 AND integrity_score <= 100),
  anomaly_score INTEGER NOT NULL CHECK (anomaly_score >= 0 AND anomaly_score <= 100),
  replay_detected INTEGER NOT NULL DEFAULT 0 CHECK (replay_detected IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_proofs_transaction
  ON fulfillment_proofs (transaction_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_fulfillment_proofs_checksum
  ON fulfillment_proofs (artifact_checksum_sha256, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS trust_policy_guardrail_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_version_id INTEGER,
  event_type TEXT NOT NULL CHECK (event_type IN ('evaluation_passed', 'kill_switch_triggered', 'rollback_applied')),
  reason_code TEXT NOT NULL,
  metrics_snapshot_json TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_version_id) REFERENCES trust_ops_policy_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_policy_guardrail_events_policy_created
  ON trust_policy_guardrail_events (policy_version_id, created_at DESC, id DESC);

COMMIT;
