# Adversarial review — Wave 1 gate (2026-08-16)

The review gate `PLAN.md` specifies between waves. Scope: `src/core`, `src/providers`
(minus `peak-store.ts`), `src/exif`, `fixtures/scenes`. `src/render` and `src/pipeline`
were mid-build and excluded.

Every finding below was **reproduced with a failing test against real code** before being
reported. Undemonstrated suspicions are listed separately and explicitly labelled.

## Confirmed findings

### 1. HIGH — a zero-distance ray sample turns a whole bearing into a +90° wall
`src/core/sightline.ts` · `altitudeAngleDeg` is `atan2(rise, distanceM)`. At `distanceM === 0`
that returns **+90°** for any sample above the eye. `sweepRay` has no guard, so it becomes the
running maximum and `buildHorizonProfile` writes it as both the skyline and the innermost
`skylineStep`. **Every peak on that bearing is then occluded by the ground under the
observer's own feet** — silently, with no error.

The trigger is mundane, not exotic: eye elevation is `groundElevationM + eyeHeightM`, where
`groundElevationM` comes from EXIF GPS altitude, which `src/exif/resolve.ts` itself documents
as "routinely tens of metres wrong". A 10 m disagreement suffices. And
`fixtures/scenes/scene.ts:generateRadialSamples` emits a range-0 sample as `samples[0]`, so a
pipeline built from the fixtures is *likely* to feed one.

| | skyline | Matterhorn clearance | verdict |
|---|---|---|---|
| with the range-0 self-sample | `+90°` | `−81.9°` | **hidden** ✗ |
| without it | `8.0839°` | `+9.3799°` | visible ✓ |

`sweepRay` already validates that samples are ordered near→far and *throws* if not, so it is
in the business of rejecting bad input — it just accepts `distanceM === 0` silently.

### 2. MEDIUM-HIGH — `conical-peak.ts` ground truth still encodes the superseded occlusion rule
`fixtures/scenes/conical-peak.ts` states an occluding angle of `8.479576` with
`clearanceDeg = 0` — the apex measured against *itself*, which is the pre-P1.5 "compare against
the skyline" rule. `twin-ridges.ts` was migrated when P1.5 was fixed; the cone was missed.
(At review time the field was named `skylineAltitudeDeg`; see "Decision taken".)

Under the corrected nearer-terrain rule the apex's occluder is the cone's own flank at 9750 m:

```
fixture                  8.479576   clearance 0.000000
pipeline                 7.978309   clearance 0.502983
independent closed form  7.976826
```

**Off by 0.503° — 50× the scene's own declared `toleranceDeg` of 0.01.** The pipeline agrees
with the independent closed form; the fixture is wrong. It passes today only because the
self-consistency check is `visible === (clearance >= 0)` and `0 >= 0` holds.

`MISSION.md` names this cone as the flagship yardstick, so this is the assertion Wave 2 hits
first — and the danger is that it gets "fixed" in `src/core`, re-introducing the P1.5 bug.

### 3. MEDIUM-LOW — profile merge discards a real occluder
`src/core/horizon.ts` · `normaliseHorizonProfile` keeps the higher-`altitudeDeg` point when two
share a bearing and discards the other **including its `skylineSteps`**. Correct for drawing a
skyline; unsound for occlusion, which needs the union of the staircases. Demonstrated: a peak
behind a near wall reads occluder `−1°` instead of `+4°` and gets **labelled** when it should be
hidden by 3°.

*Honest caveat from the reviewer:* not reachable through `buildHorizonProfile` alone — it bites
a caller that hand-merges or stitches profiles. `normaliseHorizonProfile` is exported.

### 4. LOW-MEDIUM — an out-of-range user override is silently replaced by EXIF
`src/exif/resolve.ts` · `inRange` returns `undefined` for an out-of-range value and `merge`
falls through to the EXIF layer, recording nothing. A user typing `475` for latitude (a
plausible fat-finger for `47.5`) gets a `complete: true` pose at the EXIF coordinate **165 km
away**, marked `source: 'exif'`.

This one matters disproportionately because *not inventing values* is the app's entire premise.

### 5. LOW — antimeridian read hole at longitude exactly 180
`tile-store.ts:normaliseLon` folds onto `[−180, 180)` and correctly names `W180`, but
`HgtTile.contains` compares raw `+180` against `westLon = −180 … eastLon = −179` and reports
`outside`. The provider names the right tile, has it loaded, and returns no data.
`src/core/geodesy.ts` folds onto `(−180, +180]` — **the two modules use opposite seam
conventions**, and `destinationPoint` can emit exactly `+180`. Ranked low because the result is
an honest `null`, not a wrong number.

## Clean bills of health (checked, found sound)

Recorded because "we looked hard and it holds" is real information:

- **Angle wrap** — 20 000 fuzzed inputs; `interpolateHorizonAltitudeDeg` matched an
  independently written wrap-aware brute-force bracketer on 400 profiles × 50 bearings to
  < 1e-9, exact at sample points to 1e-12.
- **Hemisphere / antimeridian / pole tile naming** — 16-case truth table, name→corner→name
  round-trips across all quadrants, 21 tiles across the antimeridian. `floor` vs `trunc`
  correct everywhere; `Math.floor(-0)` yields `N00`, not `S00`. (Except finding 5.)
- **Grid indexing / bilinear** — closed form reproduced to < 1e-6 m at 1681 interior points
  plus corners and edge midpoints. Row 0 = north confirmed against stored bytes.
- **No-data handling** — `−32768` never coerced to a number anywhere; **no** place defaults to
  `0` where 0 is a meaningful elevation; `toElevationSamples` forces an explicit policy.
- **Sign and unit confusion** — `elevationM`/`altitudeDeg` never cross; every producer and
  consumer traced. `vFov` divides *tangents*, not angles, in both implementations.
- **Projection** — 5000 random poses round-tripped through an independently written inverse,
  recovering bearing and altitude to < 1e-8°.
- **Geodesy** — round-trips < 1e-3 m and < 1e-6° including ±89.5° latitude and the antimeridian.
- **End-to-end vs ground truth** — `src/core` reproduces all four analytic scenes: 10/10 skyline
  expectations inside 0.01°, 5/5 peak verdicts correct, including the twin-ridges variant-A case
  the P1.5 fix exists for.
- **Tests are not circular** — spot-checked for expectations produced by the code under test;
  found none.

## Unverified suspicions (hypotheses, not findings)

1. Partial-coverage profiles may bridge a data gap linearly, producing a confident interpolated
   horizon where no terrain data exists — composing badly with `missingTilePolicy: 'no-data'`.
2. `method: 'nearest-valid'` is reported for readings that are exactly bilinear but merely have
   a void *neighbour*; a consumer filtering on `method` would discard good data.
3. `resolvePose` accepts a negative `eyeHeightM`, which would place the eye below terrain and
   invert every clearance. No path to it demonstrated.

## Decision taken

The reviewer asked whether to rename `skylineAltitudeDeg` → `occludingAltitudeDeg` before Wave 2
wires the hooks, or merely correct the cone's numbers.

**Decision: rename.** Findings 2 and 3 both stem from one field carrying two meanings across two
files after the P1.5 migration. A rename converts that silent semantic drift into a compile
error at every use site, which is exactly what we want and is cheap now and expensive later.

**Carried out, 2026-08-16.** The numbers were corrected first (TODO.md Q2); the rename followed
once it no longer collided with a live agent's surface:

- `ExpectedPeakVerdict.skylineAltitudeDeg` → **`occludingAltitudeDeg`** (`fixtures/scenes/`).
- `VisiblePeak.horizonAltitudeDeg` → **`occludingAltitudeDeg`** (`src/core/types.ts`). Included
  deliberately, though it widened the diff: it is the same field one layer down, and its doc
  comment already spent a paragraph insisting it was *not* the skyline angle. A name that has to
  be defended in prose is the exact condition that let finding 2 happen. The paragraph is gone.
- Nothing that genuinely means *skyline* was touched: `HorizonPoint.altitudeDeg`,
  `HorizonPoint.skylineSteps`, `ExpectedSkylinePoint`, `interpolateHorizonAltitudeDeg` and
  twin-ridges.ts's local `skylineAltitudeDeg` (which feeds `expectedSkyline`) are all maxima
  over *all* distances and keep their names. Renaming those would be the mirror image of the
  bug being fixed.

`tsc` located all 39 call sites; no expected value changed anywhere, and `check` (38 files /
746 tests), `test:acceptance` (148) and Playwright (13) are unchanged and green.
