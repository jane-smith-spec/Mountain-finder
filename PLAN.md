# Build Plan

Every product below lists its **self-check**: the exact command an agent runs to prove the product works, and what passing means. A product without a passing self-check is not done. Global gates are at the bottom.

## Repository layout (target)

```
/src/core/        Pure pipeline: geodesy, sightline, horizon, projection, visibility.
                  No network, no DOM, no device APIs. 100% unit-testable.
/src/providers/   Elevation (OpenTopoData) + peaks (Overpass) clients behind interfaces,
                  with an injectable transport so tests replay recorded fixtures.
/src/exif/        Photo metadata extraction → camera pose + FOV, with manual-override model.
/src/render/      Pure overlay builder: (photo size, horizon, peaks, camera) → SVG string.
/src/app/         React web UI: drop photo, autofill, override panel, sliders, PNG export.
/fixtures/        Synthetic scenes, recorded API responses, ground-truth photos + expectations.
/scripts/         Fixture recorder (the only code allowed to hit live APIs).
/tests/           unit / integration / e2e (Playwright).
/archive/v1-expo/ The retired v1 React Native attempt (reference only).
```

## Phases and products

### Phase 0 — Scaffold *(agent group S)*

| Product | Description | Self-check |
|---|---|---|
| P0.1 Toolchain | Vite + React + TypeScript (strict) + vitest + ESLint + Playwright, single npm package | `npm run check` (typecheck + lint + unit tests) exits 0; `npm run build` exits 0 |
| P0.2 CI-shaped scripts | `check`, `test:e2e`, `test:acceptance`, `demo` npm scripts exist (later phases fill them) | `npm run` lists all four; each runs (even if trivially) without error |

### Phase 1 — Geometry core *(agent group A — parallel with B, C, F)*

| Product | Description | Self-check |
|---|---|---|
| P1.1 Geodesy | haversine, bearing, destination point, wrap-safe angle math | Unit tests vs published reference values (< 0.1% error); destination→haversine round-trip; antimeridian + pole edge cases |
| P1.2 Sightline | Elevation angle with Earth curvature + refraction (k=0.13); line-of-sight sweep near→far per ray | **Analytic cone test:** synthetic cone mountain → horizon angle matches closed-form atan within 0.01°; two-ridge occlusion test: far-but-lower ridge provably hidden |
| P1.3 Horizon profile | 360° profile build from samples; interpolation at arbitrary bearing with 0°/360° wrap | Interpolation exactness at sample points; midpoint linearity; wrap continuity at 359.5° |
| P1.4 Camera projection | (bearing, altitude angle) → normalized image x/y given heading, pitch, roll, hFOV/vFOV; FOV from focal length (35mm-equiv) | Identity tests: peak dead-ahead → x=0.5; peak at heading+hFOV/2 → x=1.0; focal 24mm/50mm → known FOV values |
| P1.5 Visibility filter | Peak visible iff its angle clears interpolated horizon at its bearing (tolerance param) | Synthetic scene with one exposed and one ridge-hidden peak → exactly the right one survives |

### Phase 2 — Data providers *(agent group B)*

**Revised per decision D7 (offline-first).** Local SRTM tiles are the primary elevation
source; the HTTP clients below demote from a runtime dependency to an acquisition path.

| Product | Description | Self-check |
|---|---|---|
| P2.1 Transport layer | `Transport` interface; `FetchTransport` (retry ×3, backoff, 429 handling, AbortSignal) + `FixtureTransport` (replays recorded JSON) | Fake-transport tests: fails twice → succeeds on 3rd; 429 → longer delay; abort → immediate typed error |
| P2.2 Elevation provider *(acquisition)* | OpenTopoData SRTM client, 100-point batching, typed errors | Offline test against recorded fixture: request grid → correct parsed elevations, correct batch count |
| P2.3 Peaks provider | Overpass client (nodes + way centroids, ele/ele:ft parsing), typed errors | Offline test against recorded fixture: known area → expected peak list with correct elevations |
| P2.4 Fixture recorder | `npm run record:fixtures -- --site <name>` captures live responses into `/fixtures/api/` | Recorded files validate against provider schemas. **Currently unmet** — egress 403. |
| **P2.5 HGT tile reader** | Parse `.hgt`/`.hgt.gz` (SRTM1 3601², SRTM3 1201², int16 BE, row 0 = north). Bilinear + nearest lookup. **Voids (`−32768`) are an explicit no-data state, never coerced to a number.** | Synthetic tiles with closed-form terrain → exact values; grid-edge cases (first/last sample, north/south edge, shared tile overlap); void policy tested directly |
| **P2.6 Tile store** | lat/lon → tile name with correct floor semantics across **both hemispheres** (`S01W001`, `N10W010`); directory load; in-memory cache | Hemisphere and negative-coordinate naming tested explicitly — this is where an off-by-one silently returns the wrong continent |
| **P2.7 Tile fetcher** | `npm run fetch:tiles` pulls from AWS Open Data (`elevation-tiles-prod/skadi/…`), gunzips, skips existing | Acquisition tool; may hit network. Tiles land in gitignored `data/tiles/` |
| **P2.8 Real-data fixture** | A small window of genuine Zermatt SRTM committed as raw bytes + provenance sidecar, reproducible via a generator script | Tests parse **real bytes in the real format**, not hand-authored JSON — strictly stronger than P2.2's fixtures |

### Phase 3 — Photo ingestion *(agent group C)*

| Product | Description | Self-check |
|---|---|---|
| P3.1 EXIF extraction | exifr-based: GPS lat/lng/alt, GPSImgDirection (+true/magnetic ref), focal length + 35mm-equiv → hFOV | Fixture JPEGs with authored EXIF → exact expected values |
| P3.2 Fallback model | Missing-field detection → `needs-manual` states; merged pose = EXIF ⊕ user overrides | EXIF-stripped fixture → all fields flagged; override merge precedence tested |

### Phase 4 — Renderer *(agent group D — needs A's types)*

| Product | Description | Self-check |
|---|---|---|
| P4.1 Overlay builder | Pure: scene → SVG string (horizon polyline, flag poles, name labels, leader lines, label collision avoidance) | SVG snapshot tests on synthetic scenes; geometric assertion: flag x/y within ±0.5% of hand-computed position |
| P4.2 PNG compositor | Photo + SVG overlay → exported PNG (canvas) | Playwright: render fixture scene, export, assert PNG dimensions + non-empty; screenshot saved as reviewable artifact |

### Phase 5 — Web app *(agent group E — needs A–D)*

| Product | Description | Self-check |
|---|---|---|
| P5.1 App shell | Drop-zone → EXIF autofill → override panel → overlay view; heading/pitch/FOV trim sliders; fixture-transport test mode | Playwright e2e: load fixture photo offline → expected labels render; slider changes move labels the mathematically expected number of pixels |
| P5.2 Export | Annotated PNG download | Playwright: click export → file received with expected dimensions |

### Phase 6 — Ground truth *(agent group F — starts in parallel with Phase 1)*

| Product | Description | Self-check |
|---|---|---|
| P6.1 Synthetic scenes | 3+ analytic terrains (cone, twin ridges, plateau) with closed-form expected horizons | Expectations computed independently from the pipeline code (separate derivation in the fixture file) |
| P6.2 Real photo set | 3–5 openly licensed mountain photos with documented shooting coordinates + expected visible peak names | Each case file lists source URL, license, coordinates, and must-see peaks — reviewed for correctness |
| P6.3 Acceptance suite | `npm run test:acceptance` — full pipeline per case | Every must-see peak labeled; no peak labeled that the horizon proves hidden; where pixel positions are annotated, error within tolerance |

### Phase 9 — Peak coverage *(Q5 — the binding constraint after v2.0)*

v2.0 ships working. It works at four viewpoints, because the peak database holds three
summits. Everything downstream of that database is finished and tested; the database is the
product's limit. Every peak source is blocked from this environment except AWS S3, where
Overture Maps is both listable and range-readable.

| Product | Description | Self-check |
|---|---|---|
| P9.1 Parquet range reader | Read a remote Parquet footer over HTTP Range; expose row groups with their `bbox` statistics. Verified feasible: 524 KB read from an 850 MB part = **0.062%** | Against a committed real parquet slice, offline: footer parses, row-group count and bbox stats match values stated independently in the fixture sidecar |
| P9.2 Spatial pruning | Keep only row groups whose bbox intersects the wanted area; never fetch a whole part | A bbox covering one row group fetches exactly that group; **bytes fetched vs part size is printed**, because that ratio is the whole design |
| P9.3 Peak extraction | Establish what marks a summit in Overture (subtype/class), where `names.primary` lives, and **whether elevations exist at all** | Extracted peaks match values readable in the committed fixture and stated as literals |
| P9.4 Elevation provenance | **Open question, must not be papered over.** If Overture carries no summit heights, that is a design problem, not a detail — SRTM under-reads sharp summits by 250–350 m and displaces them ~320 m (see MISSION.md), so sampling the DEM for peak heights is forbidden | Every imported peak's `elevationSource` is honest; a peak with no trustworthy height is reported, never given a DEM value |
| P9.5 Scalable peak store | Serve "peaks within radius of a point" without loading a region into memory per query; keep the `PeaksProvider` seam unchanged | Pipeline is untouched; the cited `ground-truth-peaks.json` summits still resolve and all 148 acceptance assertions still pass |
| P9.6 Conflict reporting | Where Overture disagrees with a cited ground-truth height or position | Disagreement is **reported, not silently resolved**; the cited value wins by default because it is the one with a source |

### Phase 10 — Deployment *(what turns a passing build into a published site)*

`npm run build` alone is not deployable: it ships no terrain (which square degrees a
deployment carries is not the bundler's decision) and, until this phase, it displayed no
attribution for data that legally requires it. A deployment is one static directory served
by anything — no server code, no API key, no third-party runtime call (decision D7).
Everything here is documented in [docs/DEPLOY.md](docs/DEPLOY.md).

| Product | Description | Self-check |
|---|---|---|
| P10.1 Static packaging | `npm run package:deploy` stages `dist/terrain/` (manifest + grids, `--gzip` siblings) and `dist/peaks/<region>/` from whatever is on disk, using the same index builder the dev server uses; refuses a grid whose byte length disagrees with its geometry | `npm run test:deploy` |
| P10.2 Deployment proof | A plain static server over `dist/` in real Chromium: manifest byte-identical to the packaged file, no `/@vite/client`, the Gornergrat photo drawing the Matterhorn within 12 px of the closed-form projection, a 25.93 MB tile arriving gzipped, **every request same-origin**, a missing tile named rather than silently blank | `npm run test:deploy` |
| P10.3 Visible attribution | The app displays the credit its data's licences require — ODbL-1.0 / © OpenStreetMap contributors for the Overture summits, NASA/USGS SRTM as courtesy — derived from the datasets' own `sources[]` records, not typed in, so a region under another licence changes the footer by itself | `npm run test:deploy`; also `npx vitest run src/app/attribution.test.ts` and `npx playwright test tests/e2e/attribution.spec.ts` for legibility (on screen unscrolled, ≥ 4.5:1 in both colour schemes) |

**A generated `ATTRIBUTION.txt` does not satisfy P10.3.** The obligation is on the running
app; a file nobody links to is not attribution. That distinction is why the self-check is a
browser assertion on a visible element and not a `grep` of the deployment directory.

### Phase 7 — CV silhouette alignment *(v2.1 — after base ships)*

Skyline extraction from the photo (per-column luminance gradient), 1-D cross-correlation against the computed profile solving heading/pitch offset, auto-trim replacing manual sliders. Self-check: synthetic rendered silhouettes with known injected offset → recovered within 0.5°; acceptance-suite label error strictly improves vs. manual baseline.

### Phase 8 — Live view *(v3 — after v2.1)*

Expo app reusing `/src/core` unchanged; camera feed + sensor fusion; the archived v1 serves as UI reference. Self-testing limited to core reuse + unit level, by design — everything risky was proven in v2.

## Agent orchestration

Groups are sized so one agent holds one coherent context; waves maximize parallelism:

```
Wave 1 (after P0):   A (geometry)   B (providers)   C (exif)   F (fixtures)   ← run in parallel
Wave 2:              D (renderer — consumes A's types)
Wave 3:              E (web app — consumes A+B+C+D)
Gate after each wave: npm run check green + adversarial review agent on the wave's diff
Final gate:          npm run test:e2e && npm run test:acceptance green
```

Rules for every agent task hand-off:
- The task prompt names the products and pastes their self-checks verbatim.
- The agent must run the self-check and report the actual command output — "should pass" is a failed hand-off.
- A separate reviewer agent verifies each wave before the next begins.

## Global gates

| Command | Meaning |
|---|---|
| `npm run check` | Typecheck + lint + all unit/integration tests (offline, deterministic) |
| `npm run test:e2e` | Playwright against the built app with fixture transport |
| `npm run test:acceptance` | Ground-truth photo cases end-to-end |
| `npm run demo -- <case>` | Writes `out/annotated.png` for a case — the human-viewable proof |
| `npm run test:deploy` | The packaged `dist/` behind a plain static server: real overlay, same-origin only, visible ODbL notice (run after `npm run build && npm run package:deploy -- --gzip`) |
