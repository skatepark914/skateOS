-- ============================================================
-- 023_skater_photos.sql — photo URL on customer record
--
-- Front desk can attach a photo URL to a skater's record. Used for:
--   - Identity verification at check-in (correct kid using the punch card?)
--   - Member-card printer (face + name + QR on a 3.5×2 card)
--   - Customer detail modal in admin
--
-- v1 stores a URL (paste from Dropbox/iCloud/etc) — no Supabase Storage
-- bucket setup needed. v2 adds direct upload via Storage.
--
-- Idempotent. Safe to re-run.
-- ============================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS photo_url TEXT;
