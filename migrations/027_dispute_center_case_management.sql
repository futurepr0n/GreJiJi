ALTER TABLE dispute_evidence ADD COLUMN note TEXT;
ALTER TABLE dispute_evidence ADD COLUMN attachment_refs_json TEXT;

CREATE TABLE IF NOT EXISTS dispute_cases (
  transaction_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('open', 'under_review', 'resolved', 'rejected')),
  assigned_operator_id TEXT,
  resolution_note TEXT,
  opened_by_actor_id TEXT,
  opened_at TEXT NOT NULL,
  resolved_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (assigned_operator_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_dispute_cases_status_updated
  ON dispute_cases(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS dispute_case_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  attachment_refs_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_dispute_case_timeline_transaction
  ON dispute_case_timeline(transaction_id, created_at ASC, id ASC);
