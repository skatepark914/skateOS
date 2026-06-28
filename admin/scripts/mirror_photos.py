#!/usr/bin/env python3
"""Mirror product photos from external CDN (Square) → Supabase Storage.

For each product where image_url points to Square's S3 CDN:
  1. Download the original image (3MB+ JPEGs)
  2. Resize to max 800px wide (saves bandwidth) → upload as <id>.jpg
  3. Create 300x300 cover-crop thumbnail → upload as <id>_thumb.jpg
  4. Update products.image_url + image_thumb_url + image_origin_url

Run once for initial migration; safe to re-run (skips already-mirrored).

Env vars:
  SUPABASE_URL                — https://zecurmlenxyxanqucrga.supabase.co
  SUPABASE_SERVICE_ROLE_KEY   — service role JWT (bypasses RLS for inserts)

Usage:
  python3 mirror_photos.py            # mirror all unmirrored
  python3 mirror_photos.py --limit 10 # test with first 10
  python3 mirror_photos.py --refetch  # re-mirror everything (replaces existing)
"""
import os, sys, json, io, time
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# Pillow for resize/thumbnail. Falls back to "skip thumbnail" if missing.
try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    print("⚠ Pillow not installed — install with: pip3 install Pillow", file=sys.stderr)
    print("Continuing without thumbnail generation — full-size only.", file=sys.stderr)
    HAS_PIL = False

SB_URL = os.environ.get('SUPABASE_URL', 'https://zecurmlenxyxanqucrga.supabase.co').rstrip('/')
SB_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
BUCKET = 'product-photos'
LIMIT = None
REFETCH = False
for arg in sys.argv[1:]:
    if arg == '--refetch': REFETCH = True
    elif arg.startswith('--limit'):
        try: LIMIT = int(arg.split('=')[1] if '=' in arg else sys.argv[sys.argv.index(arg) + 1])
        except: pass

if not SB_KEY:
    print("Need SUPABASE_SERVICE_ROLE_KEY env var", file=sys.stderr)
    sys.exit(1)

def sb_get(path):
    req = Request(SB_URL + path,
                  headers={'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}'})
    try:
        r = urlopen(req, timeout=30)
        return json.loads(r.read().decode('utf-8'))
    except HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f"  GET {path} → {e.code}: {body[:200]}")
        return None

def sb_patch(path, body):
    req = Request(SB_URL + path,
                  data=json.dumps(body).encode('utf-8'),
                  method='PATCH',
                  headers={
                      'apikey': SB_KEY,
                      'Authorization': f'Bearer {SB_KEY}',
                      'Content-Type': 'application/json',
                      'Prefer': 'return=minimal',
                  })
    try:
        r = urlopen(req, timeout=30)
        return r.status
    except HTTPError as e:
        return e.code

def storage_upload(path, data, content_type='image/jpeg'):
    """Upload bytes to Supabase Storage."""
    url = f"{SB_URL}/storage/v1/object/{BUCKET}/{path}"
    req = Request(url, data=data, method='POST',
                  headers={
                      'Authorization': f'Bearer {SB_KEY}',
                      'Content-Type': content_type,
                      'x-upsert': 'true',  # overwrite if exists
                      'cache-control': 'public, max-age=31536000',
                  })
    try:
        r = urlopen(req, timeout=60)
        return True
    except HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f"  upload {path} → {e.code}: {body[:200]}")
        return False

def public_url(path):
    return f"{SB_URL}/storage/v1/object/public/{BUCKET}/{path}"

def download(url):
    """Download external image to bytes. Catches all errors so the loop survives."""
    req = Request(url, headers={'User-Agent': 'Mozilla/5.0 skateOS photo mirror'})
    try:
        r = urlopen(req, timeout=30)
        return r.read()
    except Exception as e:
        print(f"  download fail: {type(e).__name__}: {e}")
        return None

def resize_jpeg(data, max_width=800, max_height=800, quality=85):
    """Resize image to fit within max_width x max_height, return JPEG bytes."""
    if not HAS_PIL: return data  # return original if no PIL
    try:
        img = Image.open(io.BytesIO(data))
        if img.mode in ('RGBA', 'LA', 'P'):
            # Flatten alpha onto white
            bg = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P': img = img.convert('RGBA')
            bg.paste(img, mask=img.split()[-1] if img.mode in ('RGBA','LA') else None)
            img = bg
        elif img.mode != 'RGB':
            img = img.convert('RGB')
        img.thumbnail((max_width, max_height), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, 'JPEG', quality=quality, optimize=True)
        return out.getvalue()
    except Exception as e:
        print(f"  resize fail: {e}")
        return data

def make_thumbnail(data, size=300, quality=85):
    """Square-crop center, resize to size x size."""
    if not HAS_PIL: return None
    try:
        img = Image.open(io.BytesIO(data))
        if img.mode in ('RGBA', 'LA', 'P'):
            bg = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P': img = img.convert('RGBA')
            bg.paste(img, mask=img.split()[-1] if img.mode in ('RGBA','LA') else None)
            img = bg
        elif img.mode != 'RGB':
            img = img.convert('RGB')
        # center-crop to square
        w, h = img.size
        m = min(w, h)
        left = (w - m) // 2
        top = (h - m) // 2
        img = img.crop((left, top, left + m, top + m))
        img = img.resize((size, size), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, 'JPEG', quality=quality, optimize=True)
        return out.getvalue()
    except Exception as e:
        print(f"  thumb fail: {e}")
        return None

# ──── Find products to mirror ────
print(f"\nMirror photos: bucket={BUCKET} url={SB_URL}")
print(f"  refetch={REFETCH} limit={LIMIT or 'all'}\n")

# Pull all products where image_url is set + (not yet mirrored OR refetch)
filter_str = "image_url=not.is.null"
if not REFETCH:
    filter_str += "&image_origin_url=is.null"
products = sb_get(f"/rest/v1/products?select=id,name,image_url,image_origin_url&{filter_str}&limit={LIMIT or 10000}")
if products is None:
    print("Failed to fetch products"); sys.exit(1)
print(f"Found {len(products)} products to mirror.\n")

ok = 0
skipped = 0
failed = 0
start = time.time()

for i, p in enumerate(products, 1):
    pid = p['id']
    url = p['image_url']
    if not url: continue
    if not REFETCH and url.startswith(SB_URL):
        skipped += 1; continue  # already mirrored

    # Print progress every 10
    if i % 10 == 0 or i == 1:
        elapsed = time.time() - start
        rate = i / elapsed if elapsed > 0 else 0
        eta = (len(products) - i) / rate if rate > 0 else 0
        print(f"[{i}/{len(products)}] ok={ok} fail={failed} · {rate:.1f}/s · ETA {int(eta)}s")
    print(f"  {pid[:8]}… {p['name'][:50]}")

    # Download
    data = download(url)
    if not data:
        failed += 1; continue

    # Resize + upload main image (800px max)
    main_jpg = resize_jpeg(data, max_width=800, max_height=800, quality=85)
    main_path = f"{pid}.jpg"
    if not storage_upload(main_path, main_jpg, 'image/jpeg'):
        failed += 1; continue

    # Thumbnail (300x300 cover)
    thumb_jpg = make_thumbnail(data, size=300)
    thumb_path = None
    if thumb_jpg:
        thumb_path = f"{pid}_thumb.jpg"
        if not storage_upload(thumb_path, thumb_jpg, 'image/jpeg'):
            thumb_path = None  # thumb optional

    # Update DB
    update = {
        'image_origin_url': url,
        'image_url': public_url(main_path),
    }
    if thumb_path:
        update['image_thumb_url'] = public_url(thumb_path)
    status = sb_patch(f"/rest/v1/products?id=eq.{pid}", update)
    if status in (200, 204):
        ok += 1
    else:
        print(f"  patch fail: {status}")
        failed += 1

    # Polite pause every 50 to avoid hammering Square
    if i % 50 == 0:
        time.sleep(1)

elapsed = time.time() - start
print(f"\n=== DONE: {ok} mirrored, {failed} failed, {skipped} already-mirrored ({elapsed:.0f}s total)")
