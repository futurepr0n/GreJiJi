BEGIN TRANSACTION;

CREATE TABLE transactions_v3 (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  fee_fixed_cents INTEGER NOT NULL CHECK (fee_fixed_cents >= 0),
  fee_rate_bps INTEGER NOT NULL CHECK (fee_rate_bps >= 0),
  service_fee_cents INTEGER NOT NULL CHECK (service_fee_cents >= 0),
  total_buyer_charge_cents INTEGER NOT NULL CHECK (total_buyer_charge_cents = seller_net_cents + service_fee_cents),
  seller_net_cents INTEGER NOT NULL CHECK (seller_net_cents = amount_cents AND seller_net_cents >= 0),
  currency_code TEXT NOT NULL CHECK (length(currency_code) = 3 AND currency_code = UPPER(currency_code)),
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
  settlement_outcome TEXT CHECK (
    settlement_outcome IN ('completed', 'refunded', 'cancelled')
    OR settlement_outcome IS NULL
  ),
  settled_buyer_charge_cents INTEGER CHECK (settled_buyer_charge_cents IS NULL OR settled_buyer_charge_cents >= 0),
  settled_seller_payout_cents INTEGER CHECK (settled_seller_payout_cents IS NULL OR settled_seller_payout_cents >= 0),
  settled_platform_fee_cents INTEGER CHECK (settled_platform_fee_cents IS NULL OR settled_platform_fee_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (settlement_outcome IS NULL AND settled_buyer_charge_cents IS NULL AND settled_seller_payout_cents IS NULL AND settled_platform_fee_cents IS NULL)
    OR (
      settlement_outcome IS NOT NULL
      AND settled_buyer_charge_cents IS NOT NULL
      AND settled_seller_payout_cents IS NOT NULL
      AND settled_platform_fee_cents IS NOT NULL
      AND settled_buyer_charge_cents = settled_seller_payout_cents + settled_platform_fee_cents
    )
  )
);

INSERT INTO transactions_v3 (
  id,
  buyer_id,
  seller_id,
  amount_cents,
  fee_fixed_cents,
  fee_rate_bps,
  service_fee_cents,
  total_buyer_charge_cents,
  seller_net_cents,
  currency_code,
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
  settlement_outcome,
  settled_buyer_charge_cents,
  settled_seller_payout_cents,
  settled_platform_fee_cents,
  created_at,
  updated_at
)
SELECT
  id,
  buyer_id,
  seller_id,
  amount_cents,
  0 AS fee_fixed_cents,
  0 AS fee_rate_bps,
  0 AS service_fee_cents,
  amount_cents AS total_buyer_charge_cents,
  amount_cents AS seller_net_cents,
  'USD' AS currency_code,
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
  CASE
    WHEN cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN refund_issued_at IS NOT NULL THEN 'refunded'
    WHEN payout_released_at IS NOT NULL THEN 'completed'
    ELSE NULL
  END AS settlement_outcome,
  CASE
    WHEN cancelled_at IS NOT NULL THEN 0
    WHEN refund_issued_at IS NOT NULL THEN 0
    WHEN payout_released_at IS NOT NULL THEN amount_cents
    ELSE NULL
  END AS settled_buyer_charge_cents,
  CASE
    WHEN cancelled_at IS NOT NULL THEN 0
    WHEN refund_issued_at IS NOT NULL THEN 0
    WHEN payout_released_at IS NOT NULL THEN amount_cents
    ELSE NULL
  END AS settled_seller_payout_cents,
  CASE
    WHEN cancelled_at IS NOT NULL THEN 0
    WHEN refund_issued_at IS NOT NULL THEN 0
    WHEN payout_released_at IS NOT NULL THEN 0
    ELSE NULL
  END AS settled_platform_fee_cents,
  created_at,
  updated_at
FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_v3 RENAME TO transactions;

CREATE INDEX idx_transactions_status_due_at
  ON transactions (status, auto_release_due_at);

CREATE INDEX idx_transactions_dispute_state
  ON transactions (status, dispute_opened_at, dispute_resolved_at);

CREATE INDEX idx_transactions_adjudication
  ON transactions (adjudication_decision, adjudication_decided_at);

CREATE INDEX idx_transactions_settlement_outcome
  ON transactions (settlement_outcome, updated_at);

COMMIT;
