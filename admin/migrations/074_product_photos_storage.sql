-- 074_product_photos_storage.sql — own our product photos
--
-- Why:
--   The 1,294 product photos imported from Square all point to Square's
--   S3 CDN (items-images-production.s3.us-west-2.amazonaws.com). If we
--   ever fully leave Square, those URLs break. Mirror them into our own
--   Supabase Storage bucket so we control the bytes + URL forever.
--   Plus thumbnails for fast POS card loads (full 1-3MB photos kill grid).
--
-- This migration just creates the bucket + adds the thumbnail column.
-- A separate Python script (admin/scripts/mirror_photos.py) does the
-- actual download → upload → URL swap.

-- ── Storage bucket: public-read, owner-write ──────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-photos', 'product-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Anon role can SELECT (read public photos)
DO $$
BEGIN
  CREATE POLICY "product_photos_public_read"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'product-photos');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Service role can INSERT/UPDATE/DELETE (script uses service key)
DO $$
BEGIN
  CREATE POLICY "product_photos_service_write"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'product-photos' AND auth.role() = 'service_role');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "product_photos_service_update"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'product-photos' AND auth.role() = 'service_role');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "product_photos_service_delete"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'product-photos' AND auth.role() = 'service_role');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Schema: separate thumbnail URL ────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_thumb_url TEXT;
COMMENT ON COLUMN products.image_thumb_url IS
  'Small (~300px) thumbnail URL for POS grid. image_url is full-size (~800px).';

-- ── Track origin so we can re-mirror later if needed ──────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_origin_url TEXT;
COMMENT ON COLUMN products.image_origin_url IS
  'Original source URL (e.g., Square CDN) before mirroring. Kept for re-sync.';

-- Verify
SELECT id, public FROM storage.buckets WHERE id = 'product-photos';
SELECT count(*) AS products_with_square_cdn
  FROM products
  WHERE image_url LIKE '%items-images-production%';
