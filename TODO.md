# TODO

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

## Phase 3 — Photo ingestion (group C) ✅ 69 tests
- [x] P3.1 EXIF extraction — real JPEGs authored byte-wise; `GPSImgDirectionRef` honoured
- [x] P3.2 Fallback + override merge — 9 pose fields, each resolved or explicitly needs-manual

## Blocked on environment (not on code)
- [ ] Re-record `fixtures/api/**` from live OpenTopoData + Overpass once egress permits
- [ ] P6.2 real-viewpoint research needs reachable reference sources (Wikipedia also 403)

## Phase 4 — Renderer (group D)
- [ ] P4.1 SVG overlay builder (horizon line, flags, labels, collision avoidance)
- [ ] P4.2 PNG compositor + export

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
