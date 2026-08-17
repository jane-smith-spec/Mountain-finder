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

## Update: the map screenshot narrows photo 2, but does not pin it

A supplied map screenshot shows the photo pinned with three named features around it:
**Crater Lake** (west), **The Gunsight** (south-west), **Tin Cup Lake** (far south-west).

Searched against the imported Idaho data:

- **"Gunsight Peak" exists at 43.69767, −115.07147, 2893 m — but that is ~45 km south-west of
  the White Clouds.** It is a *different feature* from the "The Gunsight" on the map, which is
  unlabelled in the peak data (likely a named gap or notch rather than a summit). Recorded as a
  negative so nobody later matches on the name and lands 45 km away. This is the same hazard the
  Overture import already flagged: *"Cow Hill" is 287 m in Lochaber and 989 m in Santa Clara;
  only ids are safe.*
- The White Clouds summit set around the pin **is** confirmed in real data, and it is the range
  in the photograph:

```
Castle Peak          44.03980, −114.58698   3603 m
Lee Peak             44.10281, −114.62862   3458 m
Lonesome Lake Peak   44.07531, −114.61207   3445 m
Mount Andrus         44.09107, −114.60921   3438 m
White Cloud Peaks    44.09734, −114.62788   3438 m
Patterson Peak       44.04868, −114.61867   3317 m
Merriam Peak         44.05244, −114.58086   3334 m
```

**Still not established: the camera position.** A screenshot places the pin relative to lakes,
but reading a coordinate off it by eye would be exactly the kind of invented number this project
refuses elsewhere. The mapping app showing that pin can give the number directly.
