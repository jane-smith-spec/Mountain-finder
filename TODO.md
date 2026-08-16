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
- [ ] **Q2 — Fix review findings** from task 3, by severity: silent-wrong-answer bugs first.
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
