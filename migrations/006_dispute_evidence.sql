CREATE TABLE IF NOT EXISTS dispute_evidence (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  uploader_user_id TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (uploader_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_transaction_id
  ON dispute_evidence(transaction_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_dispute_evidence_uploader
  ON dispute_evidence(uploader_user_id, created_at, id);
