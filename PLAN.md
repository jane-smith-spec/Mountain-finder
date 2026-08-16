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

| Product | Description | Self-check |
|---|---|---|
| P2.1 Transport layer | `Transport` interface; `FetchTransport` (retry ×3, backoff, 429 handling, AbortSignal) + `FixtureTransport` (replays recorded JSON) | Fake-transport tests: fails twice → succeeds on 3rd; 429 → longer delay; abort → immediate typed error |
| P2.2 Elevation provider | OpenTopoData SRTM client, 100-point batching, typed errors | Offline test against recorded fixture: request grid → correct parsed elevations, correct batch count |
| P2.3 Peaks provider | Overpass client (nodes + way centroids, ele/ele:ft parsing), typed errors | Offline test against recorded fixture: known area → expected peak list with correct elevations |
| P2.4 Fixture recorder | `npm run record:fixtures -- --site <name>` captures live responses into `/fixtures/api/` | Run once per site during development; recorded files validate against provider schemas |

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
