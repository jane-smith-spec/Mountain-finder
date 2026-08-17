# The phantom wall: terrain a DEM cannot resolve, deciding what you can see

**2026-08-17.** Chasing the pitch error in `alignSkyline` led somewhere else entirely. The
largest error source in the whole pipeline is not in `src/cv` — it is a horizon built out of
DEM cells 90 metres from the camera, and it very nearly hid a mountain that is plainly visible
in the photograph.

## What the pipeline believed

At the Railroad Ridge viewpoint, for the whole centre of the 41° frame:

```
bearing   horizonKm   altitudeDeg   elevM
   157        0.09        1.922      3173
   160        0.09        2.013      3173
   ...
   175        0.09        1.872      3173
   178       11.07        2.001      3565     <- Castle Peak's ridge
```

**154 of the 169 in-frame bearings had their horizon at 90 metres.** Across the full 360° sweep
it was 579 of 1440 bearings within 150 m, reaching 6.42°.

The DEM immediately around the camera explains it:

```
DEM at the camera: 3168.3 m      eye 3169.9 m

  range     bearing 150   165   180   195   210     max    angle from eye
  0.03 km            3170  3169  3167  3164  3161   3170      +0.95°
  0.06 km            3174  3172  3169  3164  3159   3174      +3.77°
  0.09 km            3173  3173  3171  3164  3156   3173      +2.00°
  0.15 km            3167  3168  3167  3160  3147   3168      −0.75°
```

The cells 60–90 m south read **three to four metres above the eye**. So the model puts a wall
right in front of the camera and reports it as the skyline for most of the view.

**The photograph proves this is false.** Castle Peak, 11 km away, is in the frame — its summit
is the pyramid the annotated render plants a flag on.

## Why the verdicts survived, and how narrowly

```
Castle Peak   11.07 km   bearing 176.411   alt 2.198°   skyline 2.133°   VISIBLE
```

It cleared the phantom by **0.065°**. A slightly different position, a metre of eye height, a
neighbouring DEM cell — any of them flips that to HIDDEN, and nothing in the output would have
said the number it was compared against was the sampling grid rather than a ridge.

That is the failure mode this repository keeps designing against: not a crash, not an obviously
silly answer, but a plausible number from a measurement that was never possible.

## Why it is not a bug in the DEM

A 30 m posting **smooths a ridge crest**. A point sampled exactly on a narrow crest reads lower
than the crest's true height, while cells to either side — sampling the broader shoulder — can
read higher. Add that the camera's own position is uncertain by a comparable distance (the
photographer's hand-read coordinate and the phone's GPS fix differ by 14.3 m here), and
"which is higher, me or the ground eighty metres away?" is simply not a question this data can
answer.

Finer sampling does not help, and that is the confirming test — 30 m, 15 m and 7.5 m range
steps all converge on the same answer, because the DEM's own posting is 30 m and there is no
more detail underneath:

```
range step   median residual against the photograph
     90 m         −1.158°
     30 m         −1.468°
     15 m         −1.468°     <- converged
    7.5 m         −1.485°
```

## What it was doing to the aligner

This is what the pitch investigation was actually chasing. Against the pose solved from the
photograph itself (heading 174.686°, pitch −3.520°):

```
                             heading error   pitch error
near field kept                   −3.51°        +1.15°
near field excluded (≥150 m)     −10.37°        +0.07°
```

**Pitch error falls by 16×** when the phantom is removed. The heading gets worse — because the
extractor's own defects and the terrain error were partly cancelling, which is worth knowing and
is not something either measurement alone would have shown.

Two further sensitivities, both alarming and both the same cause: the aligner's answer moves by
several degrees when the range step changes from 90 m to 30 m, and **2.3 m of assumed eye height
flips it between a usable answer and a refusal.** Nothing that depends on the near field this
strongly is measuring the mountains.

## The tension, stated rather than resolved

Excluding the near field is not a free win. `rangeIsMeasured` checks a sightline from **0** to
the summit, and correctly so: if you decline to measure the ground beside you, you cannot claim
to know whether it blocks the view. So:

```
--min-range-m 0      9 labelled,  9 visible, 33 occluded,  0 unmeasured   <- decided by a phantom
--min-range-m 150    0 labelled,  0 visible,  0 occluded, 42 unmeasured   <- honest, and useless
```

Neither is acceptable as a default. The first is confidently wrong; the second refuses
everything. **So nothing has been made the default, and no verdict in this repository has
moved.** What ships is:

- **`nearFieldHorizons`** — a report, on by default in `npm run annotate`, naming the bearings
  whose horizon rests on unresolvable ground and how high the phantom reaches. The artefact can
  no longer be invisible.
- **`SweepConfig.minRangeM`** — default 0, so behaviour is unchanged, available to a caller who
  wants the comparison and accepts the refusals that follow.

## The real fix, not attempted here

The near field should be neither trusted nor discarded but **carried with its uncertainty**. The
DEM's local relief within the camera's position uncertainty gives a band on the near horizon's
angle; a summit clearing that horizon by less than the band is `marginal`, not `visible`. Castle
Peak's 0.065° against a several-metre disagreement between adjacent cells is exactly a
`marginal`, and saying so is both honest and useful — which is more than either current option
manages.

That is a change to the visibility contract (`PeakVisibility` gains a state) and to every gate
built on it, so it is filed rather than rushed: TODO.md **P1.6**.
