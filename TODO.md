# TODO

## Queue (as of 2026-08-16)

**In flight — 4 agents, disjoint ownership:**

| # | Task | Owns | Delivers |
|---|---|---|---|
| 1 | Renderer | `src/render/`, `tests/e2e/render.spec.ts` | P4.1 SVG overlay (collision-avoided labels, XML escaping), P4.2 PNG export via Playwright Chromium |
| 2 | Pipeline | `src/pipeline/`, `peak-store.ts`, `fixtures/peaks/`, `scripts/demo.ts`, `pipeline-hooks.test.ts` | Offline peak DB, end-to-end orchestration, switches on Group F's 26 `it.todo` hooks, real `npm run demo` |
| 3 | Adversarial review | read-only + `tests/scratch/` | The review gate PLAN.md requires and we skipped. Must *demonstrate* each finding with a failing test — an undemonstrated finding is a hypothesis |
| 4 | Web app shell | `src/app/`, `tests/e2e/app.spec.ts`, `index.html` | P5.1 drop-zone + EXIF autofill + honest provenance panel + trim sliders, P5.2 export seam |

**Queued behind them, in order:**

- [ ] **Q1 — Integration.** Wire app ↔ pipeline ↔ renderer across the seams tasks 1/2/4 leave.
      Mechanical if the seams are honest; the first real test of whether they are.
- [~] **Q2 — Fix review findings** from task 3, by severity: silent-wrong-answer bugs first.
      Done (see REVIEW-FINDINGS.md for the numbering): 1 range-0 ray sample no longer walls off a
      bearing (`sweepRay` skips d = 0, throws on negative/NaN); 2 the cone fixture now states the
      nearer-terrain occluder (7.976826°, clearance 0.502750°) instead of measuring the apex
      against itself; 3 `normaliseHorizonProfile` merges the UNION of both staircases; 4 an
      out-of-range override surfaces as `needs-manual` / `'out-of-range'` and is never replaced by
      EXIF (lat, lon, eyeHeightM ≥ 0, hFov/vFov in (0,180)); 5 `HgtTile` compares longitude mod 360
      so lon +180 reads from `W180`; 6 a peak coinciding with a terrain sample is no longer its own
      occluder (`COINCIDENT_DISTANCE_TOLERANCE`).
      Still open: rename `skylineAltitudeDeg` → `occludingAltitudeDeg` across
      `fixtures/scenes` + `src/core` (deferred — it collides with two live agents' surface); the
      review's unverified suspicions 1 and 2 (gap bridging, `nearest-valid` reporting).
- [ ] **Q3 — The demo PNG.** `npm run demo -- gornergrat` producing an annotated image with
      flags on real summits. This is v2.0's whole point — the first artifact a human can look at
      and judge. Needs fetched tiles (`npm run fetch:tiles`), which is fine: acquisition, not runtime.
- [ ] **Q4 — v2.0 ship gate.** `check` + `test:e2e` + `test:acceptance` green, demo PNG inspected,
      and every high-confidence ground-truth case passing (or its failure understood, not silenced).

**Deferred by decision, not forgotten:** Phase 7 CV skyline alignment (v2.1, decision D3) and
Phase 8 live view (v3, decision D5). Neither starts before v2.0 ships.


Live checklist. Check items only after their self-check has been run and passed (see PLAN.md for each check's definition).

## Phase 0 — Scaffold ✅
- [x] P0.1 Vite 6 + React 18 + TS(strict, noUncheckedIndexedAccess) + vitest 3 + ESLint 9 + Playwright
- [x] P0.2 `check` / `test:e2e` / `test:acceptance` / `demo` scripts wired — all five commands verified green
- [x] `src/core/types.ts` frozen shared contract (separates `elevationM` from `altitudeDeg`)

## Phase 1 — Geometry core (group A) ✅ 178 tests
- [x] P1.1 Geodesy — 56 tests; meridian-convergence test rejects a rhumb-line impostor
- [x] P1.2 Sightline — 29 tests; analytic cone matches closed form to 1e-12 (spec asked 0.01°)
- [x] P1.3 Horizon profile — 35 tests; exact at samples, seam continuity across 359°→0°
- [x] P1.4 Camera projection — 29 tests; guards the tangent-vs-angle-linear mistake
- [x] P1.5 Visibility filter — 29 tests; occlusion by NEARER terrain only (see fix below)

## Phase 2 — Data providers (group B) ✅ 64 tests
- [x] P2.1 Transport layer — injected sleep, so backoff is asserted with zero wall-clock wait
- [x] P2.2 Elevation provider — batches of 100, request order verified, `null` no-data preserved
- [x] P2.3 Peaks provider — nodes + way centroids, `ele`/`ele:ft` parsing
- [~] P2.4 Fixture recorder — **self-check NOT met.** Recorder + offline `--verify` work, but the
      live APIs are blocked by this environment's egress policy (403 at proxy), so no live
      recording was possible. Fixtures are HAND-AUTHORED against documented schemas and
      labelled as such. Must be re-recorded once egress is allowed. See "Blocked" below.

## Phase 2b — Offline elevation from local SRTM tiles (D7) ✅ 108 tests
- [x] P2.5 HGT tile reader — `.hgt`/`.hgt.gz`, grid size from file length, bilinear + nearest.
      Voids are `null`, never a number; interpolation touching a void falls back to the
      highest-weight VALID corner (`method: 'nearest-valid'`), or returns `'void'` when all
      four corners are void. `voidPolicy: 'no-data'` opts into the strict rule.
- [x] P2.6 Tile store — `floor` naming verified across all four hemispheres, the antimeridian,
      the poles and exact integer degrees; directory loader with an LRU cache; gzip.
- [x] P2.7 Tile fetcher — `npm run fetch:tiles` from `elevation-tiles-prod/skadi`; validates the
      grid size before the file lands under its final name, so a truncated download cannot pass.
- [x] P2.8 Real-data fixtures — `fixtures/tiles/matterhorn-window` (N45E007) and `zermatt-window`
      (N46E007): real bytes + provenance sidecars, reproducible via `npm run fixtures:tiles`.
- [x] Verified against the real 25 MB tiles: Grand Combin 4287 m, Matterhorn 4230 m,
      N45E007 row 0 == N46E007 row 3600 on all 3601 shared-edge samples.
- **Correction to the briefing:** this mirror is **void-filled**. Zermatt (46.0207, 7.7491) reads
  **1608 m, not −32768**, and N45E007/N46E007/N27E086/N28E086 contain 0 voids in 51 868 804
  samples. The void code path is real and tested, but on SYNTHETIC tiles — no honest real
  fixture from this source can contain a void.

## Phase 2c — Offline peak database + the pipeline (D7) ✅ 62 tests
- [x] **P2.9 Local peak store** — `src/providers/peak-store.ts`: a committed JSON dataset
      (`fixtures/peaks/`) queried by radius or bbox, implementing the same `PeaksProvider`
      seam as the Overpass client, which is KEPT as the importer for when egress opens.
      Every coordinate and height copied from the cited ground-truth case files; the parser
      refuses a dataset whose citations do not resolve. Summit heights come from here and
      **never** from SRTM (Matterhorn 4478 m, not the tile's 4230 m, 320 m out of position).
- [x] **P2.10 Pipeline** — `src/pipeline/`: `annotateScene` (stated viewpoint) and
      `annotatePhoto` (EXIF + overrides, ground height filled from the terrain). Elevation
      source, peak source, tolerances and clock all injected; returns an `AnnotatedScene`
      (observer, horizon profile with staircases, peak verdicts, per-peak `ImagePoint`,
      named occluders, sweep report, warnings) — data, never pixels. Refuses rather than
      guesses: `observer-elevation-unknown`, `no-terrain`.
- [x] **Case terrain fixtures** — `fixtures/tiles/cases/*.i16be` + sidecars, cut byte-for-byte
      from real SRTM1 tiles by `npm run fixtures:case-tiles`. The acceptance suite is offline
      and does NOT read `data/tiles/`. Each window records what it can and cannot prove.
- [x] **Demo** — `npm run demo -- <case>` runs a case end to end and prints observer, horizon
      extent, visible peaks with bearings/altitudes/clearances, and occluded peaks with the
      terrain that hides them. PNG output still belongs to P4.2 (clean seam, stated in-script).

## Phase 3 — Photo ingestion (group C) ✅ 69 tests
- [x] P3.1 EXIF extraction — real JPEGs authored byte-wise; `GPSImgDirectionRef` honoured
- [x] P3.2 Fallback + override merge — 9 pose fields, each resolved or explicitly needs-manual

## Blocked on environment (not on code)
- [ ] Re-record `fixtures/api/**` from live OpenTopoData + Overpass once egress permits
- [ ] P6.2 real-viewpoint research needs reachable reference sources (Wikipedia also 403)

## Phase 4 — Renderer (group D) ✅ 97 tests + 2 e2e
- [x] P4.1 SVG overlay builder — pure `scene → string`. Horizon polyline sampled in bearing
      across 1.5× hFOV and Liang–Barsky-clipped to the frame; flag pole + summit dot + two-line
      label per visible peak; off-frame and behind-camera peaks reported, never drawn.
      Collision avoidance: left-to-right placement (ties by peak id, never input order), first
      free candidate from increasing pole lengths — up first, then down — `overlapped` flagged
      rather than dropping a summit. Levels can be *skipped*: poles are measured from their own
      summits, so a step of one label height clears a same-height neighbour but not always a
      lower one, and the search tests the real boxes. Geometric self-check met: the flag lands
      at 1600·(√3−1) = 1171.281 px / 524.820 px, hand-derived from the projection model, to
      better than 0.01 px against a ±0.5 % gate.
- [x] P4.2 PNG compositor — photo + overlay → PNG in Chromium via Playwright. **Zero new
      dependencies**: no `node-canvas`, so the export raster comes from the same engine the app
      renders in. Asserts the PNG signature, IHDR dimensions and size read from the bytes, and
      probes the raster — the pixel at the hand-computed summit is marker-coloured, control
      pixels are not. Artifacts: `out/render-composite.png`, `out/render-overlay.svg`.

## Phase 5 — Web app (group E)
- [ ] P5.1 App shell (drop-zone, autofill, overrides, trim sliders, test mode)
- [ ] P5.2 Annotated PNG export

## Phase 6 — Ground truth (group F) ✅ 112 assertions + 26 todo
- [x] P6.1 Analytic scenes — flat plane, twin ridges (2 variants), conical peak.
      `R_eff` derived symbolically = 7 322 998.62 m; each scene states its R and k.
- [x] P6.2 Real cases — Gornergrat, Mount Diablo, Kerry Park, Fort William.
      Sources read via web-search index (egress 403s wikipedia/parks.ca.gov/seattle.gov);
      every claim carries a resolvable source id + `access` field. Coordinates must be
      re-verified against live pages before these gate a release.
- [x] P6.3 Acceptance harness — green, with a banner stating a pass proves the yardstick
      is sound, NOT that the pipeline is correct. 26 pipeline assertions are `it.todo`.
- [~] **P6.3 hooks switched on — 25 of the 26 `it.todo`s are now real assertions** against
      the real pipeline, offline. 1 remains a `todo`: the SVG overlay hook, which waits on
      P4.1 (`src/render`, being built in parallel — writing that assertion before the module
      exists is the failure MISSION.md describes). Confidence policy respected exactly:
      `high` gates, `medium` reports, `disputed` informs. **One hard gate is FAILING and was
      left failing** — see below.

## Phase 4b — D8: obscured summits labelled, greyed (2026-08-16) ✅ +24 tests
- [x] **The rule, in `src/core/visibility.ts` (pure).** `classifyOcclusion` splits an
      occluded summit by WHAT hides it, using the topographic definition of one landform:
      walk the peak's own ray from the FIRST crest that out-angles it to the peak's own
      range, and if no sampled ground falls below that crest there is **no col**, so the
      blocker is a shoulder of the peak itself → `self-occluded` (labelled, greyed). A col
      → `foreground-occluded` (never drawn). Two refusals err the same way: a gap in the
      sampled record wide enough to hide a col, and a bearing whose nearest ray has no
      blocker at all, both report foreground occlusion for want of evidence.
      Deliberately NOT a distance ratio (unitless, and wrong for two ridges 15 km apart at
      85 and 100 km) and NOT an angular deficit (scales with how close the observer stands,
      not with whose hill it is). `colToleranceM` defaults to **0** — a col is a col.
- [x] **Threaded through `src/pipeline`.** `AnnotatedPeak.visibility` + `.occlusion`
      (evidence, crest, col depth); `AnnotatedScene.selfOccluded` / `.foregroundOccluded` /
      `.labelled`. `visible` and `clearanceDeg` are untouched — the split is of the losers.
- [x] **Rendered in `src/render`.** `OverlayPeak.visibility`; obscured markers get a dashed
      pole, a hollow summit ring, `· summit obscured` in the detail line and reduced opacity
      on the BRIGHT marks only — the halo stays full strength, proven in the exported raster
      (`tests/e2e/render.spec.ts`). Foreground-occluded peaks are refused a second time here.
- [x] **Surfaced in `src/app`.** "Label summits hidden behind their own hill", ON by default
      per the user's decision, its copy a tested pure function (`obscuredPeaksNote`) and its
      state carried to the pipeline in `OverlayRequest.showObscuredPeaks`. There is
      deliberately no switch for foreground-occluded peaks.
- [x] **Pinned by the three real cases** in `tests/acceptance/pipeline-hooks.test.ts`:
      Cow Hill self-occluded (col 0.0 m), Ben Nevis foreground (col 128.5 m over Glen Nevis),
      Mount Baker foreground. Acceptance semantics updated: a high-confidence must-see peak
      is satisfied by being LABELLED; a must-NOT-see peak must be absent from `labelled`
      entirely — **strictly stronger** than the old "not visible", which a greyed label
      would now satisfy.

## ⚠ Open findings from switching on the acceptance hooks (2026-08-16)
- [x] **fort-william: HIGH-confidence must-see "Cow Hill" comes out HIDDEN.** RESOLVED
      HONESTLY, without touching the visibility rule: the summit point is still hidden
      (clearance −0.356°) and is now LABELLED GREYED because the DEM shows the ground
      rising unbroken from the blocking crest (248 m at 0.84 km) to the summit — deepest
      col 0.0 m — while the hill dominates the skyline at +17.02°. The case file records
      the measured figures. The alternatives the finding offered (replace the coordinate,
      restate the expectation) were NOT needed and were not taken.

<details><summary>Original finding (kept for the record)</summary>

- [ ] **fort-william: HIGH-confidence must-see "Cow Hill" comes out HIDDEN.** Not weakened,
      not skipped. Diagnosis: the quoted coordinate (56.813052, −5.094644, from a walking-route
      aggregator — the case file already calls it the least authoritative position in the set)
      reads **261 m** in SRTM against the quoted 287 m, and the DEM's local maximum is
      **293.6 m some 476 m SSE of it**. Along bearing 139.45° the ground crests at 840–900 m
      range and subtends **15.81°**, while the quoted summit point subtends 15.60° at 990 m —
      so the marked point sits just BEHIND the crest of its own hill. That is also true of the
      DEM's own local max from this viewpoint: standing at the foot of a smooth convex hill,
      the shoulder hides the summit. The case's claim ("the hill immediately behind the town")
      is about seeing the HILL — which dominates the computed skyline at +17.0° — not about
      its summit point clearing the foreground. Decide one of: replace the coordinate with the
      Ordnance Survey grid reference, or restate the expectation as "Cow Hill's mass forms the
      skyline at this bearing". Do NOT relax the visibility rule to fix it.

</details>
- [ ] **kerry-park-seattle: the Mount Baker gate is NOT insensitive to the observer height**,
      contrary to that case file's header. SRTM reads Kerry Park at **103.8 m**; the case cites
      an estimated 113 ± 15 m. With the DEM value Baker is correctly HIDDEN (clearance −1.67°);
      with the cited 113 m it comes out VISIBLE (+0.31°) and the gate fails. The verdict flips
      INSIDE the case's own stated uncertainty band. The suite therefore takes the observer's
      ground height from the DEM (which that case file itself recommends) and reports the
      comparison. Worth a note in the case file.
- [ ] **Occluding-angle report is unreliable at an exact tie (both twin-ridges scenes).** A
      summit normally IS the terrain sample at its own range; `src/core` excludes terrain at
      exactly the peak's distance (strict `<`) so a peak cannot hide itself, but the peak's
      range comes from a haversine and the sample's from the requested step, so the two differ
      in the last bits and the tie-break is luck. When the sample counts, `horizonAltitudeDeg`
      becomes the peak's own angle and `clearanceDeg` collapses to ~0 (twin-ridges near-crest:
      4.554485° reported vs 3.590173° expected). **The verdict is unaffected** — an equal angle
      still clears — so the gates stand, but any UI sorting or thresholding on `clearanceDeg`
      would be misled. Suggested fix (src/core, not touched here): compare distances with an
      explicit epsilon, or have the sighting carry the sample it coincides with.
      All three scene peaks that sit on a sampled range show it, the corrected conical-peak
      fixture included: apex expected 7.976826 deg (its own flank one sample in), pipeline
      reports 8.481293 deg — the apex measured against ITSELF. The acceptance suite prints
      every instance under "REPORT-ONLY AND INFORMATIONAL OUTPUT" rather than gating on it,
      because the visible/hidden verdicts are unaffected.

## ✅ Correctness bug found by Group F — FIXED
- [x] **P1.5 over-occluded near peaks.** Fixed: a peak is now occluded only by terrain with
      distance strictly `<` the peak's own. `HorizonPoint.skylineSteps` (additive, optional)
      carries the per-bearing running-maximum staircase; `interpolateNearerTerrainAltitudeDeg`
      answers "how high does terrain reach nearer than this?" using the *same* bearing
      bracket and weight as the skyline query, seam included.
      Core tests 151 → 178. Acceptance 112 → 116. No existing test needed changing — none had
      encoded the old rule, because every hand-built fixture peak already sat behind its occluder.
      Group F's `expect(nearVerdict).toBeUndefined()` is now
      `expect(nearVerdict?.visible).toBe(true)`, and the test still asserts the crest sits 0.79°
      *below* the skyline — proving the fix, not hiding the difficulty.
      Two judgment calls recorded: strict `<` at the boundary (a summit *is* the sample at its
      own distance, so `<=` would make every peak hide itself and leave the verdict to
      floating-point luck); and a mixed bracket returns the real occluder rather than
      interpolating toward an invented floor.
- [x] **Gate verification (independent of the fixing agent).** A throwaway suite was written
      against a hand-built two-step profile (+2° at 5 km, taller +8° at 20 km), run, and
      discarded. It confirmed all four directions, which matters because the danger in fixing
      over-occlusion is over-correcting into a filter that shows everything:
      near peak +4° @10 km in front of the far ridge → **visible** (the original bug);
      far peak +4° @30 km behind it → **hidden** (not permissive);
      peak nearer than all terrain → −90° nadir, nothing can occlude it;
      terrain at exactly the peak's range → does not occlude (no self-occlusion).

<details><summary>Original bug description (kept for the record)</summary>

- **P1.5 over-occludes near peaks.** The rule compares a peak against the max terrain
      angle at its bearing across *all* distances. But terrain BEHIND a peak cannot hide it.
      A nearer, lower summit standing in front of a taller far ridge is genuinely visible,
      and the current rule calls it hidden.
      Correct rule: a peak is occluded only by terrain NEARER than the peak itself.
      Fix: retain the per-bearing skyline staircase (distance → running max altitude) so the
      test can ask "max altitude among samples closer than this peak".
      `HorizonPoint` already carries `distanceKm`, but only for the single winning sample.
      Group F asserts *no verdict* on this case so the simplification cannot be silently
      blessed; promote that assertion once fixed.

</details>

## Gates
- [ ] Wave 1 review (A, B, C, F diffs adversarially reviewed)
- [ ] Wave 2 review (D)
- [ ] Wave 3 review (E) — `npm run test:e2e` green
- [ ] **v2.0 ship gate:** all global checks green, demo PNG produced and inspected

## Later
- [ ] Phase 7 — CV silhouette alignment (v2.1)
- [ ] Phase 8 — Live view mobile app (v3)

## Done
- [x] v1 Expo attempt archived to `archive/v1-expo/` (2026-08-16)
- [x] Mission docs written (MISSION.md, PLAN.md, TODO.md, CLAUDE.md)
