CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'disputed', 'completed')),
  accepted_at TEXT NOT NULL,
  auto_release_due_at TEXT NOT NULL,
  buyer_confirmed_at TEXT,
  auto_released_at TEXT,
  payout_released_at TEXT,
  payout_release_reason TEXT CHECK (payout_release_reason IN ('buyer_confirmation', 'auto_release') OR payout_release_reason IS NULL),
  dispute_opened_at TEXT,
  dispute_resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_status_due_at
  ON transactions (status, auto_release_due_at);

CREATE INDEX IF NOT EXISTS idx_transactions_dispute_state
  ON transactions (status, dispute_opened_at, dispute_resolved_at);
