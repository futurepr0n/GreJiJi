BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS provider_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  transaction_id TEXT,
  occurred_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('received', 'processed', 'failed')),
  delivery_count INTEGER NOT NULL DEFAULT 1,
  processing_attempts INTEGER NOT NULL DEFAULT 0,
  signature_valid INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  processing_error TEXT,
  first_received_at TEXT NOT NULL,
  last_received_at TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_webhook_events_status
  ON provider_webhook_events (status, updated_at, id);

CREATE INDEX IF NOT EXISTS idx_provider_webhook_events_transaction
  ON provider_webhook_events (transaction_id, updated_at, id);

COMMIT;
