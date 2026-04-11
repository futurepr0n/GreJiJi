BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS seller_integrity_profiles (
  user_id TEXT PRIMARY KEY,
  integrity_score INTEGER NOT NULL CHECK (integrity_score >= 0 AND integrity_score <= 100),
  reason_factors_json TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_seller_integrity_profiles_score_updated
  ON seller_integrity_profiles (integrity_score ASC, updated_at DESC);

CREATE TABLE IF NOT EXISTS payout_risk_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL,
  case_id INTEGER,
  seller_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('none', 'hold', 'reserve', 'manual_review', 'release')),
  reserve_percent INTEGER,
  hold_hours INTEGER,
  review_required INTEGER NOT NULL DEFAULT 0 CHECK (review_required IN (0, 1)),
  reason_code TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('policy', 'override', 'system')),
  policy_version_id INTEGER,
  policy_snapshot_json TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  override_expires_at TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (case_id) REFERENCES trust_operations_cases(id),
  FOREIGN KEY (seller_id) REFERENCES users(id),
  FOREIGN KEY (policy_version_id) REFERENCES trust_ops_policy_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_payout_risk_actions_tx_created
  ON payout_risk_actions (transaction_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_payout_risk_actions_case_created
  ON payout_risk_actions (case_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_payout_risk_actions_source_created
  ON payout_risk_actions (source, created_at DESC, id DESC);

ALTER TABLE trust_operations_cases
  ADD COLUMN seller_integrity_score_at_trigger INTEGER NOT NULL DEFAULT 0
  CHECK (seller_integrity_score_at_trigger >= 0 AND seller_integrity_score_at_trigger <= 100);

ALTER TABLE trust_operations_cases
  ADD COLUMN payout_action TEXT NOT NULL DEFAULT 'none'
  CHECK (payout_action IN ('none', 'hold', 'reserve', 'manual_review', 'release'));

ALTER TABLE trust_operations_cases
  ADD COLUMN payout_decision_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE trust_operations_cases
  ADD COLUMN policy_version_id INTEGER REFERENCES trust_ops_policy_versions(id);

ALTER TABLE trust_operations_cases
  ADD COLUMN override_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_trust_ops_cases_payout_action_status
  ON trust_operations_cases (payout_action, status, updated_at DESC, id DESC);

COMMIT;
