ALTER TABLE transactions ADD COLUMN seller_completion_acknowledged_at TEXT;

CREATE TABLE IF NOT EXISTS transaction_ratings (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  rater_user_id TEXT NOT NULL,
  ratee_user_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
  comment TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(transaction_id, rater_user_id),
  FOREIGN KEY(transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_ratings_transaction
  ON transaction_ratings (transaction_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_transaction_ratings_ratee
  ON transaction_ratings (ratee_user_id, created_at, id);
