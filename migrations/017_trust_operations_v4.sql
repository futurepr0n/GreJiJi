BEGIN TRANSACTION;

ALTER TABLE trust_operations_cases ADD COLUMN severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical'));
ALTER TABLE trust_operations_cases ADD COLUMN priority_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trust_operations_cases ADD COLUMN sla_due_at TEXT;
ALTER TABLE trust_operations_cases ADD COLUMN assigned_investigator_id TEXT;
ALTER TABLE trust_operations_cases ADD COLUMN claimed_at TEXT;
ALTER TABLE trust_operations_cases ADD COLUMN first_action_at TEXT;
ALTER TABLE trust_operations_cases ADD COLUMN last_action_at TEXT;
ALTER TABLE trust_operations_cases ADD COLUMN false_positive_flag INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_trust_ops_cases_priority_sla
  ON trust_operations_cases (status, priority_score DESC, sla_due_at ASC, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS trust_ops_policy_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  activation_window_start_at TEXT,
  activation_window_end_at TEXT,
  policy_json TEXT NOT NULL,
  cohort_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  activated_by TEXT,
  activated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trust_ops_policy_versions_status_updated
  ON trust_ops_policy_versions (status, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS trust_ops_policy_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT,
  case_id INTEGER,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('operator_action', 'dispute_outcome', 'chargeback_outcome')),
  outcome TEXT NOT NULL,
  source TEXT NOT NULL,
  actor_id TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (case_id) REFERENCES trust_operations_cases(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_ops_policy_feedback_created
  ON trust_ops_policy_feedback (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_trust_ops_policy_feedback_case
  ON trust_ops_policy_feedback (case_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS trust_operations_case_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  transaction_id TEXT NOT NULL,
  note TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES trust_operations_cases(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_ops_case_notes_case_created
  ON trust_operations_case_notes (case_id, created_at DESC, id DESC);

COMMIT;
