-- ============================================================
-- 031_search_notes.sql — global notes / freeform-text search
--
-- Doug's been documenting incidents, customer notes, sale-refund
-- reasons, lesson notes, etc. They're scattered across 4+ tables.
-- This RPC unifies them so the admin "Search notes" modal can
-- find "head injury near snake run" in one query regardless of
-- which row holds the text.
--
-- Returns a uniform shape: source / source_id / when / preview /
-- linked_customer_name. UI links to the right page.
--
-- Idempotent. Safe to re-run.
-- ============================================================

DROP FUNCTION IF EXISTS search_notes(TEXT);

CREATE OR REPLACE FUNCTION search_notes(q TEXT)
RETURNS TABLE (
  source TEXT,           -- 'customer' | 'sale' | 'lesson' | 'incident' | 'subscription'
  source_id UUID,
  when_at TIMESTAMPTZ,
  preview TEXT,          -- first 200 chars of the matched field
  linked_customer_id UUID,
  linked_customer_name TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Customer notes
  SELECT
    'customer'::TEXT       AS source,
    c.id                   AS source_id,
    c.updated_at           AS when_at,
    LEFT(c.notes, 200)     AS preview,
    c.id                   AS linked_customer_id,
    c.name                 AS linked_customer_name
  FROM customers c
  WHERE c.notes ILIKE '%' || q || '%'

  UNION ALL

  -- Sale notes (refund reasons, manual annotations)
  SELECT
    'sale'::TEXT,
    s.id,
    s.created_at,
    LEFT(s.notes, 200),
    s.customer_id,
    s.customer_name
  FROM sales s
  WHERE s.notes ILIKE '%' || q || '%'

  UNION ALL

  -- Lesson notes
  SELECT
    'lesson'::TEXT,
    l.id,
    l.scheduled_at,
    LEFT(l.notes, 200),
    l.customer_id,
    (SELECT c2.name FROM customers c2 WHERE c2.id = l.customer_id)
  FROM lessons l
  WHERE l.notes ILIKE '%' || q || '%'

  UNION ALL

  -- Incident description + corrective action notes
  SELECT
    'incident'::TEXT,
    i.id,
    i.occurred_at,
    LEFT(COALESCE(i.description, '') || CASE WHEN i.corrective_action IS NOT NULL THEN E'\n[action] '||i.corrective_action ELSE '' END, 200),
    i.customer_id,
    i.skater_name
  FROM incidents i
  WHERE i.description       ILIKE '%' || q || '%'
     OR i.corrective_action ILIKE '%' || q || '%'

  UNION ALL

  -- Subscription notes (pause reasons, audit stamps)
  SELECT
    'subscription'::TEXT,
    sb.id,
    sb.created_at,
    LEFT(sb.notes, 200),
    sb.customer_id,
    sb.customer_name
  FROM subscriptions sb
  WHERE sb.notes ILIKE '%' || q || '%'

  ORDER BY when_at DESC NULLS LAST
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION search_notes(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_notes(TEXT) TO authenticated;
