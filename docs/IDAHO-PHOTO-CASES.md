# The two supplied photographs — what is established so far

Two real photographs, supplied 2026-08-17, committed as `fixtures/photos/real/`.
EXIF did **not** survive the upload path: `Orientation` and dimensions only — no GPS, no
`GPSImgDirection`, no focal length.

## 1. `lookout-snow-haze.jpeg` — Sunset Mountain Lookout, Idaho

**Location established, not guessed.** `Sunset Mountain` was found by importing central Idaho
from Overture (2.09 MB fetched, **0.0071%** of the 29.47 GB release, 6 row groups of 5056):

```
Sunset Mountain   43.89851, -115.64677   2393 m   (OSM ele tag, via Overture)
SRTM N43W116 reads the same coordinate at   2392.296 m
```

**A 0.7 m agreement between an OSM summit tag and the SRTM grid**, independently sourced. That
is a real cross-check of both the coordinate and the terrain layer at the actual viewpoint.

Extractor result: **coverage 1.4%**, mean confidence 0.140 — it cannot read this photo, and
says so. Diagnosed in `CV-REAL-PHOTO-FINDING.md`: bright→dark→bright vertical profile (snow
below brighter than sky above), desaturated white haze, contrast collapsing to −9/255 at the
right edge, plus a lookout frame over the left quarter.

## 2. `tundra-blue-sky.jpeg` — Railroad Ridge Road, White Cloud Mountains, Idaho

**Location NOT yet established.** "Railroad Ridge" did not come through the import: ridges
carry no `ele` tag and the importer drops elevation-less records by design (290 dropped in this
box), which is correct behaviour — it must not invent a height.

What the import *does* confirm about that area: **Castle Peak, 44.0398, −114.5870, 3603 m** —
the White Clouds high point, and the obvious anchor for the range in this photo.

Extractor result: **coverage 98.8%**, mean confidence 0.575, 506 of 512 columns resolved, the
skyline placed 29–36% down the frame. Confidence climbs 0.407 → 0.712 left to right, matching
the scene: smooth snowfield against bright cloud on the left, dark rock against blue sky on the
right. **The extractor reads this photograph correctly.**

## What is still needed, and why it matters more for photo 2

Neither photo has a view bearing. That is *not* fatal — recovering the heading is precisely what
`src/cv`'s aligner is for, and it does so to 0.013° against synthetic terrain. Photo 2 is the
one that can actually exercise that, because its skyline is readable.

The missing piece for photo 2 is a **position on Railroad Ridge Road**. A rough one is enough:
the aligner searches heading, so only the coordinate must be right. Terrain is already fetched
(`N44W115`, `N44W116`).

Once that lands, the full loop can run for the first time on a real photograph: extract the
skyline → align against SRTM-derived terrain → recover the heading → label the summits → and
check the names against what is actually in the picture.
