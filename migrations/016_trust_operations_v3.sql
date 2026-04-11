BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS trust_operations_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved')),
  recommended_action TEXT NOT NULL CHECK (recommended_action IN ('hold', 'clear', 'none')),
  reason_code TEXT,
  policy_snapshot_json TEXT NOT NULL,
  triggered_by_signal_id INTEGER,
  risk_score_at_trigger INTEGER NOT NULL DEFAULT 0,
  hold_expires_at TEXT,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (triggered_by_signal_id) REFERENCES risk_signals(id)
);

CREATE TABLE IF NOT EXISTS trust_operations_case_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  transaction_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'case_created',
    'case_retriggered',
    'auto_hold_applied',
    'auto_hold_cleared',
    'operator_approved',
    'operator_overridden',
    'operator_cleared',
    'policy_simulated'
  )),
  actor_id TEXT NOT NULL,
  reason_code TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES trust_operations_cases(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_ops_cases_status_updated
  ON trust_operations_cases (status, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_trust_ops_cases_transaction
  ON trust_operations_cases (transaction_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trust_ops_cases_active_transaction
  ON trust_operations_cases (transaction_id)
  WHERE status IN ('open', 'in_review');

CREATE INDEX IF NOT EXISTS idx_trust_ops_case_events_case_created
  ON trust_operations_case_events (case_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_trust_ops_case_events_tx_created
  ON trust_operations_case_events (transaction_id, created_at DESC, id DESC);

COMMIT;
