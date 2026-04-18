BEGIN TRANSACTION;

CREATE INDEX IF NOT EXISTS idx_listings_moderation_price_desc
  ON listings (moderation_status, price_cents DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_listings_local_area_moderation_price_desc
  ON listings (local_area, moderation_status, price_cents DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_listings_seller_price_desc
  ON listings (seller_id, price_cents DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_listings_title_nocase
  ON listings (title COLLATE NOCASE);

COMMIT;
