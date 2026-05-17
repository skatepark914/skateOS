-- ============================================================
-- 044_customer_update_self.sql — customer self-serve profile edit
--
-- Lets a signed-in customer update their own contact info from the
-- self-serve portal (admin/me.html) without calling the front desk.
-- SECURITY DEFINER bypasses RLS; gates on
-- `current_customer_id() = customer.id` so a customer can only edit
-- their own record.
--
-- Allowed fields: email, phone, parent_name, parent_phone, parent_email,
-- address, city, state, zip, dob (if not yet set — DOB only editable
-- once to prevent fraud against age-gated discounts).
--
-- Refused fields (auth-sensitive or owner-managed): name (forces a
-- conversation if they've changed legal name), waiver_*, loyalty_*,
-- total_spent, total_visits, tags, photo_url, status. The owner edits
-- those from the admin side.
--
-- Each successful update appends an audit line to customer.notes:
--   [Self-edit 2026-05-05 by customer: email, phone]
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION customer_update_self(
  p_email         TEXT DEFAULT NULL,
  p_phone         TEXT DEFAULT NULL,
  p_parent_name   TEXT DEFAULT NULL,
  p_parent_phone  TEXT DEFAULT NULL,
  p_parent_email  TEXT DEFAULT NULL,
  p_address       TEXT DEFAULT NULL,
  p_city          TEXT DEFAULT NULL,
  p_state         TEXT DEFAULT NULL,
  p_zip           TEXT DEFAULT NULL,
  p_dob           DATE DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id  UUID;
  v_existing     customers%ROWTYPE;
  v_changes      TEXT[] := ARRAY[]::TEXT[];
  v_email_clean  TEXT;
  v_phone_clean  TEXT;
  v_audit_stamp  TEXT;
  v_combined_notes TEXT;
BEGIN
  v_customer_id := current_customer_id();
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated as a customer';
  END IF;

  SELECT * INTO v_existing FROM customers WHERE id = v_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer record not found';
  END IF;

  -- Track which fields actually changed for the audit stamp.
  -- NULL incoming = "don't touch" (preserve existing); empty string = "clear".
  -- Trim incoming strings to avoid whitespace-only updates.

  IF p_email IS NOT NULL THEN
    v_email_clean := NULLIF(TRIM(p_email), '');
    IF v_email_clean IS DISTINCT FROM v_existing.email THEN
      -- Light email sanity (server-side). Reject obvious junk.
      IF v_email_clean IS NOT NULL AND v_email_clean !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'Invalid email format: %', v_email_clean;
      END IF;
      v_changes := array_append(v_changes, 'email');
    END IF;
  END IF;

  IF p_phone IS NOT NULL THEN
    v_phone_clean := NULLIF(TRIM(p_phone), '');
    IF v_phone_clean IS DISTINCT FROM v_existing.phone THEN
      v_changes := array_append(v_changes, 'phone');
    END IF;
  END IF;

  IF p_parent_name IS NOT NULL AND NULLIF(TRIM(p_parent_name),'') IS DISTINCT FROM v_existing.parent_name THEN
    v_changes := array_append(v_changes, 'parent_name');
  END IF;
  IF p_parent_phone IS NOT NULL AND NULLIF(TRIM(p_parent_phone),'') IS DISTINCT FROM v_existing.parent_phone THEN
    v_changes := array_append(v_changes, 'parent_phone');
  END IF;
  IF p_parent_email IS NOT NULL AND NULLIF(TRIM(p_parent_email),'') IS DISTINCT FROM v_existing.parent_email THEN
    IF NULLIF(TRIM(p_parent_email),'') IS NOT NULL AND p_parent_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'Invalid parent email format';
    END IF;
    v_changes := array_append(v_changes, 'parent_email');
  END IF;
  IF p_address IS NOT NULL AND NULLIF(TRIM(p_address),'') IS DISTINCT FROM v_existing.address THEN
    v_changes := array_append(v_changes, 'address');
  END IF;
  IF p_city IS NOT NULL AND NULLIF(TRIM(p_city),'') IS DISTINCT FROM v_existing.city THEN
    v_changes := array_append(v_changes, 'city');
  END IF;
  IF p_state IS NOT NULL AND NULLIF(TRIM(p_state),'') IS DISTINCT FROM v_existing.state THEN
    v_changes := array_append(v_changes, 'state');
  END IF;
  IF p_zip IS NOT NULL AND NULLIF(TRIM(p_zip),'') IS DISTINCT FROM v_existing.zip THEN
    v_changes := array_append(v_changes, 'zip');
  END IF;

  -- DOB: only editable when currently NULL (one-shot, prevents age-gate fraud).
  -- If they need to change a wrong DOB, they call the front desk.
  IF p_dob IS NOT NULL AND v_existing.dob IS NULL THEN
    v_changes := array_append(v_changes, 'dob');
  ELSIF p_dob IS NOT NULL AND p_dob IS DISTINCT FROM v_existing.dob THEN
    -- Silent ignore — DOB already set. Don't error (would be ugly UX),
    -- just skip the field. Audit reflects what actually changed.
    NULL;
  END IF;

  IF array_length(v_changes, 1) IS NULL THEN
    -- No actual changes
    RETURN json_build_object('ok', true, 'changed', 0, 'fields', '[]'::JSON);
  END IF;

  -- Compose the audit stamp
  v_audit_stamp := '[Self-edit '|| TO_CHAR(NOW(),'YYYY-MM-DD') ||' by customer: '|| array_to_string(v_changes, ', ') ||']';
  v_combined_notes := COALESCE(v_existing.notes || E'\n', '') || v_audit_stamp;

  -- Apply the update — coalesce ensures NULL incoming = preserve existing.
  -- Empty-string-to-NULL preserved via the v_email_clean / v_phone_clean
  -- pattern above; for parent_* / address etc. we use NULLIF inline.
  UPDATE customers
     SET email         = COALESCE(v_email_clean, email),
         phone         = COALESCE(v_phone_clean, phone),
         parent_name   = CASE WHEN p_parent_name  IS NOT NULL THEN NULLIF(TRIM(p_parent_name),'')  ELSE parent_name  END,
         parent_phone  = CASE WHEN p_parent_phone IS NOT NULL THEN NULLIF(TRIM(p_parent_phone),'') ELSE parent_phone END,
         parent_email  = CASE WHEN p_parent_email IS NOT NULL THEN NULLIF(TRIM(p_parent_email),'') ELSE parent_email END,
         address       = CASE WHEN p_address      IS NOT NULL THEN NULLIF(TRIM(p_address),'')      ELSE address      END,
         city          = CASE WHEN p_city         IS NOT NULL THEN NULLIF(TRIM(p_city),'')         ELSE city         END,
         state         = CASE WHEN p_state        IS NOT NULL THEN NULLIF(TRIM(p_state),'')        ELSE state        END,
         zip           = CASE WHEN p_zip          IS NOT NULL THEN NULLIF(TRIM(p_zip),'')          ELSE zip          END,
         dob           = CASE WHEN p_dob          IS NOT NULL AND v_existing.dob IS NULL THEN p_dob ELSE dob          END,
         notes         = v_combined_notes,
         updated_at    = NOW()
   WHERE id = v_customer_id;

  RETURN json_build_object(
    'ok',      true,
    'changed', array_length(v_changes, 1),
    'fields',  to_json(v_changes)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION customer_update_self(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DATE) TO authenticated;

-- Inspection:
--   SELECT customer_update_self(p_email := 'new@example.com');  -- as the auth'd customer
