BEGIN TRANSACTION;

CREATE TABLE transactions_v2 (
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
  payout_release_reason TEXT CHECK (
    payout_release_reason IN ('buyer_confirmation', 'auto_release', 'dispute_adjudication_release_to_seller')
    OR payout_release_reason IS NULL
  ),
  dispute_opened_at TEXT,
  dispute_resolved_at TEXT,
  adjudication_decision TEXT CHECK (
    adjudication_decision IN ('release_to_seller', 'refund_to_buyer', 'cancel_transaction')
    OR adjudication_decision IS NULL
  ),
  adjudication_decided_at TEXT,
  adjudication_decided_by TEXT,
  adjudication_notes TEXT,
  refund_issued_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO transactions_v2 (
  id,
  buyer_id,
  seller_id,
  amount_cents,
  status,
  accepted_at,
  auto_release_due_at,
  buyer_confirmed_at,
  auto_released_at,
  payout_released_at,
  payout_release_reason,
  dispute_opened_at,
  dispute_resolved_at,
  adjudication_decision,
  adjudication_decided_at,
  adjudication_decided_by,
  adjudication_notes,
  refund_issued_at,
  cancelled_at,
  created_at,
  updated_at
)
SELECT
  id,
  buyer_id,
  seller_id,
  amount_cents,
  status,
  accepted_at,
  auto_release_due_at,
  buyer_confirmed_at,
  auto_released_at,
  payout_released_at,
  payout_release_reason,
  dispute_opened_at,
  dispute_resolved_at,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  created_at,
  updated_at
FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_v2 RENAME TO transactions;

CREATE INDEX idx_transactions_status_due_at
  ON transactions (status, auto_release_due_at);

CREATE INDEX idx_transactions_dispute_state
  ON transactions (status, dispute_opened_at, dispute_resolved_at);

CREATE INDEX idx_transactions_adjudication
  ON transactions (adjudication_decision, adjudication_decided_at);

COMMIT;
