ALTER TABLE notification_outbox ADD COLUMN next_retry_at TEXT;
ALTER TABLE notification_outbox ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_outbox ADD COLUMN last_attempt_at TEXT;
ALTER TABLE notification_outbox ADD COLUMN processing_started_at TEXT;
ALTER TABLE notification_outbox ADD COLUMN processed_at TEXT;
ALTER TABLE notification_outbox ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_notification_outbox_dispatchable
  ON notification_outbox (status, available_at, next_retry_at, id);

CREATE TABLE IF NOT EXISTS user_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_user_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  source_event_id INTEGER,
  source_outbox_id INTEGER NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'acknowledged')),
  created_at TEXT NOT NULL,
  read_at TEXT,
  acknowledged_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_outbox_id) REFERENCES notification_outbox(id),
  FOREIGN KEY (source_event_id) REFERENCES transaction_events(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_recipient_created
  ON user_notifications (recipient_user_id, created_at DESC, id DESC);
