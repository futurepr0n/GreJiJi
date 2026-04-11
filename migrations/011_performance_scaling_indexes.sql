BEGIN TRANSACTION;

CREATE INDEX IF NOT EXISTS idx_listings_created_desc
  ON listings (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_listings_seller_created_desc
  ON listings (seller_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_listings_local_area_created_desc
  ON listings (local_area, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_provider_webhook_events_provider_status_updated
  ON provider_webhook_events (provider, status, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_risk_signals_transaction_signal_created
  ON risk_signals (transaction_id, signal_type, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_risk_signals_user_signal_created
  ON risk_signals (user_id, signal_type, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_retry_available
  ON notification_outbox (status, next_retry_at, available_at, id);

COMMIT;
