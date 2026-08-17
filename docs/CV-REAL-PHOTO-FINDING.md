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

---

# The fix: a continuity constraint across columns

**2026-08-17.** The defect above is repaired. `extractSkyline` no longer picks a winner per
column; it scores **every** row of every column and then chooses the *path* through those scores
that maximises total step evidence minus a penalty for how fast the boundary moves. The
per-column step fit has not been improved — it has been demoted from "the answer" to "one term
in the answer", which is the only place the missing information could have come from.

## Reproduced first, at the same viewpoint

Everything below was re-measured in this environment before anything was changed, against the
same Railroad Ridge position (44.13900, −114.59569, SRTM reads 3166.1 m) and a 720-bearing,
30 km, 90 m-step SRTM sweep. Numbers differ in the last digit from the section above because
that run's exact assumed lens was not recorded; the conclusion is identical and the *alignment*
reproduced exactly — 12 windows, 12 refusals, and the same `no-correlation` 7 / `residual-
too-large` 4 / `ambiguous-correlation` 1 split.

```
photo skyline, per-column fit    −4.38° … 11.59°   SPAN 15.96°   (26 mm-eq, hFOV 69.4°)
terrain, entire 360°             −1.94° …  9.03°   SPAN 10.97°
most relief a 69.4° frame holds, over the whole compass:  8.80°  (at 030°; 8.64° at 000°)
```

## Before and after

```
                              coverage   mean conf   ALTITUDE SPAN
tundra, per-column fit          98.2 %      0.487       15.96°     ← impossible
tundra, continuous path         97.9 %      0.497        8.44°     ← inside 8.63°/8.80°
lookout, per-column fit          1.0 %      0.111          —
lookout, continuous path         2.9 %      0.132          —       ← still unreadable
```

**15.96° → 8.44°.** The extracted boundary now fits inside the relief the terrain can actually
present, with 0.2° to spare against the 8.63° figure quoted above and 0.36° against the 8.80°
this run measured. The remaining span is real: about forty columns near x ≈ 0.35–0.42 still sit
on the snow/rock boundary part-way down the massif rather than on the crest above it, and that
is stated here rather than tuned away.

The lookout photograph moved from 5 readable columns to 15, of 512. It is still, correctly,
unreadable: 2.9 % is an order of magnitude below the aligner's 25 % floor, so `alignSkyline`
still refuses it on coverage before correlating anything. A continuity constraint could very
easily have turned an unreadable photograph into a smooth, confident, entirely invented curve.
It did not, and there is now a test that says so.

## The penalty, and why it is a slope

The quantity the penalty is written in is **dα/dβ — degrees of altitude per degree of bearing**.
For a skyline at horizontal distance `d`, moving `dβ` along the crest covers ground `d·dβ` and
changes height by `dz`, and `α ≈ z/d`, so

```
dα/dβ = dz / (d · dβ) = tan θ / sin φ
```

with `θ` the ground slope along the crest and `φ` the angle between the crest line and the line
of sight. **The distance cancels** — a ridge 2 km away and one 20 km away with the same shape
present the same apparent slope — which is what makes this a property of terrain rather than of
the photograph.

It is also measurable without knowing the focal length. A rectilinear lens with square pixels
subtends the same angle per pixel vertically and horizontally, so at the frame centre
`dα/dβ = Δrow_px / Δx_px` exactly, with no focal length in it. Off axis the pixel slope
understates it by at most `sec(hFOV/2) − 1 ≈ 21 %` across a 69° frame.

- **Free below 5.** Ordinary mountain terrain reaches about θ = 40° (tan 0.84) before it stops
  being a slope and becomes a cliff; a crest running within about 10° of the line of sight
  divides that by sin 10° = 0.174, giving ≈ 4.8. Below that the boundary moves for nothing.
- **Linear above it**, one column of unambiguous step evidence per unit of excess slope. Linear
  and not quadratic on purpose: a linear penalty charges the same for a rise whether it is taken
  in one column or spread over ten, so **sharpness itself is never penalised** and a real cliff
  or an end-on arête stays possible. A quadratic penalty is a soft slope cap, and a slope cap is
  simply wrong about mountains.

What actually defeats the two-surface stitch is therefore not the jump alone. Leaving the
skyline and returning pays the excess twice *and* spends the crossing columns on rows that carry
no edge at all, so the detour has to out-earn its own dead columns. A genuine spire pays nothing:
every row of its flank is a real edge, and its slope is inside the free limit.

### The constants are not doing the work — measured

The tundra span was measured across more than two orders of magnitude of both constants:

```
penalty      0      0.01    0.03    0.05    0.1     0.3     1       3       10
span       16.08°  16.10°   8.44°   8.44°   8.44°   8.44°   8.44°   8.44°   8.44°

free slope   3       5       8      12          (penalty held at 1)
span       8.44°   8.44°   8.44°   8.44°
```

`penalty = 0` is the control: the same per-row evidence with the constraint switched off returns
16.08°, i.e. the defect. So the improvement is the continuity constraint and not the change of
per-column objective — and above a threshold of about 0.03 the answer stops depending on the
exchange rate at all. **No constant was moved to make a heading come out anywhere.**

## What the aligner does now, which is still refuse

Re-run over the same 12 heading windows, ±25° each, pitch searched over ±10°:

```
000°  residual-too-large           score  0.5730  margin 0.486  residual 1.96°
030°  search-range-exhausted       score  0.3742  margin 0.330  residual 3.21°
060°  no-correlation               score −0.0495  margin 0.170  residual 3.66°
090°  no-correlation               score  0.1235  margin 0.065  residual 2.34°
120°  no-correlation               score  0.2618  margin 0.032  residual 2.22°
150°  residual-too-large           score  0.5589  margin 0.315  residual 2.06°
180°  residual-too-large           score  0.5589  margin 0.533  residual 2.06°
210°  no-correlation               score −0.0138  margin 0.068  residual 3.15°
240°  no-correlation               score  0.0375  margin 0.013  residual 2.96°
270°  no-correlation               score  0.2106  margin 0.162  residual 2.50°
300°  search-range-exhausted       score  0.5544  margin 0.265  residual 2.26°
330°  featureless-terrain-profile  score  0.5632  margin 0.010  residual 2.26°
```

**Twelve windows, twelve refusals. That is the honest outcome and it is being reported as one.**

The correlation did improve — it was 0.0000 everywhere in the first run and reaches 0.573 now —
and it is still not an alignment. Scanning every heading on the compass at 0.5°, solving pitch at
each:

```
best anywhere            345.0°   score 0.5732   residual 1.96°
best in 150–250°         168.5°   score 0.5588   residual 2.07°
```

Two things say the same thing. First, the best heading on the entire compass beats the best one
inside the arc where the White Clouds demonstrably are — Castle Peak 176°, Mount Andrus 191°,
Lee Peak 213° — by **0.014 of NCC**, which is no separation at all: the landscape has no winner.
Second, at both of them the terrain sits about **2° RMS off** the extracted skyline, past the
1.5° the residual gate allows, so even the better one does not actually lie on the photograph.

345° is not a hypothesis. It points away from the range in the picture, it is tied with its
rivals, and the geometry rejects it independently. It is recorded here only so that nobody
re-derives it later and mistakes it for a result.

## What is left, stated as a limitation and not as a caveat

1. **About forty columns still follow the wrong surface.** Near x ≈ 0.35–0.42 the crest's own
   evidence is weak (0.07–0.26) while the snow/rock boundary 236 rows below it is strong
   (0.28–0.56), and the free slope lets the path reach it over six columns without paying. The
   span is physically possible now, but part of the curve is still not the skyline.
2. **A residual of ~2° is not obviously a heading problem.** It is roughly the size of the
   remaining extraction error, and it is also roughly what an unmodelled pitch, a crop, or a
   focal length off by a few millimetres would produce. Those are separate hypotheses and none of
   them has been tested here.
3. **The 30 km sweep may still be short.** Cause 4 from the previous section was never
   eliminated, only made unnecessary; it becomes relevant again now that the skyline is one
   surface.

The next measurement worth making is the one this document already recommended and which is now
finally worth doing: render the computed profile at 168° over the photograph and look at where
the two curves part company. With the extracted curve no longer self-contradictory, that
comparison can finally mean something.
