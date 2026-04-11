BEGIN TRANSACTION;

ALTER TABLE transactions ADD COLUMN payment_provider TEXT NOT NULL DEFAULT 'local';
ALTER TABLE transactions ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'captured';
ALTER TABLE transactions ADD COLUMN provider_payment_intent_id TEXT;
ALTER TABLE transactions ADD COLUMN provider_charge_id TEXT;
ALTER TABLE transactions ADD COLUMN provider_last_refund_id TEXT;
ALTER TABLE transactions ADD COLUMN payment_reconciliation_json TEXT;

CREATE TABLE IF NOT EXISTS payment_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('authorize_capture', 'refund')),
  provider TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  external_reference TEXT,
  error_code TEXT,
  error_message TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  UNIQUE(transaction_id, operation, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payment_operations_transaction
  ON payment_operations (transaction_id, created_at, id);

COMMIT;
