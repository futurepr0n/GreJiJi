BEGIN TRANSACTION;

ALTER TABLE listings ADD COLUMN listing_photo_urls_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE listings ADD COLUMN listing_uploaded_photos_json TEXT NOT NULL DEFAULT '[]';

COMMIT;
