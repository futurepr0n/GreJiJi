BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS trust_step_up_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  transaction_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'passed', 'failed', 'expired')),
  reason_code TEXT NOT NULL,
  challenge_type TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES trust_operations_cases(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_step_up_challenges_case_created
  ON trust_step_up_challenges (case_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_trust_step_up_challenges_status_expiry
  ON trust_step_up_challenges (status, expires_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS account_recovery_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'cancelled')),
  stage TEXT NOT NULL CHECK (stage IN ('lockdown', 'identity_reverification', 'limited_restore', 'full_restore')),
  compromise_signal_json TEXT NOT NULL,
  required_approval_actor_id TEXT,
  approved_by_actor_id TEXT,
  approved_at TEXT,
  decision_notes TEXT,
  restored_capabilities_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_account_recovery_cases_user_status
  ON account_recovery_cases (user_id, status, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_account_recovery_cases_stage_status
  ON account_recovery_cases (stage, status, updated_at DESC, id DESC);

COMMIT;
