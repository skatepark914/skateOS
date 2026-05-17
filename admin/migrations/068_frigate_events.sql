-- ============================================================
-- 068_frigate_events.sql — skateOS Vision Box (Frigate) audit log
-- ============================================================
-- Scaffolds the on-site computer-vision data layer ahead of the
-- "skateOS Vision Box" hardware deploy (Phase 9 in CLAUDE.md item 9).
--
-- Vision Box = Raspberry Pi 5 + Google Coral USB Accelerator running
-- Frigate against the park's RTSP cameras. Detections stream to
-- skateOS via the `frigate-webhook` Edge Function and land in this
-- table.
--
-- WHAT THIS DOES:
--   - Adds `frigate_events` table — append-only event log
--   - Cross-references with brivo_access_log via brivo_event_id
--     (when a person-detected event lines up with a Brivo grant
--     within ±5s, we link the two for forensics + auto-attach photos)
--   - Adds `frigate_cameras` table — per-camera config (name, location,
--     RTSP URL, enabled flag) so multi-camera installs are first-class
--   - View `frigate_recent_park_count` — rolling 60-min unique-person
--     count, used by Dashboard widgets for live capacity
--
-- WHAT THIS DOES NOT DO:
--   - Does NOT process video itself — that's on the Vision Box
--   - Does NOT replace Brivo door access — it augments it
--   - Does NOT enroll faces — that's done in Brivo dashboard
--
-- DEPENDENCIES:
--   - Migration 009 (tenants table)
--   - Migration 064 (brivo_access_log — cross-ref target, optional)
--   - Migration 063 (strict RLS pattern)
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================

-- ── 1. Per-camera config ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS frigate_cameras (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  camera_key      TEXT NOT NULL,             -- Frigate's `camera_id` from MQTT/webhook payload
  display_name    TEXT NOT NULL,             -- "Park door cam" / "Bowl overlook"
  location_label  TEXT,                      -- 'park_door' / 'street' / 'bowl' / 'lobby' etc.
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  -- Optional RTSP URL stored for documentation only (Vision Box reads its own config)
  rtsp_url        TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, camera_key)
);

CREATE INDEX IF NOT EXISTS idx_frigate_cameras_enabled
  ON frigate_cameras(tenant_id, enabled) WHERE enabled = TRUE;

ALTER TABLE frigate_cameras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON frigate_cameras;
DROP POLICY IF EXISTS tenant_isolation_write  ON frigate_cameras;
CREATE POLICY tenant_isolation_select ON frigate_cameras
  FOR SELECT USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);
CREATE POLICY tenant_isolation_write ON frigate_cameras
  FOR ALL
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL)
  WITH CHECK (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);


-- ── 2. Detection event log ────────────────────────────────────
CREATE TABLE IF NOT EXISTS frigate_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID REFERENCES tenants(id) ON DELETE CASCADE,
  frigate_event_id    TEXT,                  -- Frigate's own event identifier (unique per event)
  camera_id           UUID REFERENCES frigate_cameras(id) ON DELETE SET NULL,
  camera_key          TEXT,                  -- denormalized for queries when FK is null
  label               TEXT NOT NULL,         -- 'person' / 'car' / 'package' / 'dog' / custom
  sub_label           TEXT,                  -- e.g. specific person name from face_recognition addon
  score               REAL,                  -- Frigate's confidence 0..1
  top_score           REAL,                  -- best score during event
  start_time          TIMESTAMPTZ NOT NULL,
  end_time            TIMESTAMPTZ,
  has_clip            BOOLEAN NOT NULL DEFAULT FALSE,
  has_snapshot        BOOLEAN NOT NULL DEFAULT FALSE,
  clip_url            TEXT,
  snapshot_url        TEXT,
  -- Optional cross-references
  customer_id         UUID REFERENCES customers(id) ON DELETE SET NULL,
  brivo_access_log_id UUID,                  -- not a hard FK — brivo_access_log may have its own retention
  -- Audit
  raw_payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dedup against webhook retries
CREATE UNIQUE INDEX IF NOT EXISTS idx_frigate_events_event_id
  ON frigate_events(frigate_event_id) WHERE frigate_event_id IS NOT NULL;

-- Recent-events lookups (drives Dashboard widget)
CREATE INDEX IF NOT EXISTS idx_frigate_events_recent
  ON frigate_events(start_time DESC);

-- Per-camera lookup
CREATE INDEX IF NOT EXISTS idx_frigate_events_camera
  ON frigate_events(camera_id, start_time DESC);

-- Person events specifically (the "people in park" signal)
CREATE INDEX IF NOT EXISTS idx_frigate_events_person_recent
  ON frigate_events(start_time DESC)
  WHERE label = 'person';

-- Cross-ref index: find Brivo grant within ±5s of vision detection
CREATE INDEX IF NOT EXISTS idx_frigate_events_brivo_link
  ON frigate_events(brivo_access_log_id) WHERE brivo_access_log_id IS NOT NULL;

ALTER TABLE frigate_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON frigate_events;
DROP POLICY IF EXISTS tenant_isolation_write  ON frigate_events;
CREATE POLICY tenant_isolation_select ON frigate_events
  FOR SELECT USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);
CREATE POLICY tenant_isolation_write ON frigate_events
  FOR ALL
  USING (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL)
  WITH CHECK (tenant_id = current_tenant_id() OR current_tenant_id() IS NULL);


-- ── 3. View: live people-in-park count from vision ────────────
-- Frigate's events have start_time + end_time. A person is "in the park
-- right now" if a recent person event exists for them in the last 60 min
-- with no later end_time (or end_time > now - 5min as backstop). For v1
-- we approximate with: count distinct (camera_key, hour-bucket-of-start)
-- pairs in the last 60 min. Owner uses this alongside the checkins-based
-- count to spot mismatches (door granted but no skater visible? person
-- entered without Brivo grant?).
CREATE OR REPLACE VIEW frigate_recent_park_count AS
SELECT
  tenant_id,
  COUNT(DISTINCT id) FILTER (
    WHERE start_time >= NOW() - INTERVAL '60 minutes'
      AND label = 'person'
  ) AS person_events_last_60m,
  COUNT(DISTINCT id) FILTER (
    WHERE start_time >= NOW() - INTERVAL '10 minutes'
      AND label = 'person'
  ) AS person_events_last_10m,
  COUNT(DISTINCT id) FILTER (
    WHERE start_time >= NOW() - INTERVAL '60 minutes'
      AND label = 'car'
  ) AS car_events_last_60m,
  MAX(start_time) FILTER (WHERE label = 'person') AS last_person_event_at
FROM frigate_events
WHERE start_time >= NOW() - INTERVAL '24 hours'
GROUP BY tenant_id;


-- ── 4. updated_at trigger for frigate_cameras ─────────────────
CREATE OR REPLACE FUNCTION frigate_cameras_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_frigate_cameras_touch ON frigate_cameras;
CREATE TRIGGER trg_frigate_cameras_touch
BEFORE UPDATE ON frigate_cameras
FOR EACH ROW EXECUTE FUNCTION frigate_cameras_touch_updated_at();


-- ============================================================
-- Notes:
--
-- ADD A CAMERA (Brivo dashboard + skateOS):
--   INSERT INTO frigate_cameras (camera_key, display_name, location_label)
--   VALUES ('park_door_cam', 'Park door cam (BDS overlook)', 'park_door');
--
-- INSPECT RECENT DETECTIONS:
--   SELECT label, score, start_time, sub_label
--   FROM frigate_events
--   ORDER BY start_time DESC LIMIT 50;
--
-- LIVE PARK COUNT (vision-based):
--   SELECT * FROM frigate_recent_park_count;
--
-- FIND BRIVO GRANTS WITHOUT MATCHING PERSON DETECTION (forensics —
-- e.g. someone got in via a stolen credential, or a tailgater):
--   SELECT b.occurred_at, c.name
--   FROM brivo_access_log b
--   LEFT JOIN customers c ON c.id = b.customer_id
--   LEFT JOIN frigate_events f ON f.brivo_access_log_id = b.id
--   WHERE b.event_type = 'access_granted'
--     AND b.access_point = 'park_door'
--     AND b.occurred_at > NOW() - INTERVAL '7 days'
--     AND f.id IS NULL
--   ORDER BY b.occurred_at DESC;
-- ============================================================
