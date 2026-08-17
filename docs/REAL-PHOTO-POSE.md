# The first real annotated photograph — and what it says about the aligner

**2026-08-17.** The photographer supplied the camera originals of the Railroad Ridge frames.
The committed JPEG was a transcode; the originals' EXIF is intact. That single fact unblocked
everything below, and the result is the first photograph this repository has ever annotated
end to end with a flag on a named summit.

It also overturns two things I had recorded earlier the same day, and both corrections are here
rather than edited away.

## What the originals carry

Three frames, one position, one minute, three focal lengths — a controlled set nobody designed
and this repository could not previously have asked for.

| file | lens | hFOV | frame | `GPSImgDirection` |
|---|---|---|---|---|
| `railroad-ridge-48mm.heic` | 48 mm-eq (2× tele) | 41.11° | 4032 × 3024 | **174.089° T** |
| `railroad-ridge-24mm.heic` | 24 mm-eq (main) | 73.74° | 5712 × 4284 | 173.151° T |
| `railroad-ridge-14mm.heic` | 14 mm-eq (ultrawide) | 104.25° | 4032 × 3024 | 203.611° T |

All three: 44.139125 N, 114.595650 W, GPS altitude 3165.7 m, iPhone 15 Pro Max,
2024‑11‑09 15:10 −07:00. The 48 mm frame is the one committed as `tundra-blue-sky.jpeg`
— verified, not assumed: identical 4032 × 3024 and mean |ΔRGB| 1.03/255 over 36.6 M channel
samples.

**What the transcode dropped is exactly the GPS IFD.** The APP1 segment survives at 9 564 bytes
and the ICC Display‑P3 profile survives; position, altitude, heading and focal length are gone
together. A phone share sheet with "Include Location" off does precisely this, which is why
three of the six files supplied that day carry a lens and no position at all.

## The lens was the blocker, not the aligner

Every alignment run before this date assumed 26 mm-equivalent, hFOV 69.4°, because a stripped
JPEG names no focal length. The frame is 41.1°. That is a **1.69× error in image scale**, which
no amount of heading search can absorb.

Swept over the whole compass in 24 independent windows against the same 30 km SRTM profile:

```
                        windows producing an answer     lowest residual
wrong lens (26 mm-eq)          0 of 24                  2.03 deg
true  lens (48 mm-eq)          3 of 24                  1.11 deg  <- the window holding the truth
```

Under the true lens the window containing the heading is the only one that both survives its
gates and holds the lowest residual of all 24. Three windows score higher on raw NCC and every
one of them is rejected as `featureless-terrain-profile` — flat terrain, where the correlation
coefficient is meaningless.

## The photograph, annotated

```
npm run annotate -- fixtures/photos/real/tundra-blue-sky.jpeg \
  --exif fixtures/photos/real/railroad-ridge-48mm.heic \
  --peaks idaho-central --heading 174.686 --pitch -3.520
```

Nine summits are labelled by the pipeline; eight are outside the 41° frame; **Castle Peak,
3603 m at 11.07 km, bearing 176.411°, is in it** and its flag lands on the pyramid.

Two things on that image are worth separating:

- **The horizon line is SRTM.** It has never seen the photograph.
- **The marker is the peak database plus the projection.** Its height is OpenStreetMap's `ele`
  tag, never a DEM sample, so its position on the image is two unrelated data sources agreeing.

## Correction 1 — pitch, not roll, and EXIF has neither

At the EXIF pose the drawn horizon sits below the true skyline on the left of the frame and on
it at the right. My first reading of that was **roll** — one side high, the other low is the
classic signature. Measured, roll is worth almost nothing here:

```
heading x pitch, roll held at 0 (what align.ts does)   RMS residual  1.133 deg
heading x pitch x roll, roll searched -10..+10 deg     RMS residual  1.037 deg
```

An 8 % improvement is not a missing degree of freedom. The real term is **pitch**, which EXIF
does not record at all and which every run so far has silently assumed to be zero. The
photograph has a great deal of foreground tundra in it because the camera was pointed down.

## The pose, solved from the picture itself

Independent of both EXIF and the pipeline: Castle Peak's apex read off the full-resolution
image at **x ≈ 2178, y ≈ 973 px**. That is my reading of the picture — an agent looking at a
magnified crop with a labelled 50 px grid — and it is a judgement, not an instrument. It is
nonetheless the only measurement here that neither the magnetometer nor the aligner can have
influenced.

```
                       apex, from the image      pipeline at EXIF pose
horizontal from centre       +1.726 deg                +2.322 deg
vertical   from centre       +5.725 deg                +2.205 deg
```

Solving those two offsets:

```
true heading   174.686 deg
camera pitch    -3.520 deg   (pointed DOWN — hence all the tundra)
```

Rendered at that pose the marker lands at x = 2179, y = 974, one pixel from the apex, and the
horizon line follows the left crest, the notch and the right ridge.

## Correction 2 — the aligner's heading was BETTER than EXIF's

I recorded in `tests/acceptance/cases/railroad-ridge.ts` that the aligner "independently returns
174.893°, 0.804° away" from the EXIF heading, framing EXIF as the truth the aligner was
approaching. Against the photograph itself, that framing was wrong:

| source | heading | error vs the image |
|---|---|---|
| EXIF `GPSImgDirection` | 174.089° | **+0.596°** |
| `alignSkyline` recovered | 174.893° | **−0.207°** |

**The aligner was three times closer than the phone's magnetometer.** It reported
`low-confidence` while being right, which is the correct behaviour for an estimate whose margin
(0.031 against a 0.03 floor) genuinely was that thin — but the number it produced was good.

Its pitch was not: −1.552° recovered against −3.520° measured, an error of 1.97°. And that
error has a known cause pointing the right way. The extractor's documented remaining defect is
that ~40 columns near x ≈ 0.35–0.42 sit on the **snow/rock boundary part-way down the massif**
rather than on the crest above it. A skyline pulled *downward* in the image asks the fit for a
model horizon that is also lower, which is a pitch closer to zero — exactly the direction and
roughly the magnitude of the miss.

So the two halves of the CV stack fail differently and the distinction matters: the correlator
recovers heading well, and the extractor's residual bias lands almost entirely in pitch.

## What this changes

1. **The heading in the case file stays EXIF's**, not the aligner's and not the apex reading —
   a case may only assert what committed bytes carry, and the aligner's output can never become
   the ground truth it is graded against (CLAUDE.md rule 4). The apex measurement is recorded as
   an independent cross-check.
2. **Pitch is now a first-class unknown.** Nothing in EXIF supplies it, `--pitch` defaults to
   zero, and zero was the largest single error in the first render — 3.5° of it.
3. **The extractor's snow/rock columns are no longer a cosmetic residual.** They are the
   mechanism by which a good heading comes with a bad pitch.
4. **`npm run annotate` exists** and is the self-check for all of the above: it refuses without
   a position, a heading and a focal length, and it will not annotate a photograph whose frame
   disagrees with the `--exif` file it was handed.

## A real bug this shook out

`src/render/composite-page.html` built its backdrop data URL with
`String.fromCharCode(...new TextEncoder().encode(svg))` — one argument per byte. Every backdrop
until now was a small synthetic silhouette; the first real photograph blew the call stack at
4 MB. `composite.ts` had always done it with a loop, and the page carried a second copy that
did not. Fixed by deleting the copy, and the compositor now takes a photograph directly rather
than wrapping it in an SVG and base64-encoding it twice.
