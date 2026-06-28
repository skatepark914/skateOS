# /2ntr/assets

Drop a real skate montage here and both `/2ntr` (the chooser) and `/2ntr/park`
will use it as the hero background video.

## What to put here

**`skate-bg.mp4`** — looping background video.

Recommended specs:
- **Format:** H.264 MP4 (broadest browser support)
- **Duration:** 15-30 seconds, looped
- **Resolution:** 1920×1080 or 1280×720 (will scale down on mobile)
- **No audio** — pages mute it anyway, removing audio shaves ~20% file size
- **Size budget:** keep under 4 MB if possible (most users on phones)
- **Vibe:** wide shots of the park, skaters in motion, golden-hour light works
  great. Avoid hard cuts every 2 seconds — long held shots feel premium.

## Encode tips

If you have a raw clip and want to compress it down, on any Mac:

```bash
# Drop the file in here, then run from this dir:
ffmpeg -i your-raw-video.mov \
  -vcodec libx264 -crf 26 -preset slow \
  -vf "scale=1920:-2,fps=24" \
  -an -movflags +faststart \
  skate-bg.mp4
```

The `-crf 26` is the quality knob — lower = bigger file + sharper.
22 is "looks great," 28 is "good enough for background."

## What happens without the file

Both pages have a graceful fallback — a dark gradient stands in for the
missing video. The page still works, it just doesn't move.

The `<video>` tag has `onerror` that hides itself + adds a `.no-video`
class to the hero, switching it to the gradient look.
