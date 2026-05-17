-- ============================================================
-- 054_retail_order_inventory.sql — atomic stock decrement on payment
--
-- Phase 1 of Square Online replica: when a retail order is paid (via
-- Helcim webhook OR manual mark-paid), atomically decrement product
-- stock. Without this, two customers can race-buy the last unit and
-- both succeed → physical inventory goes negative.
--
-- The RPC:
--   • Reads form_submissions.data.items[] (cart line items)
--   • For each item, decrements products.quantity by item.qty
--   • Logs to inventory_log with reason='retail_order_paid'
--   • Detects oversold conditions (qty would go negative) and:
--       - Stamps data.oversold_items[] on the submission for owner review
--       - Still decrements (clamped at 0) so the row reflects best effort
--   • Returns JSON with: ok, decremented[], oversold[], total_decrements
--
-- Idempotent on the submission: writes data.inventory_decremented_at
-- and refuses to fire twice. Safe to call multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION process_retail_order_payment(p_submission_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sub RECORD;
  item RECORD;
  current_qty INT;
  decrement_qty INT;
  new_qty INT;
  decremented JSONB := '[]'::jsonb;
  oversold JSONB := '[]'::jsonb;
  oversold_count INT := 0;
  total_decrements INT := 0;
BEGIN
  -- Fetch the submission + verify it's a retail-order
  SELECT s.*, f.slug AS form_slug
    INTO sub
    FROM form_submissions s
    JOIN forms f ON f.id = s.form_id
    WHERE s.id = p_submission_id
      AND f.slug = 'retail-order'
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'submission_not_found_or_not_retail');
  END IF;

  -- Idempotency: refuse to decrement twice
  IF (sub.data->>'inventory_decremented_at') IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'already_decremented', TRUE,
      'decremented_at', sub.data->>'inventory_decremented_at'
    );
  END IF;

  -- Walk items[]. Each entry has product_id + qty.
  FOR item IN
    SELECT
      (e->>'product_id')::TEXT AS product_id,
      COALESCE((e->>'qty')::INT, 1) AS qty,
      e->>'name' AS name,
      e->>'brand' AS brand
    FROM jsonb_array_elements(COALESCE(sub.data->'items', '[]'::jsonb)) AS e
  LOOP
    -- Look up current qty (FOR UPDATE locks the row)
    SELECT quantity INTO current_qty
      FROM products
      WHERE id = item.product_id::UUID
      FOR UPDATE;

    IF NOT FOUND THEN
      -- Unknown product — skip + log but don't fail the whole payment
      oversold := oversold || jsonb_build_object(
        'product_id', item.product_id, 'name', item.name, 'qty', item.qty,
        'reason', 'product_not_found'
      );
      oversold_count := oversold_count + 1;
      CONTINUE;
    END IF;

    decrement_qty := item.qty;
    new_qty := current_qty - decrement_qty;

    IF new_qty < 0 THEN
      -- Oversold case: log + clamp to 0 so the row stays accurate-ish
      oversold := oversold || jsonb_build_object(
        'product_id', item.product_id,
        'name', item.name,
        'requested', decrement_qty,
        'available', current_qty,
        'short', decrement_qty - current_qty
      );
      oversold_count := oversold_count + 1;
      decrement_qty := current_qty;  -- clamped
      new_qty := 0;
    END IF;

    UPDATE products
      SET quantity = new_qty
      WHERE id = item.product_id::UUID;

    -- inventory_log entry (mig 001 has this table; defensive try/catch
    -- in case of schema variation across forks).
    BEGIN
      INSERT INTO inventory_log (product_id, change_qty, reason, notes)
      VALUES (
        item.product_id::UUID,
        -decrement_qty,
        'retail_order_paid',
        'Order #' || SUBSTRING(p_submission_id::text, 1, 8) || ' · ' || COALESCE(item.name, '?')
      );
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
    END;

    decremented := decremented || jsonb_build_object(
      'product_id', item.product_id,
      'name', item.name,
      'qty_decremented', decrement_qty,
      'new_qty', new_qty
    );
    total_decrements := total_decrements + 1;
  END LOOP;

  -- Stamp the submission so we don't fire twice + surface oversold info
  UPDATE form_submissions
    SET data = data
      || jsonb_build_object(
        'inventory_decremented_at', NOW(),
        'inventory_decrements', decremented,
        'oversold_items', oversold,
        'oversold_count', oversold_count
      )
    WHERE id = p_submission_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'submission_id', p_submission_id,
    'total_decrements', total_decrements,
    'oversold_count', oversold_count,
    'oversold', oversold,
    'decremented', decremented
  );
END $$;

GRANT EXECUTE ON FUNCTION process_retail_order_payment(UUID) TO service_role, authenticated;
