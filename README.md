# Mountain Finder

Point it at a photo of mountains — it works out which peaks you're looking at and plants labeled flags on their summits.

**Status:** v2 in build. The whole chain is wired end to end — drop a photo into the web app and, where terrain is available, it renders a real overlay and exports it; `npm run demo -- gornergrat` writes an annotated image from real SRTM data. The v1 Expo/React Native attempt is retired to [`archive/v1-expo/`](archive/v1-expo/ARCHIVE-NOTE.md).

| Document | Purpose |
|---|---|
| [MISSION.md](MISSION.md) | What we're building, the prime directive, the decision record |
| [PLAN.md](PLAN.md) | Every product paired with the executable check that proves it |
| [TODO.md](TODO.md) | Live checklist |
| [CLAUDE.md](CLAUDE.md) | Working rules for agent sessions |

## The prime directive

**Nothing is done until the agent that built it ran its check and watched it pass.**

v1 died of the opposite: ~2,500 lines of plausible, never-executed code that needed a phone's camera, GPS, and compass to do anything. v2 is still-photo-first precisely because a photo is a file, a location is a number, and an annotated image is an artifact you can assert against.

This is not ceremony. Running things has repeatedly overturned what we believed:

- The plan's own **occlusion rule was wrong** — it compared peaks against the skyline at all distances, but terrain *behind* a peak cannot hide it. Found by the group whose only job was independent ground truth.
- **SRTM doesn't just underestimate sharp summits, it displaces them.** The Matterhorn's highest posting reads 4230 m (true: 4478 m) and sits ~320 m from the surveyed summit. So peak heights come from the peak database; terrain comes from SRTM.
- A **"discovery" of SRTM voids turned out to be a bug in the sampling code** — reading a coordinate from the tile one degree south of the one containing it. The correction is recorded inline in `MISSION.md` rather than quietly edited away.

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

## Commands

| Command | What it proves |
|---|---|
| `npm run check` | typecheck + lint + full unit suite, offline and deterministic |
| `npm run test:e2e` | Playwright against real Chromium |
| `npm run test:acceptance` | ground-truth cases; a pass means the *yardstick* is sound |
| `npm run demo -- <case>` | runs a real case end to end and writes `out/annotated.png` — the human-viewable proof |
| `npm run build` | typecheck + production bundle |
| `npm run fetch:tiles` | acquisition only: pulls SRTM tiles from AWS Open Data |

## How the browser gets terrain

The app reads elevation from **static grids on its own origin** — an index at
`/terrain/manifest.json` plus the raw sample files it names
(`src/providers/terrain-manifest.ts`, `src/providers/http-terrain-store.ts`). No
live elevation API is ever called at runtime; `npm run fetch:tiles` remains the
only thing that talks to the outside world.

During `npm run dev` / `npm run preview` that directory is published by
`scripts/terrain-server.ts` out of what the repository already holds: whole
tiles from `data/tiles/` (gitignored, fetched on demand) and the committed
real-SRTM case windows from `fixtures/tiles/cases/`. Synthetic test tiles are
deliberately never served — invented mountains at real coordinates is the exact
failure mode this project exists to avoid. A production deployment serves its
own tile directory at `/terrain/`.

Where the app has no terrain it says so specifically — which tile is missing,
what it holds instead, and the command that fixes it — and draws nothing. An
empty overlay would read as "no peaks are visible from here", which is a
different claim and would be a fabricated one.

## Layout

```
src/core/       Pure geometry: geodesy, sightline, horizon, projection, visibility.
                No network, no DOM, no device APIs, no Date.now. Deterministic throughout.
src/providers/  Elevation from local .hgt tiles; HTTP clients demoted to acquisition.
src/exif/       Photo metadata → camera pose, with an explicit manual-override model.
src/render/     Pure overlay builder: scene in, SVG string out.
src/pipeline/   Orchestration, fully injectable so tests run offline.
fixtures/       Analytic scenes with closed-form answers, real SRTM windows, cited cases.
archive/        Retired v1. Read-only reference.
```

## Testing rules

1. **Tests never touch the network.** Only `record:fixtures` and `fetch:tiles` may, and only when run deliberately.
2. **Expectations are derived independently** — from closed-form mathematics or cited references, never by running the code and pasting its output back. This is what caught the effective-Earth-radius error and the occlusion bug.
3. **Ground truth is built by people who don't implement the pipeline**, so the yardstick can't quietly bend to fit it.
4. **Uncertainty is recorded, not resolved by guessing.** Half Dome from Mount Diablo clears its ridge by 0.0043° — about 8 m at 200 km — so it's marked *disputed* and asserted in neither direction.
