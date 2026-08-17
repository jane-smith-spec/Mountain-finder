# TODO

Live checklist. Check an item only after its self-check has been run and passed —
[PLAN.md](PLAN.md) defines every check and carries the phase-by-phase status.
Every confirmed finding is indexed in [docs/FINDINGS.md](docs/FINDINGS.md); the detailed
write-ups are in the three `REVIEW-FINDINGS*.md` files and are not repeated here.

**Where the project stands** is stated once, in [README.md](README.md#status-honestly).

---

## Open

| # | Item | What it needs |
|---|---|---|
| **Q8** | Switch the app to the 8 528-summit dataset | One file. `src/app/main.tsx` imports `fixtures/peaks/ground-truth-peaks.json` (15 cited summits) and hands `groundTruthPeakStore` to `createOverlayBuilder`; the Overture regions are already staged at `/peaks/<region>/index.json` + `cells/N45E007.json` in exactly the layout `TiledPeakStore` expects, and `npm run test:deploy` already proves they are served. Two things move in the same commit: `peakDataReadByThisBuild` in `src/app/data-credits.ts` (`'bundled'` → `'regions'`, or the footer keeps saying "not read by this build yet"), and `verifyPeaksAreBundled` in `scripts/package-deploy.ts`, which deliberately **fails** the day the summit name leaves the bundle. Expect the density findings to bite: `Breithorn` is ambiguous (four in the Valais), one mountain arrives as a cluster (Matterhorn 4 nodes, Rainier 8), and California alone repeats 306 names |
| **Q9** | Re-measure the DEPLOY.md size table | "What it costs" predates the four committed regions and the attribution footer. It has **no row for `/peaks/`** at all (3.2 MB staged — california 1.26, cascades 1.02, zermatt 0.67, fort-william 0.26 MB), and nothing states what one *session* costs once the app fetches cells rather than bundling them — which is the number a deployer budgets with. The bundle figure was 302 KB and is now 318.40 kB / 104.34 kB gzipped; the windows-only demo row moved 1.77 → 1.78 MB. Those two were measured; the `/peaks/` row only means something after Q8 |
| **P7.4** | CV integration — deliberately not done | Seam is `src/pipeline/cv-alignment.ts`, exported from nothing and imported by nothing. Pre-set the P5.1 trim sliders rather than replace them: an automatic correction the user cannot see or undo is worse than a manual one. Blocked behind P7.5 — there is no point wiring in an extractor that stitches two edges together. See `src/cv/README.md` |
| **P7.5** | The extractor on real photographs | **Narrowed from "it stitches edges together" to one measurable bias.** The continuity constraint fixed the span (15.96° → 8.44°, ceiling 8.80°). What is left is that ~40 columns near x ≈ 0.35–0.42 sit on the snow/rock boundary *below* the crest, and that bias is now shown to land almost entirely in **pitch**: against a photogrammetrically solved pose the aligner recovers heading to 0.207° and pitch to only 1.97°, in the direction a downward-pulled skyline predicts ([CV-6](docs/FINDINGS.md), [docs/REAL-PHOTO-POSE.md](docs/REAL-PHOTO-POSE.md)). Roll was tested and is not the missing term (±10° of roll buys 1.133° → 1.037°). Snow-dominant hazy scenes still need a texture or gradient cue ([CV-2](docs/FINDINGS.md)) |
| **P7.6** | The two wide Railroad Ridge frames refuse | Same viewpoint, same minute, 24 mm-eq and 14 mm-eq. Both fail alignment badly — residual **12.9°** and **9.8°** against the 48 mm frame's 1.11° — and the likely cause is testable: a wide frame's sky boundary near its edges is FOREGROUND tens of metres away, which a sweep starting at 90 m never sampled. If that is it, the fix is a near-field term or an edge mask, not a better extractor. Nothing in the case file derives from these two yet |
| **X-4** | Kerry Park: the Mount Baker gate is not observer-height-insensitive | The verdict flips inside the case file's own stated uncertainty band — DEM 103.8 m → hidden (−1.67°), cited 113 ± 15 m → visible (+0.31°). The suite takes the ground height from the DEM and reports the comparison; the case file still wants the note |
| **X-5** | Occluding-angle report at an exact tie | **The record disagrees with itself**: Q2 below lists this fixed via `COINCIDENT_DISTANCE_TOLERANCE` (present at `src/core/horizon.ts:369`), and it was also carried as an open finding. Verdicts are unaffected either way — an equal angle still clears — but UI sorting or thresholding on `clearanceDeg` would be misled. Resolve which record is right before anything depends on `clearanceDeg` |
| **R-1…R-4** | Residuals the reviews left open by decision | Peaks outside a bounded sweep still judged against the bridged complement; `src/cv/rays.ts:profileCoverage` duplicates the coverage notion with a largest-gap heuristic; `'nearest-valid'` is discontinuous at a grid line (a policy decision, not a bug); `scripts/terrain-server.ts` should use `datasetLabelForStepDeg`. Detail in [docs/FINDINGS.md](docs/FINDINGS.md#residuals-left-open-by-the-reviews) |
| **Phase 8** | Live view (v3) | Not started, by decision D5 — after v2.1. Products and self-checks are in [PLAN.md](PLAN.md) |

## Blocked on the environment, not on code

| # | Item | Blocker |
|---|---|---|
| **P2.4** | Re-record `fixtures/api/**` from live OpenTopoData + Overpass | Egress 403s both at the proxy. The recorder and its offline `--verify` work; the fixtures are **hand-authored against documented schemas and labelled as such**. The elevation fixtures are superseded anyway (real SRTM bytes from AWS are better evidence than recorded JSON) — but the Overpass recording genuinely never happened. Recorded `[~]`, never ticked |
| **P6.2** | Real-viewpoint research against reachable reference sources | Wikipedia, parks.ca.gov and seattle.gov all 403. The four case files' coordinates carry resolvable source ids and an `access` field, and must be re-verified against live pages before they gate a release |
| **X-6** | Turn the two real photographs into acceptance cases | **Half done, and it was never an environment blocker.** The upload path stripped the GPS IFD from the JPEGs; the CAMERA ORIGINALS still had everything, and asking for them was all it took. Railroad Ridge now has a measured heading (174.089° T), a GPS fix, an altitude and a lens, re-read from committed HEIC bytes by the suite, and `npm run annotate` puts a flag on Castle Peak's summit. Sunset Mountain (IMG_0592) still has no original — **that one file would finish this item.** See [docs/REAL-PHOTO-POSE.md](docs/REAL-PHOTO-POSE.md) |

---

## Done

### v2.0 ship gate — MET 2026-08-16

Every gate verified at the coordinator, not taken from an agent's report.

| Gate | Result |
|---|---|
| `npm run check` | 38 files, **746 tests** ✅ |
| `npm run test:acceptance` | **148 passed, 0 todo, 0 failing** ✅ |
| `npx playwright test` | **13 e2e** ✅ |
| `npm run build` | production bundle ✅ |
| Demo artifact | produced, **opened and inspected**, committed to `docs/artifacts/` ✅ |
| High-confidence ground truth | all passing, incl. Cow Hill now passing *honestly* ✅ |

**Two things v2.0 shipped with, stated rather than buried:** P2.4's self-check is unmet (above),
and **peak coverage was the binding constraint, not the code** — the bundled database held three
alpine summits, which is why the first demo showed one label rather than a skyline of them.
Everything downstream of the database was finished and tested. Q5 fixed the database.

After Q6 (attribution) the gates read: `check` **50 files / 1 025 tests**,
`test:acceptance` **153**, Playwright **21**, `test:deploy` **5**.

### Review gates

| Gate | Evidence |
|---|---|
| Wave 1 review | [REVIEW-FINDINGS.md](REVIEW-FINDINGS.md) — `src/core`, `src/providers`, `src/exif`, `fixtures/scenes` |
| Wave 2 review | [REVIEW-FINDINGS-2.md](REVIEW-FINDINGS-2.md) — `src/pipeline`, `src/app`, `src/core/visibility.ts`, `tests/acceptance`, plus 12 mutations |
| Wave 3 review | [REVIEW-FINDINGS-3.md](REVIEW-FINDINGS-3.md) — `src/providers`, plus 39 mutations |

The three review documents do not map one-to-one onto the original A/D/E wave labels — the
scopes were re-cut as the code moved. Recorded rather than renumbered.

### Findings fixed

Full write-ups and ids in [docs/FINDINGS.md](docs/FINDINGS.md). What landed, with the figure
that proves it:

- **Q2 — Wave 1 findings.** W1-1 `sweepRay` skips `d = 0` and throws on negative/NaN · W1-2 the
  cone fixture states the nearer-terrain occluder (7.976826°, clearance 0.502750°) instead of
  the apex against itself · W1-3 `normaliseHorizonProfile` merges the **union** of both
  staircases · W1-4 an out-of-range override surfaces as `needs-manual` / `'out-of-range'` and
  is never replaced by EXIF (lat, lon, `eyeHeightM ≥ 0`, hFov/vFov in (0,180)) · W1-5 `HgtTile`
  compares longitude mod 360, so lon +180 reads from `W180` · a peak coinciding with a terrain
  sample is no longer its own occluder (`COINCIDENT_DISTANCE_TOLERANCE` — but see X-5 above,
  which the same file also carried as open) · W1-6 `horizonCoverage` + `hasTerrainAtBearing`
  (pure) refuse a bearing whose bracketing pair has a lost ray between them, and such a peak
  reaches **no verdict**: it goes to `AnnotatedScene.unmeasured`. A bounded sweep is not a hole,
  and the distinction is exact rather than a gap-width heuristic. All four ground-truth cases
  lose no rays, so 148/148 verdicts were unchanged · W1-7 `HgtTile.bilinear` sums the void
  corners' **weights** instead of setting a flag; below `NEGLIGIBLE_VOID_WEIGHT` ≈ 3.05e-8 the
  reading is `'bilinear'` under both policies. Void semantics untouched — voids stay `null` and
  are never averaged in.
- **The deferred rename, no behaviour change.** `ExpectedPeakVerdict.skylineAltitudeDeg` and
  `VisiblePeak.horizonAltitudeDeg` → **`.occludingAltitudeDeg`**, both meaning "highest angle
  reached by terrain NEARER than the peak". The second carried the identical misnomer one layer
  down and its doc comment had to spend a paragraph insisting it was not the skyline — a name
  that has to be defended in prose is the exact condition that let W1-2 happen. Genuine skylines
  keep their names (`HorizonPoint.altitudeDeg`, `.skylineSteps`, `ExpectedSkylinePoint`,
  `interpolateHorizonAltitudeDeg`, twin-ridges' local `skylineAltitudeDeg`). `tsc` located all
  39 call sites; every expected value is byte-identical.
- **Q2b — Wave 2 findings**, in the review's own order, each with a test watched failing first.
  W2-1 the crest is now the highest-angle nearer sample; the review's terrain reads
  `colDepthM 400` and `foreground-occluded`, and **no ground-truth verdict moved** — Cow Hill is
  still self-occluded with col 0, Ben Nevis still foreground-occluded, its col now 216.1 m below
  a 232 m crest instead of 128.5 m below a 144 m one. One unit fixture had to be rebuilt: the
  `colToleranceM` test put its 6 m dip *behind* the skyline-forming sample · W2-2
  `rangeIsMeasured` keys on terrain **measured**, not on the configured range, so a ray
  truncated by missing tiles is refused on the same footing as one truncated by `maxRangeKm`;
  `judgeBeyondMeasuredTerrain` (default false) is how a caller with a deliberately truncated
  sweep declares it, and the two acceptance cases whose windows are 3–5 km against 60–292 km
  sightlines set it, while Gornergrat and Fort William leave it off — so the refusing default is
  gated end to end by real viewpoints · W2-3 `extract.ts` reads `Orientation` (nothing in `src/`
  did), reports **displayed** dimensions, and gives the 36 mm angle to the longer displayed
  axis; new fixture `fixtures/photos/portrait-orientation-6.jpg`, and the test that **pinned the
  bug** now states 30.219150 instead of 39.597753 and says in the test why it changed. The
  long-side vs diagonal reading of `FocalLengthIn35mmFormat` is a convention — they agree
  exactly at 3:2 and differ by ~1° at 4:3 — and `fov.ts` states the choice, the alternative and
  the cost · W2-G1 Ben Nevis promoted `medium` → `high` · W2-G2 the first horizontal-placement
  assertions in the suite, at Δ = ±20° off the optical axis from the rectilinear closed form.
  Acceptance **153** (was 148; none weakened, 5 added).
- **Wave 3 findings.** W3-3 `TiledPeakStore.coverageFor` answers from the index alone — bounds,
  cells spanned vs held, and `coveredRadiusKm` from `R·|Δφ|` and `R·asin(sin Δλ · cos φ)`;
  Zermatt + 200 km reports complete=false, 24 spanned / 4 held, covered to 32.2 km, which is the
  radius at which Mont Blanc's absence stops being evidence · W3-G1 the whole-world bbox
  fallback is pinned, verified to fail against the inverted implementation that all 293 previous
  tests passed · W3-G2 `slice(100, 200)` must send `bytes=100-199` · W3-1 `lonWidthDeg` measures
  from the raw bounds, and `fetch:tiles --around 89,10 --radius-km 200` went from 3 tiles on
  W170 (not including the one underfoot) to 1080 = 3 bands × 360 · W3-2 `withinBox` and
  `tileNamesForBounds` now share `lonWithinBounds` · W3-4 `datasetLabelForStepDeg`.
  Suspicions closed: sidecar steps must be positive and rows/cols integers ≥ 2;
  `resolveTerrainUrl` refuses `//host/x`; `recordsWithin` breaks distance ties on the peak id.

### Phases

- **Phase 0 — Scaffold.** Vite 6 + React 18 + TS (strict, `noUncheckedIndexedAccess`) + vitest 3
  + ESLint 9 + Playwright; all five commands verified green. `src/core/types.ts` is the frozen
  shared contract, separating `elevationM` from `altitudeDeg`.
- **Phase 1 — Geometry core, 178 tests.** Geodesy (a meridian-convergence test rejects a
  rhumb-line impostor) · sightline (the analytic cone matches closed form to 1e-12 against a
  0.01° spec) · horizon profile (exact at samples, seam-continuous across 359°→0°) · projection
  (guards the tangent-vs-angle-linear mistake) · visibility (occlusion by **nearer** terrain
  only — see X-2 below).
- **Phase 2 — Data providers, 64 tests.** Transport with injected sleep, so backoff is asserted
  with zero wall-clock wait · elevation provider batching 100 with request order verified and
  `null` no-data preserved · Overpass peaks with `ele`/`ele:ft` parsing. **P2.4 unmet**, above.
- **Phase 2b — SRTM tiles (D7), 108 tests.** `.hgt`/`.hgt.gz`, grid size from file length,
  bilinear + nearest; voids are `null`, never a number. `floor` naming verified across all four
  hemispheres, the antimeridian, the poles and exact integer degrees. `fetch:tiles` validates
  grid size before the file lands under its final name, so a truncated download cannot pass.
  Real-bytes fixtures for N45E007 and N46E007, reproducible via `npm run fixtures:tiles`.
  Verified against the real 25 MB tiles: Grand Combin 4287 m, Matterhorn 4230 m, and
  **N45E007 row 0 == N46E007 row 3600 on all 3601 shared-edge samples**.
- **Phase 2c — Peak store + pipeline, 62 tests.** `peak-store.ts` implements the same
  `PeaksProvider` seam as the Overpass client, which is **kept** as the importer for when egress
  opens; every coordinate and height is copied from the cited case files and the parser refuses
  a dataset whose citations do not resolve. Summit heights come from there and **never** from
  SRTM (Matterhorn 4478 m, not the tile's 4230 m, 320 m out of position). `annotateScene` and
  `annotatePhoto` return data, never pixels, and refuse rather than guess
  (`observer-elevation-unknown`, `no-terrain`). Case terrain windows are cut byte-for-byte from
  real tiles, so the acceptance suite is offline and does not read `data/tiles/`.
- **Phase 3 — Photo ingestion, 69 tests.** Real JPEGs authored byte-wise; `GPSImgDirectionRef`
  honoured; nine pose fields each resolved or explicitly `needs-manual`.
- **Phase 4 — Renderer, 97 tests + 2 e2e.** Pure `scene → string`. Horizon polyline sampled in
  bearing across 1.5× hFOV and Liang–Barsky-clipped; off-frame and behind-camera peaks reported,
  never drawn. Collision avoidance places left-to-right (ties by peak id, never input order) and
  can *skip* levels, because poles are measured from their own summits; an overlap is **flagged,
  not dropped**. Geometric self-check met: the flag lands at 1600·(√3−1) = 1171.281 px /
  524.820 px, hand-derived, to better than 0.01 px against a ±0.5 % gate. PNG export composites
  in Chromium via Playwright with **zero new dependencies**, and probes the raster — the pixel
  at the hand-computed summit is marker-coloured, control pixels are not.
- **Phase 4b — D8, obscured summits labelled and greyed, +24 tests.** `classifyOcclusion` splits
  an occluded summit by **what** hides it: walk the peak's own ray from the crest to the peak's
  range, and if no sampled ground falls below that crest there is **no col**, so the blocker is a
  shoulder of the peak itself → `self-occluded`, labelled greyed. A col → `foreground-occluded`,
  never drawn. Deliberately not a distance ratio (unitless, and wrong for two ridges 15 km apart
  at 85 and 100 km) and not an angular deficit (scales with how close the observer stands).
  `colToleranceM` defaults to **0** — a col is a col. Two refusals err the same way: a gap in the
  record wide enough to hide a col, and a bearing whose nearest ray has no blocker at all.
  Threaded through the pipeline, drawn with a dashed pole and hollow ring, and surfaced in the
  app as a switch that is ON by default per the user's decision. There is deliberately **no**
  switch for foreground-occluded peaks.
- **Phase 5 — Web app.** Drop-zone → EXIF autofill → honest provenance panel → trim sliders →
  real overlay: the Gornergrat fixture photo is driven through the whole chain in Chromium and
  the Matterhorn flag lands within 12 px of the hand-derived 600.37, 315.48 px. A photo with no
  terrain (Chamonix, needs N45E006) shows the **named absence** instead. Export asserted from
  the PNG's own IHDR bytes at the photo's 1200×900.
- **Phase 6 — Ground truth, 153 assertions, 0 todo.** Four analytic scenes with independently
  derived expectations (`R_eff` derived symbolically = 7 322 998.62 m; each scene states its R
  and k) and four real cases (Gornergrat, Mount Diablo, Kerry Park, Fort William) with
  resolvable source ids. The harness banner states that a pass proves the **yardstick** is
  sound, not that the pipeline is correct. A 0.35° heading error fails the overlay assertion,
  which was checked rather than assumed. Confidence policy respected exactly: `high` gates,
  `medium` reports, `disputed` informs.
- **Phase 9 — Peak coverage from Overture Maps, +63 tests.** `npm run fetch:peaks -- --region
  zermatt` imported **1 786 named summits** (61 above 4 000 m) for **42.17 MB of a 29.47 GB
  release — 0.1431 %**; 10.77 MB with the footer cache warm. Six of thirteen columns are read,
  because `geometry` is ~96 % of the bytes. **P9.4's open question is answered: Overture does
  carry summit heights** — the `elevation` INT32 column is OSM's `ele` carried through unchanged,
  checked row-by-row against the same rows' `source_tags.ele` (Matterhorn `"4478"` → 4478,
  Weisshorn `"4505"` → 4505) — so records declare `elevationSourceKind: 'osm'` and **nothing is
  ever sampled from the DEM**: a summit with no `ele` is dropped and counted (285 in the Zermatt
  area). A box over the Southern Alps of New Zealand prunes all 128 groups of the European part
  to zero. Conflicts are **reported, not resolved**: 13 of 15 cited heights agree exactly or
  within 2 m, Mount Hamilton is −21 m, **Mount Tamalpais East Peak's two coordinates are 1 754 m
  apart** and must be re-checked before that summit backs any assertion, and `Breithorn` is
  ambiguous — OSM calls the cited 4 164 m summit `Breithorn Occidentale / Westgipfel` and the
  Valais holds three others. Table in `fixtures/peaks/README.md`.
  *Why Parquet-over-Range and not a bulk download:* every other peak source is blocked from here
  — `download.geonames.org`, geofabrik, naturalearthdata, `planet.openstreetmap.org` and taginfo
  all fail at the proxy, Overpass 403s — **but `s3.amazonaws.com` is reachable**, and both
  `osm-pds` and the Overture distribution list from it. Parts are ~800 MB each, so range-reading
  only the row groups a bounding box touches is both feasible and the correct shape: an
  acquisition step that writes a local dataset, never a runtime dependency, exactly like
  `fetch:tiles`.
- **Phase 10 — Deployment, self-check `npm run test:deploy`, 5 assertions.**
  `npm run package:deploy [-- --gzip]` stages `dist/terrain/` and `dist/peaks/<region>/` through
  the **same index builder the dev server uses**, and refuses a grid whose byte length disagrees
  with the geometry the index claims. The proof runs the built `dist/` behind a plain static
  server with **no Vite in the process**: manifest byte-identical to the packaged file, no
  `/@vite/client`, the Matterhorn within 12 px of the closed-form projection, a 25 934 402-byte
  tile arriving as 16 345 818 bytes and still passing the store's length check, **every request
  same-origin** (D7 enforced), and a viewpoint with no tile producing the named absence rather
  than a blank overlay. Visible ODbL attribution is derived from each dataset's own `sources[]`
  citation, not typed in, so a region under another licence changes the footer by itself; a bare
  `ODbL` stays `ODbL` and the version is never invented. Mutation-checked: `display:none` on the
  footer fails all five e2e assertions, and removing `position: sticky` fails exactly the one
  that says a loaded photo must not bury it. `grep -o OpenStreetMap dist/assets/*.js | wc -l`
  → **13** (was 0). See [docs/DEPLOY.md](docs/DEPLOY.md).
- **Phase 7 — CV skyline alignment, +78 tests + 1 e2e — built and proved, NOT wired in.**
  Injected offsets spanning ±20° recovered to **heading 0.022°, pitch 0.091°** through the full
  round trip and **0.013° / 0.075°** over the real SRTM Gornergrat horizon, against a 0.5° spec.
  Alignment is **not a pixel shift** — a rectilinear lens makes that wrong by 3.7° at the frame
  edge for a 10° error. The failure variant of `SkylineAlignment` carries **no offsets at all**,
  so a caller cannot read a confident zero out of a refusal; flat horizon, total fog, 80 % of
  columns lost, periodic ridgeline, an offset outside the search window, an offset exactly at
  its rim and a snow-capped skyline all refuse. P7.4 and P7.5 are open, above.
  *Still true of the repository's own fixtures:* `fixtures/photos/*.jpg` are uniform grey frames
  generated for the EXIF suite, and `gornergrat-matterhorn.jpg` yields **zero readable columns**
  (asserted in `src/cv/real-photo.test.ts` — refusing is the correct answer for that file). The
  known enemy is sunlit snow, which is brighter than a hazy sky: `align.test.ts` shows the
  extractor locking onto the *snowline* and the aligner refusing. The two real photographs in
  `fixtures/photos/real/` are what finally measured it.
- **Q1 — Integration.** `src/app/overlay-builder.ts` and `src/app/composite-export.ts` wired
  into `<App>`; the `?seam-probe=1` branch and its test are **deleted** and replaced by one that
  drives the real pipeline over real SRTM bytes. Browser terrain is static grids on the app's
  own origin, one code path for whole tiles and committed windows alike, the largest grid
  covering a point winning because a window can produce a false `visible` and only the tile can
  prove an occlusion. Synthetic test tiles are never served. Missing terrain is a **named
  absence** in the same family as `needs-manual`, checked *before* the pipeline runs. See
  [README.md](README.md#how-the-browser-gets-terrain) and [docs/DEPLOY.md](docs/DEPLOY.md).
- **Q3 — The demo PNG.** `npm run demo -- gornergrat` writes `out/annotated.png` from the real
  pipeline over the full `data/tiles/N45E007.hgt`, composited in Chromium with no second
  rasteriser and no new dependency. Full tiles are the **default** and a missing tile stops the
  run with instructions. The overlay is composited onto **this run's own terrain silhouette,
  hatched and captioned "not a photograph" on the image itself**; the horizon line lying on that
  silhouette is tautological and the report says so, while the peak markers are not, because
  they come from the peak database and the projection with no reference to the terrain sweep.
  **What the image shows:** the Matterhorn flag lands 1.92° above the drawn ridge — 1.92° at
  9.58 km is ~327 m, so the picture reproduces the documented DEM error (−248 m, displaced
  ~320 m) rather than a labelling bug. Broad summits do not show it: in the wide framing the
  Breithorn flag sits 0.27° above its own ridge, on it.
- **Q7 — `noTerrainMessage` made honest for a stranger.** It told every visitor to run
  `npm run fetch:tiles`, which is right for a developer and useless to the public. It now leads
  with what is true of the deployment, keeps the position, the missing tile and the grids
  served, says outright that photographs over shipped terrain are unaffected, and keeps the
  command **last and explicitly scoped** to someone running a source checkout. No assertion was
  dropped; two were added.
- v1 Expo attempt archived to `archive/v1-expo/` (2026-08-16).
- Mission docs written (MISSION.md, PLAN.md, TODO.md, CLAUDE.md).

---

## Kept for the record

Corrections and superseded findings are kept, not edited away. A project that advertises only
its successes teaches the next reader nothing.

### X-2 — the occlusion rule was wrong, and running the code found it

The fix: a peak is occluded only by terrain with distance strictly `<` the peak's own.
`HorizonPoint.skylineSteps` (additive, optional) carries the per-bearing running-maximum
staircase, and `interpolateNearerTerrainAltitudeDeg` answers "how high does terrain reach nearer
than this?" using the *same* bearing bracket and weight as the skyline query, seam included.
Core tests 151 → 178, acceptance 112 → 116. **No existing test needed changing** — none had
encoded the old rule, because every hand-built fixture peak already sat behind its occluder.
Two judgment calls recorded: strict `<` at the boundary (a summit *is* the sample at its own
distance, so `<=` would make every peak hide itself and leave the verdict to floating-point
luck), and a mixed bracket returns the real occluder rather than interpolating toward an
invented floor.

**Gate verification, independent of the fixing agent.** A throwaway suite was written against a
hand-built two-step profile (+2° at 5 km, taller +8° at 20 km), run, and discarded. It confirmed
all four directions, which matters because the danger in fixing over-occlusion is over-correcting
into a filter that shows everything: near peak +4° @10 km in front of the far ridge → **visible**
(the original bug); far peak +4° @30 km behind it → **hidden** (not permissive); peak nearer than
all terrain → −90° nadir, nothing can occlude it; terrain at exactly the peak's range → does not
occlude.

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

### X-3 — Fort William's Cow Hill, resolved honestly

The HIGH-confidence must-see "Cow Hill" came out HIDDEN and was **not** weakened or skipped.
Resolved without touching the visibility rule: the summit point is still hidden (clearance
−0.356°) and is now labelled **greyed** because the DEM shows the ground rising unbroken from
the blocking crest (248 m at 0.84 km) to the summit — deepest col 0.0 m — while the hill
dominates the skyline at +17.02°. The case file records the measured figures. The alternatives
the finding offered were not needed and were not taken.

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

### X-1 — the correction to the briefing about voids

This mirror is **void-filled**. Zermatt (46.0207, 7.7491) reads **1608 m, not −32768**, and
N45E007 / N46E007 / N27E086 / N28E086 contain **0 voids in 51 868 804 samples**. The void code
path is real and tested, but on **synthetic** tiles — no honest real fixture from this source
can contain a void. The full correction, including how the wrong tile was sampled, is in
[MISSION.md](MISSION.md).
