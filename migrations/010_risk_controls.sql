BEGIN TRANSACTION;

ALTER TABLE users ADD COLUMN risk_flagged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN risk_flag_reason TEXT;
ALTER TABLE users ADD COLUMN risk_flag_updated_at TEXT;
ALTER TABLE users ADD COLUMN verification_required INTEGER NOT NULL DEFAULT 0;

ALTER TABLE transactions ADD COLUMN risk_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'low';
ALTER TABLE transactions ADD COLUMN risk_flags_json TEXT;
ALTER TABLE transactions ADD COLUMN hold_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE transactions ADD COLUMN hold_reason TEXT;
ALTER TABLE transactions ADD COLUMN hold_applied_at TEXT;
ALTER TABLE transactions ADD COLUMN hold_released_at TEXT;
ALTER TABLE transactions ADD COLUMN hold_applied_by TEXT;
ALTER TABLE transactions ADD COLUMN hold_released_by TEXT;

CREATE TABLE IF NOT EXISTS risk_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT,
  user_id TEXT,
  signal_type TEXT NOT NULL CHECK (signal_type IN (
    'auth_failures',
    'velocity_anomaly',
    'payment_mismatch',
    'dispute_abuse',
    'webhook_abuse',
    'manual_review'
  )),
  severity INTEGER NOT NULL CHECK (severity >= 1 AND severity <= 100),
  details_json TEXT NOT NULL,
  created_by TEXT,
  correlation_id TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_risk_signals_transaction_created
  ON risk_signals (transaction_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_risk_signals_user_created
  ON risk_signals (user_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_risk_signals_type_created
  ON risk_signals (signal_type, created_at, id);

CREATE TABLE IF NOT EXISTS risk_operator_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('transaction', 'account')),
  subject_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'hold',
    'unhold',
    'flag_account',
    'unflag_account',
    'require_verification',
    'clear_verification'
  )),
  reason TEXT,
  notes TEXT,
  actor_id TEXT NOT NULL,
  correlation_id TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_risk_operator_actions_subject
  ON risk_operator_actions (subject_type, subject_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_transactions_buyer_accepted_at
  ON transactions (buyer_id, accepted_at);

CREATE INDEX IF NOT EXISTS idx_transactions_seller_accepted_at
  ON transactions (seller_id, accepted_at);

CREATE INDEX IF NOT EXISTS idx_transaction_events_actor_type_created
  ON transaction_events (actor_id, event_type, created_at);

COMMIT;
