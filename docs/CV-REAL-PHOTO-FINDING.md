# First contact with real photographs

> ## ⚠ Correction — the first version of this document was wrong
>
> It reported "**the extractor scores 0 of 512**" and diagnosed at length why. **That was my
> own bug, not the extractor's.** The probe filtered on `column.confidence` and `column.row`;
> the actual fields are **`confidence01`** and **`rowNorm`**. `undefined > 0` is `false`, so
> every column was discarded and the extractor was blamed for it.
>
> This is the second time in this project that I published a confident conclusion drawn from a
> buggy read — the first was "SRTM is full of voids", which was an out-of-bounds tile lookup.
> Both are exactly the failure this whole codebase is built to prevent: **a plausible number
> from a broken measurement is more dangerous than a crash.** Recorded rather than quietly
> edited, because the pattern matters more than either individual error.

**2026-08-17.** Two user-supplied photographs, the first real ones this project has ever had.

## The real result

| photo | coverage | mean confidence | verdict |
|---|---|---|---|
| **tundra** — blue sky, dark rock, 4032×3024 | **98.8 %** | 0.575 | **works** |
| **lookout** — snow, white haze, tower frame, 5712×4284 | **1.4 %** | 0.140 | **fails** |

On the tundra photo the extractor resolves **506 of 512 columns**, median confidence 0.571, and
places the skyline 29–36 % down the frame — which is where the peaks actually are. Confidence
rises left→right (0.407 → 0.712) exactly as the scene does: the left third is a smooth snowfield
against bright cloud, the right is dark rock against blue sky.

So the extractor is **not** unfit for real photographs. It is fit for *favourable* ones and
fails on hard ones, which is a completely different and much more useful conclusion.

## Why the lookout photo genuinely fails

These measurements stand — they were taken from the pixels, not through the buggy probe:

```
column   sky(35% down)   ridge(44%)   snow(75%)   step sky→ridge
x=55%        183             64          172        −118
x=95%        157            147          186          −9
```

1. **The vertical profile is bright → dark → bright.** Sky ~180, ridge ~110, snow back up to
   ~185 — brighter than the sky above it in four of six columns. `fitStep` searches for a split
   whose upper segment is brighter than its lower one; with a bright snowfield below, the best
   such split is not the skyline.
2. **The sky is desaturated white haze.** Saturation at x=55 %: sky **0.084**, ridge **0.526** —
   the ridge is six times more saturated. `skyAffinity` weights luminance *and blueness*, and
   white haze scores low on both relative to sunlit snow.
3. **Contrast collapses with distance:** −118 at x=55 % against −9 at x=95 %.
4. The lookout frame occupies the left ~25 % and is neither sky nor terrain.

`coverage01 = 0.014` is the extractor *correctly reporting that it could not read this photo*,
and `alignSkyline` then refuses with `insufficient-skyline` rather than returning an offset.
**The honest-failure path works.** That is the part that matters most.

## Status

- Aligner: proven to 0.013° against real SRTM terrain.
- Extractor: **measured at last** — good on favourable photographs, unable to read a
  snow-dominant hazy one, and honest about which is which.
- Snow-dominant scenes need a texture or gradient cue and a non-monotonic segmentation. That is
  real work, and now it has a real test case to be measured against.

## What these photos still need to become ground truth

EXIF did not survive the upload path — `Orientation` and dimensions only, no GPS, no
`GPSImgDirection`, no focal length. `src/exif`'s `needs-manual` model handles that correctly,
but it means each photo needs its **coordinates, view bearing, and a few summit names** supplied
separately before it can be an acceptance case rather than a demonstration.

---

# The first real end-to-end test: the aligner REFUSES

**2026-08-17.** With the Railroad Ridge position supplied and cross-checked (SRTM 3166.0 m =
10,387 ft, matching the road's known elevation), the full chain was run on a real photograph for
the first time.

```
terrain profile      720 bearings, 720/720 rays returned terrain
photo skyline        98.2% coverage, mean confidence 0.572
alignment            REFUSED in all 12 heading windows
                       no-correlation        7/12
                       residual-too-large    4/12
                       ambiguous-correlation 1/12
```

Focal length was not recoverable from EXIF, so it was swept as well — **13, 18, 22, 26, 30, 35
and 50 mm equivalent all produce a best score of 0.0000.** The refusal is not an optics guess
going wrong.

## What this does and does not show

**It is not a silent failure.** The aligner returned no offset, in every window, at every focal
length. Its refusal machinery — the part designed to stop a confident wrong heading from
labelling the wrong mountains — did exactly what it was built to do on the hardest input it has
ever seen. That is worth as much as a success would have been.

**But the system does not yet work end to end on a real photograph**, and that is the honest
headline. Proven to 0.013° against synthetic terrain, it cannot align a real one whose skyline
it reads at 98.2%.

## Candidate causes, none yet demonstrated

Listed as hypotheses, deliberately not as conclusions:

1. **The extracted boundary may not be the distant skyline.** The extractor places it 29–36%
   down the frame. That is where the peaks are — but a broad tundra foreground with a bright
   snow-patched surface may be producing a strong *nearer* edge that wins the step fit in many
   columns, so the shape being correlated is not the shape the terrain profile describes.
2. **Pitch.** A hand-held shot across a downhill foreground can carry several degrees of
   downward pitch; the search covered ±20°, but pitch interacts with the FOV assumption.
3. **Crop.** If the image was cropped, the optical centre moved and no focal length describes it.
4. **Profile range.** The sweep ran to 30 km. Ridges beyond that contribute skyline in this
   view and would be absent from the computed profile.

## What would settle it

Rendering the computed terrain profile at a plausible heading *over* the photograph, and looking
at the two curves side by side. If they are obviously different shapes, cause 1 or 4; if they
are the same shape at a different scale, cause 2 or 3. That is a small piece of work and it is
the correct next step — considerably better than continuing to sweep parameters, which is how
one ends up tuning until something agrees.

## The comparison, and it settles it: cause 1

Rather than eyeballing two curves, both were converted to the same units — altitude angle —
where the answer is unambiguous.

```
PHOTO skyline (490 confident columns)
  altitude range   −4.98° … 12.58°     SPAN 17.56°

TERRAIN profile (720 bearings, the whole 360°)
  altitude range   −1.94° …  9.04°     SPAN 10.97°

Terrain relief inside a 69° frame, by heading — the most any real view could show:
  000°  8.63°     150°  7.38°     240°  5.38°
  030°  4.08°     180°  7.40°     270°  5.28°
  060°  5.09°     210°  5.38°     300°  1.66°
```

**The extracted boundary spans 17.56° of altitude. The greatest relief any 69° frame could
contain from this viewpoint is 8.63°, and the entire 360° horizon spans only 10.97°.**

The photo's "skyline" therefore covers roughly **twice the vertical extent that a real skyline
can**, from anywhere on that ridge, in any direction. It cannot be one distant horizon.

This is decisive because **span is invariant to the two things we do not know**: an unmodelled
pitch shifts the whole range without changing its span, and a wrong focal length scales it
roughly uniformly. Neither can turn 8.63° into 17.56°.

So the extracted curve is **two different edges stitched together** — the distant White Clouds
skyline across part of the frame, and the near tundra ridge crossing the foreground in the rest.
Correlating that against a genuine horizon profile cannot succeed, which is exactly why every
window returned `no-correlation` rather than a plausible wrong heading.

**Hypothesis 1 confirmed; 2, 3 and 4 are not needed to explain the failure** (though pitch and
crop may still be present, they are not the cause).

## The actual defect

`fitStep` finds the best single sky-above-terrain split per column, independently. It has no
notion that the boundary it returns should be *continuous with its neighbours*, or that a
foreground ridge and a distant skyline are different surfaces. In a frame where a near ridge
rises across the lower half — the ordinary composition for a photograph taken while standing on
a broad ridge — some columns lock onto the far skyline and others onto the near edge, and the
per-column confidence stays high for both because each is individually a good step.

The fix is a continuity or segmentation constraint across columns, not a better per-column step
fit. `agreement01` already measures neighbour agreement and is *reported*, but it does not
constrain the choice.

That is a real piece of work, and it now has a real photograph to be measured against.
