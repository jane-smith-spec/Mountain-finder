# Mission

## What Mountain Finder is

A system that takes a photograph of mountains together with where it was taken from and which direction the camera faced, computes the terrain horizon from topographic elevation data, determines which named peaks are actually visible (not hidden behind closer ridges), and renders the photo back with labeled flags planted on the correct summits.

The end-state product is a live augmented-reality view on a phone. The base product — the one everything else is built on and proven against — works on still photos.

## The prime directive: agent self-testability

**No product is "done" until the agent that built it has run its check and watched it pass, in this environment, without a human or a phone in the loop.**

This is the lesson of v1. The Expo app accumulated ~2,500 lines of plausible code that nobody — human or agent — ever executed, because it needed a camera, GPS chip, and magnetometer to do anything. When the dependencies finally got installed, they didn't even resolve. Untested code is not progress; it is deferred debugging with interest.

Consequences of the directive:

1. **Every product ships with an executable self-check** — a command that passes or fails. The check is defined *before* the product is built and listed next to it in [PLAN.md](PLAN.md).
2. **The core pipeline is pure.** Geometry, visibility, and rendering are functions from data to data — no network, no DOM, no device. Pure functions can be tested against mathematically known answers.
3. **Tests never touch the network.** API providers are exercised against recorded fixture responses. A separate, explicitly-run recorder script refreshes fixtures from the live APIs.
4. **The output is inspectable.** The renderer produces SVG/PNG files the agent can open, screenshot in headless Chromium, and geometrically assert against ("the Matterhorn label sits within 3% of expected pixel position").
5. **Synthetic ground truth before real ground truth.** A cone-shaped mathematical mountain has an exactly computable horizon angle. If the pipeline can't get the cone right, no real photo will save it.

## Decision record

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Base platform | **TypeScript core library + web app** (Vite/React) | The whole pipeline runs and is verifiable headlessly here (vitest + Playwright/Chromium). The core is later reused unchanged by the mobile app. |
| D2 | Photo location/direction source | **EXIF auto-extract + manual override** | Phone photos carry GPS, altitude, compass direction (GPSImgDirection), and focal length. Messaging apps strip EXIF, so manual entry remains a first-class path, not an afterthought. |
| D3 | Silhouette recognition (CV) | **Deferred to its own phase** | Compass EXIF is typically 5–15° off, so CV alignment is what ultimately makes flags snap to summits — but it is the riskiest component and must not block the geometry foundation. Base version offers manual fine-alignment sliders instead. |
| D4 | Ground-truth test data | **Agent-assembled** | Synthetic analytic fixtures plus a small set of openly licensed photos with documented coordinates. Work never blocks on waiting for user photos; user photos can be added as acceptance cases anytime. |
| D5 | Still photos before live view | **Yes — foundational** | A photo is a file; a location is a number; an annotated image is a checkable artifact. Live view is a projection-loop upgrade on a proven pipeline, not a separate product. |
| D6 | v1 Expo code | **Archived, not deleted** | `archive/v1-expo/` — the geodesy/LoS math is sound as reference material and gets re-derived with tests in v2. |
| D8 | Obscured summits | **Label them, greyed — but only when self-occluded** | User's call: a summit hidden behind its own hill should still be labelled, lightly greyed. Applied naively this would gut the must-NOT-see gates, so it is split by *what* does the hiding. **Self-occlusion** (the summit point is behind its own landform's shoulder — Cow Hill, occluder at 0.84 km vs summit at 0.99 km) gets a greyed label: the hill unmistakably fills the view. **Foreground occlusion** (a different, much nearer landform — Mount Baker behind Queen Anne Hill, 160 km away) stays unlabelled: you genuinely cannot see it, and drawing it would be the app inventing a mountain. |
| D7 | Elevation data source | **Offline-first: local SRTM `.hgt` tiles** | User preference, and correct on the merits — mountain photos are taken where there is no signal. Live JSON APIs demote from a runtime dependency to an acquisition step. Also unblocks this environment, where `api.opentopodata.org` and `overpass-api.de` are 403 at the egress proxy but `s3.amazonaws.com` is reachable. |

### What the real SRTM data taught us (verified 2026-08-16)

> **Correction.** An earlier revision of this section claimed voids are common in this source,
> citing a Zermatt sample reading `−32768`. **That was wrong, and the error was mine.** Zermatt
> sits at 46.0207°N, which is *north* of tile `N45E007` (that tile covers 45–46°N). I sampled it
> in the wrong tile; the negative row index read out of bounds and my scan returned the sentinel.
> Read from the correct tile `N46E007`, Zermatt reports **1608 m — its true elevation.**
> Independently re-verified: **0 voids in 25,934,402 samples** across both tiles.
> The lesson is the one this project keeps relearning: a plausible number from a buggy read is
> more dangerous than a crash, which is exactly why tile-edge and hemisphere cases are tested.

| Location | Tile | SRTM reads | Known | Δ |
|---|---|---|---|---|
| Grand Combin (broad summit) | `N45E007` | 4287 m | 4314 m | −27 m |
| Matterhorn (sharp pyramid) | `N45E007` | 4230 m | 4478 m | −248 m |
| Dent d'Hérens | `N45E007` | 3835 m | 4171 m | −336 m |
| Zermatt village | `N46E007` | **1608 m** | 1608 m | **0 m** ✓ |

1. **This source is void-filled.** The AWS `elevation-tiles-prod/skadi` mirror contains no voids
   (0 in 51.8 M samples across four tiles, including the Everest region). Void handling is still
   implemented and tested, because other SRTM distributions (USGS SRTMGL1 v2) *do* carry voids
   and a `−32768` silently treated as an elevation would corrupt the skyline. But that code is
   **defensive, exercised only by synthetic fixtures** — not a response to observed data. Said
   plainly so nobody later mistakes it for evidence.
2. **SRTM underestimates sharp summits** by 250–350 m, because a 30 m grid cannot resolve a
   pyramid — *and it displaces them*: the Matterhorn's highest posting sits ~320 m WSW of the
   surveyed summit, which itself reads only 3567 m. Therefore: use SRTM for the *terrain
   horizon*, but take *summit heights* from the peak database's tagged elevation. Sampling peak
   heights from SRTM would place every alpine label hundreds of metres too low **and sideways**.
3. **Broad terrain and valley floors are trustworthy** (−27 m at Grand Combin; exact at Zermatt),
   so the horizon profile itself is sound.

## What success looks like

The honest overall status is stated once, in [README.md](README.md#status-honestly); the tags
below say only which of the three levels that status has reached.

1. **Base (v2.0) — ✅ met.** Drop a mountain photo into the web app → EXIF is read → within seconds, the photo displays with a terrain horizon line and named flags on visible peaks; missing metadata can be typed in; misalignment can be nudged with sliders; result exports as PNG. Every stage is covered by tests the agent runs.
2. **CV upgrade (v2.1) — 🔨 in progress.** The computed silhouette auto-aligns to the photo's actual skyline; label error drops accordingly, measured against the ground-truth set. The aligner meets its bar on computed profiles (0.013°); the extractor has been measured on real photographs and does not yet meet it — see [docs/FINDINGS.md](docs/FINDINGS.md) CV-2…CV-4.
3. **Live view (v3) — ⛔ not started.** A mobile app (Expo, reusing the core) does the same continuously against the camera feed with sensor fusion.
