# Mountain Finder

Point it at a photo of mountains — it works out which peaks you're looking at and plants
labeled flags on their summits. Offline: terrain comes from local SRTM tiles, summits from a
local peak database, and nothing talks to an API at runtime.

## Status, honestly

- **v2.0 ships and works.** The whole chain runs end to end: drop a photo into the web app and,
  where terrain is available, it renders a real overlay and exports it. `npm run demo --
  gornergrat` writes an annotated image from real SRTM data. It is proven on four ground-truth
  viewpoints and a packaged static deployment. Last recorded gate run (2026-08-16, TODO.md Q6):
  `check` 50 files / 1 025 tests, `test:acceptance` 153, Playwright 21, `test:deploy` 5.
- **v2.1 (CV alignment) is in progress and measured, not finished.** The aligner recovers an
  injected offset to 0.013° against real SRTM terrain. The skyline *extractor* has now met real
  photographs for the first time and the result is mixed and quantified: 98.8 % coverage on a
  favourable photo, 1.4 % on a snowy hazy one, and — the finding that matters —
  [it stitches a foreground ridge to the distant horizon](docs/FINDINGS.md), which is why the
  first real end-to-end run refused rather than guessing. Being fixed.
- **v3 (live view) has not started.** No code, by decision — it is a projection-loop upgrade on
  a proven pipeline, not a separate product.
- **Two environment blockers are real and recorded, not worked around.** Live API egress is
  403 at the proxy, so `fixtures/api/**` was never recorded from OpenTopoData or Overpass
  (P2.4's self-check is unmet and is marked `[~]`, not ticked). And EXIF does not survive the
  upload path, so the two real photographs arrived with dimensions and `Orientation` only — no
  GPS, no direction, no focal length.

The v1 Expo/React Native attempt is retired to
[`archive/v1-expo/`](archive/v1-expo/ARCHIVE-NOTE.md), read-only.

## Where to read further

| Document | Purpose |
|---|---|
| [MISSION.md](MISSION.md) | What we're building, the prime directive, the decision record (D1–D8), what real SRTM data taught us |
| [PLAN.md](PLAN.md) | Every product paired with the executable check that proves it, and each phase's status |
| [TODO.md](TODO.md) | Live checklist: what's done, what's open, what's blocked |
| [docs/FINDINGS.md](docs/FINDINGS.md) | **Index of every confirmed finding**, with stable ids, severity and whether it's fixed |
| [docs/DEPLOY.md](docs/DEPLOY.md) | What a deployment serves, what it costs on the wire, missing-terrain behaviour, licensing |
| [docs/CV-REAL-PHOTO-FINDING.md](docs/CV-REAL-PHOTO-FINDING.md) | First contact between the skyline extractor and real photographs |
| [docs/IDAHO-PHOTO-CASES.md](docs/IDAHO-PHOTO-CASES.md) | The two supplied photographs and what is established about each |
| [REVIEW-FINDINGS.md](REVIEW-FINDINGS.md) · [-2](REVIEW-FINDINGS-2.md) · [-3](REVIEW-FINDINGS-3.md) | The three adversarial review gates, in full — indexed by docs/FINDINGS.md |
| [CLAUDE.md](CLAUDE.md) | Working rules for agent sessions |

## Commands

| Command | What it proves |
|---|---|
| `npm run check` | typecheck + lint + full unit suite, offline and deterministic |
| `npm run test:e2e` | Playwright against real Chromium |
| `npm run test:acceptance` | ground-truth cases; a pass means the *yardstick* is sound |
| `npm run demo -- <case>` | runs a real case end to end and writes `out/annotated.png` — the human-viewable proof |
| `npm run build` | typecheck + production bundle |
| `npm run package:deploy` | assembles `dist/terrain/` + `dist/peaks/` — a deployable static directory |
| `npm run test:deploy` | the built bundle behind a plain static server, no Vite: [docs/DEPLOY.md](docs/DEPLOY.md) |
| `npm run fetch:tiles` | acquisition only: pulls SRTM tiles from AWS Open Data |

## The prime directive

**Nothing is done until the agent that built it ran its check and watched it pass.**

v1 died of the opposite: ~2,500 lines of plausible, never-executed code that needed a phone's
camera, GPS, and compass to do anything. v2 is still-photo-first precisely because a photo is a
file, a location is a number, and an annotated image is an artifact you can assert against.

This is not ceremony. Running things has repeatedly overturned what we believed — five times,
in the order they happened:

- The plan's own **occlusion rule was wrong** — it compared peaks against the skyline at all
  distances, but terrain *behind* a peak cannot hide it. Found by the group whose only job was
  independent ground truth.
- **SRTM doesn't just underestimate sharp summits, it displaces them.** The Matterhorn's highest
  posting reads 4230 m (true: 4478 m) and sits ~320 m from the surveyed summit. So peak heights
  come from the peak database; terrain comes from SRTM.
- A **"discovery" of SRTM voids turned out to be a bug in the sampling code** — reading a
  coordinate from the tile one degree south of the one containing it. The correction is recorded
  inline in `MISSION.md` rather than quietly edited away.
- I published **"the extractor scores 0 of 512 columns"** and diagnosed it at length. It was my
  own probe bug: I filtered on `column.confidence` and `column.row` when the fields are
  `confidence01` and `rowNorm`, and `undefined > 0` is `false`, so every column was discarded
  and the extractor was blamed for it. **The second time a confident conclusion came from a
  broken read** — which is the whole reason the retraction stays at the top of
  [that document](docs/CV-REAL-PHOTO-FINDING.md) instead of being edited away.
- **The extracted skyline spans 17.56° where no real skyline from that viewpoint can exceed
  8.63°** (the entire 360° horizon spans 10.97°). That single measurement proved the extractor
  stitches a near foreground ridge to a distant horizon — and it was decisive precisely because
  **span is invariant to the two things we did not know**: an unmodelled pitch shifts the range
  without changing its span, and a wrong focal length scales it near-uniformly. Neither can turn
  8.63° into 17.56°. Sweeping parameters would have taken days and taught nothing.

Every confirmed finding is indexed, with severity and fix status, in
[docs/FINDINGS.md](docs/FINDINGS.md).

## Pipeline

```
photo (JPEG)
  │
  ├─ EXIF ──► lat/lon, altitude, GPSImgDirection (+ True/Magnetic ref), focal → FOV
  │            missing or wrong values are an explicit "needs manual" state,
  │            never a silent default; magnetic is never treated as true
  │
  ├─ local SRTM .hgt tiles ──► ray sweep per bearing ──► skyline staircase
  │            (offline; no network at runtime)         (angle as a function of distance)
  │
  ├─ local peak database ──► named summits with tagged elevations
  │
  └─ visibility: a peak is occluded only by terrain NEARER than itself
        └─► camera projection ──► SVG overlay: horizon line + flags + names
```

## Layout

```
src/core/       Pure geometry: geodesy, sightline, horizon, projection, visibility.
                No network, no DOM, no device APIs, no Date.now. Deterministic throughout.
src/providers/  Elevation from local .hgt tiles; HTTP clients demoted to acquisition.
src/exif/       Photo metadata → camera pose, with an explicit manual-override model.
src/cv/         Skyline extraction and alignment (v2.1, built and not wired in).
src/render/     Pure overlay builder: scene in, SVG string out.
src/pipeline/   Orchestration, fully injectable so tests run offline.
fixtures/       Analytic scenes with closed-form answers, real SRTM windows, cited cases.
archive/        Retired v1. Read-only reference.
```

## How the browser gets terrain

The app reads elevation from **static grids on its own origin** — an index at
`/terrain/manifest.json` plus the raw sample files it names
(`src/providers/terrain-manifest.ts`, `src/providers/http-terrain-store.ts`). No live elevation
API is ever called at runtime; `npm run fetch:tiles` remains the only thing that talks to the
outside world. In dev and preview `scripts/terrain-server.ts` publishes that directory out of
what the repository already holds; a production build ships no terrain, because which square
degrees a deployment carries is a deployment decision, and `npm run package:deploy` assembles
the one it does want.

Two rules are load-bearing rather than incidental:

- **Synthetic test tiles are never served.** Invented mountains at real coordinates is the exact
  failure mode this project exists to avoid.
- **Missing terrain is a named absence**, not a blank overlay: the app says which tile is
  missing, what it holds instead, and how to fix it, and draws nothing. An empty overlay would
  read as "no peaks are visible from here", which is a different claim and would be a fabricated
  one.

Sizes, gzip ratios, the per-session cost, the server settings and the attribution obligations
are all in [docs/DEPLOY.md](docs/DEPLOY.md) — measured, not estimated.

## Testing rules

1. **Tests never touch the network.** Only `record:fixtures` and `fetch:tiles` may, and only when run deliberately.
2. **Expectations are derived independently** — from closed-form mathematics or cited references, never by running the code and pasting its output back. This is what caught the effective-Earth-radius error and the occlusion bug.
3. **Ground truth is built by people who don't implement the pipeline**, so the yardstick can't quietly bend to fit it.
4. **Uncertainty is recorded, not resolved by guessing.** Half Dome from Mount Diablo clears its ridge by 0.0043° — about 8 m at 200 km — so it's marked *disputed* and asserted in neither direction.
