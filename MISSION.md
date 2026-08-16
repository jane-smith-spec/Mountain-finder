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

## What success looks like

1. **Base (v2.0):** Drop a mountain photo into the web app → EXIF is read → within seconds, the photo displays with a terrain horizon line and named flags on visible peaks; missing metadata can be typed in; misalignment can be nudged with sliders; result exports as PNG. Every stage is covered by tests the agent runs.
2. **CV upgrade (v2.1):** The computed silhouette auto-aligns to the photo's actual skyline; label error drops accordingly, measured against the ground-truth set.
3. **Live view (v3):** A mobile app (Expo, reusing the core) does the same continuously against the camera feed with sensor fusion.
