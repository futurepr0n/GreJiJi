CREATE TABLE IF NOT EXISTS transaction_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'payment_captured',
      'buyer_confirmed',
      'dispute_opened',
      'dispute_resolved',
      'dispute_adjudicated',
      'settlement_completed',
      'settlement_refunded',
      'settlement_cancelled'
    )
  ),
  actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_events_transaction_timeline
  ON transaction_events (transaction_id, occurred_at, id);

CREATE INDEX IF NOT EXISTS idx_transaction_events_type
  ON transaction_events (event_type, occurred_at);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL,
  source_event_id INTEGER,
  topic TEXT NOT NULL CHECK (topic IN ('payment_received', 'action_required', 'dispute_update')),
  recipient_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  sent_at TEXT,
  failed_at TEXT,
  failure_reason TEXT,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  FOREIGN KEY (source_event_id) REFERENCES transaction_events(id)
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending
  ON notification_outbox (status, available_at, id);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_transaction
  ON notification_outbox (transaction_id, id);
