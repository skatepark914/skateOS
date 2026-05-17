-- ============================================================
-- 037_customer_merge.sql — server-side customer merge RPC
--
-- Pairs with the JS "Find dupes" finder shipped earlier. When the
-- owner sees two records that are the same person (typo'd name,
-- registered twice, parent + kid swapped, etc.), this RPC moves
-- every FK reference from the "drop" customer to the "keep" one,
-- merges the loyalty balance, then deletes the drop row.
--
-- Tables touched (FK customer_id):
--   sales, lessons, subscriptions, loyalty_transactions, checkins,
--   incidents, lesson_attendees, invoices, orders, equipment_loans
--
-- Returns JSON { ok, kept_id, dropped_id, moved: { table → count } }.
-- Owner-only (is_owner() check). Wrapped in implicit transaction so a
-- mid-merge failure doesn't leave half-moved data.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION merge_customers(
  p_keep_id UUID,
  p_drop_id UUID,
  p_reason  TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  keep_row    customers%ROWTYPE;
  drop_row    customers%ROWTYPE;
  moved       JSONB := '{}'::JSONB;
  pts_keep    INT;
  pts_drop    INT;
  cnt         INT;
  audit_note  TEXT;
BEGIN
  IF NOT is_owner() THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;
  IF p_keep_id = p_drop_id THEN
    RAISE EXCEPTION 'keep_id and drop_id must differ';
  END IF;

  SELECT * INTO keep_row FROM customers WHERE id = p_keep_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Keep customer not found'; END IF;
  SELECT * INTO drop_row FROM customers WHERE id = p_drop_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Drop customer not found'; END IF;

  -- 1. Move FKs. Each block is best-effort against missing tables.
  BEGIN UPDATE sales                SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('sales', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE lessons              SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('lessons', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE subscriptions        SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('subscriptions', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE loyalty_transactions SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('loyalty_transactions', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE checkins             SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('checkins', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE incidents            SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('incidents', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    -- lesson_attendees has UNIQUE (lesson_id, customer_id) — skip rows that would collide.
    DELETE FROM lesson_attendees a
     WHERE a.customer_id = p_drop_id
       AND EXISTS (SELECT 1 FROM lesson_attendees b WHERE b.lesson_id = a.lesson_id AND b.customer_id = p_keep_id);
    UPDATE lesson_attendees       SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
    GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('lesson_attendees', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE invoices             SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('invoices', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE orders               SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('orders', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE equipment_loans      SET customer_id = p_keep_id WHERE customer_id = p_drop_id;
        GET DIAGNOSTICS cnt = ROW_COUNT; moved := moved || jsonb_build_object('equipment_loans', cnt);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- 2. Sum loyalty cached balance (loyalty_transactions trigger from migration 006
  --    handles points sync on insert; we just patch the cached column on customers).
  pts_keep := COALESCE(keep_row.loyalty_points, 0);
  pts_drop := COALESCE(drop_row.loyalty_points, 0);
  IF pts_drop > 0 THEN
    UPDATE customers
       SET loyalty_points = pts_keep + pts_drop
     WHERE id = p_keep_id;
  END IF;

  -- 3. Stamp audit note onto kept row
  audit_note := '[Merged customer ' || COALESCE(drop_row.name,'?') || ' (' || drop_row.id || ') on ' ||
                to_char(NOW(),'YYYY-MM-DD') || COALESCE(': '||p_reason,'') || ']';
  UPDATE customers
     SET notes = COALESCE(notes||E'\n','') || audit_note,
         updated_at = NOW()
   WHERE id = p_keep_id;

  -- 4. Delete the dropped row
  DELETE FROM customers WHERE id = p_drop_id;

  RETURN json_build_object(
    'ok', true,
    'kept_id',    p_keep_id,
    'dropped_id', p_drop_id,
    'moved',      moved,
    'merged_loyalty', pts_drop
  );
END;
$$;

GRANT EXECUTE ON FUNCTION merge_customers(UUID, UUID, TEXT) TO authenticated;
