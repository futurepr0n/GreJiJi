BEGIN TRANSACTION;

ALTER TABLE listings ADD COLUMN category TEXT;
ALTER TABLE listings ADD COLUMN item_condition TEXT;
ALTER TABLE listings ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE listings ADD COLUMN moderation_reason_code TEXT;
ALTER TABLE listings ADD COLUMN moderation_public_reason TEXT;
ALTER TABLE listings ADD COLUMN moderation_internal_notes TEXT;
ALTER TABLE listings ADD COLUMN moderation_updated_at TEXT;
ALTER TABLE listings ADD COLUMN moderation_updated_by TEXT;

CREATE INDEX IF NOT EXISTS idx_listings_moderation_status_created
  ON listings (moderation_status, created_at, id);

CREATE TABLE IF NOT EXISTS listing_moderation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason_code TEXT,
  public_reason TEXT,
  internal_notes TEXT,
  source TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_id TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES listings(id)
);

CREATE INDEX IF NOT EXISTS idx_listing_moderation_events_listing_created
  ON listing_moderation_events (listing_id, created_at, id);

CREATE TABLE IF NOT EXISTS listing_abuse_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL,
  reporter_user_id TEXT,
  reason_code TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'dismissed')),
  priority_score INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES listings(id),
  FOREIGN KEY (reporter_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_listing_abuse_reports_listing_status_created
  ON listing_abuse_reports (listing_id, status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_listing_abuse_reports_status_priority_created
  ON listing_abuse_reports (status, priority_score DESC, created_at, id);

COMMIT;
