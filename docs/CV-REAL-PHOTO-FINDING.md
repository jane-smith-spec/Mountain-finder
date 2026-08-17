# First contact with a real photograph: the extractor scores 0 of 512

**2026-08-17.** A user-supplied photograph — a snowy summit view from a fire lookout, 5712×4284
— is the first real photograph this project has ever had. `src/cv`'s skyline extractor was run
against it.

## Result

```
columns with a skyline : 0 of 512  (0.0%)
```

Total failure, across every part of the frame. Not degraded, not low-confidence — nothing.
Reported rather than tuned around, as the brief required.

Note this is the *honest* failure path: `alignSkyline` refuses with `insufficient-skyline`
rather than returning an offset. The aligner's refusal machinery works. The extractor does not.

## Why — measured, and NOT what we predicted

`MISSION.md` and the Phase 7 report predicted "sunlit snow is brighter than hazy sky, so the
sky/terrain step inverts". That is **partly wrong**. Measured luminance at the true skyline:

```
column   sky(35% down)   ridge(44%)   snow(75%)   step sky→ridge
x=45%        174            104          185         −70
x=55%        183             64          172        −118
x=65%        208            110           52         −98
x=75%        183            139          141         −43
x=85%        179            121          195         −57
x=95%        157            147          186          −9
```

The step at the true skyline is **negative everywhere** — sky *is* brighter than the ridge, as a
naive model assumes. The inversion is not the problem. Three other things are:

1. **The vertical profile is non-monotonic: bright → dark → bright.** Sky ~180, ridge ~110,
   then snow *back up* to ~185 — brighter than the sky above it in four of six columns. Any
   model that assumes "everything below the boundary is darker than everything above" has no
   valid boundary to find. This is the real killer and it was not anticipated.
2. **The sky is desaturated white haze, not blue.** Saturation at x=55%: sky **0.084**, ridge
   **0.526**. The ridge is *six times more saturated* than the sky — the exact opposite of the
   usual "blue sky, grey rock" assumption.
3. **Contrast collapses with distance.** At x=95% the step is **−9** out of 255, against −118
   at x=55%. Distant hazy ridges are nearly invisible to a fixed threshold.

## What this means

- The **aligner** is proven (0.013° against real SRTM terrain) and its refusals are honest.
- The **extractor** is now measured, and it is not fit for real photographs.
- A brightness-step model is insufficient. A texture/gradient cue, a non-monotonic segmentation,
  or a per-column adaptive threshold is required. This is real work, not a tuning pass.

## Also learned

**EXIF does not survive the upload path.** The photo arrived with `Orientation` and dimensions
only — no GPS, no `GPSImgDirection`, no focal length. This is exactly the case `src/exif`'s
`needs-manual` model exists for, so the pipeline handles it correctly, but it means a supplied
photograph is not automatically ground truth: the location and view direction must come with it
separately.

## What would make this photo ground truth

Its coordinates and view bearing, plus the names of a few summits in it. Then it becomes an
acceptance case, and the extractor has a target to be measured against rather than just a
demonstration that it fails.
