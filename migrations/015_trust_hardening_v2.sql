BEGIN TRANSACTION;

ALTER TABLE users ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected'));
ALTER TABLE users ADD COLUMN verification_submitted_at TEXT;
ALTER TABLE users ADD COLUMN verification_decided_at TEXT;
ALTER TABLE users ADD COLUMN verification_decided_by TEXT;
ALTER TABLE users ADD COLUMN verification_evidence_json TEXT;
ALTER TABLE users ADD COLUMN verification_review_notes TEXT;

ALTER TABLE users ADD COLUMN risk_tier TEXT NOT NULL DEFAULT 'low' CHECK (risk_tier IN ('low', 'medium', 'high'));
ALTER TABLE users ADD COLUMN risk_tier_source TEXT NOT NULL DEFAULT 'system' CHECK (risk_tier_source IN ('system', 'override'));
ALTER TABLE users ADD COLUMN risk_tier_override_reason TEXT;
ALTER TABLE users ADD COLUMN risk_tier_updated_at TEXT;
ALTER TABLE users ADD COLUMN risk_tier_updated_by TEXT;

CREATE TABLE IF NOT EXISTS identity_verification_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  from_status TEXT CHECK (from_status IN ('unverified', 'pending', 'verified', 'rejected')),
  to_status TEXT NOT NULL CHECK (to_status IN ('unverified', 'pending', 'verified', 'rejected')),
  actor_id TEXT NOT NULL,
  reason TEXT,
  review_notes TEXT,
  evidence_json TEXT,
  request_id TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_identity_verification_events_user_created
  ON identity_verification_events (user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS risk_tier_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  previous_tier TEXT CHECK (previous_tier IN ('low', 'medium', 'high')),
  next_tier TEXT NOT NULL CHECK (next_tier IN ('low', 'medium', 'high')),
  source TEXT NOT NULL CHECK (source IN ('system', 'override')),
  actor_id TEXT,
  reason TEXT,
  details_json TEXT,
  request_id TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_risk_tier_events_user_created
  ON risk_tier_events (user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS risk_limit_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkpoint TEXT NOT NULL CHECK (checkpoint IN ('transaction_initiation', 'payout_release')),
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
  reason_code TEXT,
  transaction_id TEXT,
  user_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  daily_volume_cents INTEGER NOT NULL,
  max_transaction_cents INTEGER NOT NULL,
  daily_volume_cap_cents INTEGER NOT NULL,
  cooldown_hours INTEGER NOT NULL,
  cooldown_until TEXT,
  risk_tier TEXT NOT NULL CHECK (risk_tier IN ('low', 'medium', 'high')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  policy_snapshot_json TEXT NOT NULL,
  request_id TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_risk_limit_decisions_checkpoint_created
  ON risk_limit_decisions (checkpoint, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_risk_limit_decisions_user_checkpoint_created
  ON risk_limit_decisions (user_id, checkpoint, created_at DESC, id DESC);

COMMIT;
