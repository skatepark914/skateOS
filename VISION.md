# VISION.md — skateOS Vision Box (Frigate + Coral)

> Runbook for the on-site computer-vision system that pairs with Brivo cloud access. Phase 9 of CLAUDE.md. Software side scaffolded in migration 068 + `frigate-webhook` Edge Function; hardware deploy is per-park.

## What this is

skateOS ships each park a **Vision Box** — Raspberry Pi 5 + Google Coral USB Accelerator running [Frigate](https://frigate.video/) against the park's RTSP cameras. Detections stream into skateOS via webhook for cross-referencing with Brivo door events, live capacity counting, and incident auto-photo.

```
On-site                              Cloud
─────────                            ─────
                                    
[ IP cams ] ──RTSP──► [ Vision Box ]──HTTPS──► [ frigate-webhook ] ──► frigate_events table
                       Pi 5 + Coral             (Supabase)               │
                       Frigate                                            │
                                                                          ▼
                                                                  cross-ref by ±5s
                                                                          │
                                                                          ▼
                                                                  brivo_access_log
                                                                  (mig 064)
```

**Why on-site (not cloud video)**:
- Cheap hardware: ~$300-500 per park ($75 Pi 5, $60 Coral, $50 SD card + PSU, ~$150 cameras if buying new)
- No cloud video bandwidth — only event payloads (timestamps + bounding boxes + small thumbnails) cross the public internet
- Local AI inference via Coral TPU — sub-100ms detection, no Brivo / Frigate-cloud subscription needed
- Owner controls + owns the footage; we just see events

## What it unlocks

| Use case | How |
|---|---|
| **Confirm auto-checkin** matches the right human | Brivo grant + person detection within ±5s → linked in frigate_events.brivo_access_log_id |
| **Tailgater / intrusion detection** | Person at park door with **no** Brivo grant within ±5s → Dashboard alert chip |
| **Live capacity count** | `frigate_recent_park_count` view replaces manual `maxCapacity` guess |
| **Auto-attach incident photos** | When an incident is filed within 5 min of a recent person event, suggest the matching snapshot |
| **After-hours forensics** | Cross-ref door grant + camera detection for unusual entries |
| **Helmet detection** (custom model — Phase 3.5) | Compliance audit during sessions |
| **Vehicle / arrival patterns** | Cars at parking lot → staffing data |

## Migration backlog

| Migration | What it adds |
|---|---|
| `068_frigate_events.sql` | `frigate_cameras` table (per-camera config) + `frigate_events` table (detection event log with Brivo cross-ref FK) + `frigate_recent_park_count` view (live people/car counts over last 60min/10min). Tenant-scoped RLS. |

## Edge Functions

| Function | Purpose | Triggered by |
|---|---|---|
| `frigate-webhook` | Receives Frigate's `new` / `update` / `end` events, upserts to `frigate_events`, cross-refs Brivo grants on park-door person events (±5s window) | Vision Box's Frigate config (event webhook) |

## On-site setup (per park)

### Hardware
1. **Raspberry Pi 5** (8GB) + power supply + active-cooling case
2. **Google Coral USB Accelerator** — plug into Pi's USB 3.0 port
3. **microSD card** (64GB+, U3 class — Frigate writes a lot)
4. **IP cameras** (RTSP-capable) — recommended: Reolink RLC-810A or similar at $40-60 each. Park door cam is the load-bearing one; add lobby / bowl / street as budget allows.
5. **Ethernet** — Vision Box on wired LAN for reliability; cameras likewise if possible

### Software (one-shot SD card image — TODO Phase 9.5)
1. Raspberry Pi OS Lite (64-bit)
2. Docker + Docker Compose
3. Frigate container with config pointing to skateOS webhook URL
4. Tailscale / WireGuard for remote admin

### skateOS-side config
1. **Add each camera** to `frigate_cameras`:
   ```sql
   INSERT INTO frigate_cameras (camera_key, display_name, location_label, enabled)
   VALUES
     ('park_door_cam',  'Park door cam (BDS overlook)', 'park_door', TRUE),
     ('lobby_cam',      'Lobby + front desk',           'lobby',     TRUE),
     ('bowl_cam',       'Bowl overlook',                'bowl',      TRUE);
   ```
   `camera_key` MUST match Frigate's camera ID exactly — that's the join key.

2. **Set the webhook secret**:
   ```bash
   supabase secrets set FRIGATE_WEBHOOK_SECRET=$(openssl rand -hex 32) \
     --project-ref zecurmlenxyxanqucrga
   bash admin/deploy-functions.sh
   ```

3. **Configure Frigate webhook** in `/config/config.yml`:
   ```yaml
   events:
     webhook:
       url: https://zecurmlenxyxanqucrga.supabase.co/functions/v1/frigate-webhook
       headers:
         x-frigate-secret: <the-secret-from-above>
         x-frigate-tenant: <tenant-uuid>   # for multi-park installs
   ```

## What's already wired vs pending

| Piece | Status |
|---|---|
| `frigate_events` schema | ✅ Migration 068 |
| `frigate_cameras` schema | ✅ Migration 068 |
| `frigate_recent_park_count` view | ✅ Migration 068 |
| `frigate-webhook` Edge Function | ✅ Built — handles new/update/end + Brivo cross-ref |
| Dashboard "Park vision" widget | ✅ Built — auto-hides until first event |
| Tailgater warning chip | ✅ Built — fires when ≥2 person events at park door without Brivo grant |
| Setup Status probe for mig 068 | ✅ Built |
| Vision Box SD card image | ⏳ Phase 9.5 |
| Per-tenant Vision Box provisioning | ⏳ Phase 9.5 (pairs with per-tenant Brivo / CLAUDE.md item 8) |
| Custom helmet-detection model | ⏳ Phase 3.5 — needs training data |
| Auto-photo on incident report | ⏳ Phase 9 follow-up |

## Privacy notes

- Vision Box stores video locally (Pi's SD card). Only event metadata + small snapshot thumbnails traverse the public internet.
- Faces are NOT identified locally — face match runs in Brivo's cloud (separate enrollment flow in Brivo dashboard).
- Recommended retention: Vision Box keeps 7-14 days of video locally; skateOS `frigate_events` table can retain forever (cheap — JSONB payload).
- For per-tenant deployments, video stays at the park; skateOS sees event metadata only.

## Inspect SQL helpers

```sql
-- Live park count from vision
SELECT * FROM frigate_recent_park_count;

-- Recent detections (last 50)
SELECT label, sub_label, score, start_time, camera_key
FROM frigate_events
ORDER BY start_time DESC LIMIT 50;

-- Person events at park door with NO Brivo grant within ±5s
-- (potential tailgaters / unauthorized entry)
SELECT f.start_time, fc.display_name, f.snapshot_url
FROM frigate_events f
JOIN frigate_cameras fc ON fc.id = f.camera_id
WHERE f.label = 'person'
  AND fc.location_label = 'park_door'
  AND f.brivo_access_log_id IS NULL
  AND f.start_time > NOW() - INTERVAL '7 days'
ORDER BY f.start_time DESC;

-- Cross-ref grant rate: % of Brivo grants matched by a person detection
SELECT
  COUNT(*) FILTER (WHERE b.event_type IN ('access_granted','face_matched')) AS total_grants,
  COUNT(*) FILTER (WHERE b.event_type IN ('access_granted','face_matched') AND f.id IS NOT NULL) AS grants_with_vision,
  ROUND(100.0 * COUNT(*) FILTER (WHERE b.event_type IN ('access_granted','face_matched') AND f.id IS NOT NULL)
              / NULLIF(COUNT(*) FILTER (WHERE b.event_type IN ('access_granted','face_matched')), 0), 1) AS vision_match_pct
FROM brivo_access_log b
LEFT JOIN frigate_events f ON f.brivo_access_log_id = b.id
WHERE b.occurred_at > NOW() - INTERVAL '7 days';
```

## Initial setup history

- **2026-05-15** (deep night): Migration 068 + frigate-webhook + Dashboard widget shipped as scaffolding ahead of hardware deploy. No real Vision Box hardware deployed at 2nd Nature yet — admin UI auto-hides the widget until first event lands.
