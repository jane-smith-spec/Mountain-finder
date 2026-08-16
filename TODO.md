# TODO

Live checklist. Check items only after their self-check has been run and passed (see PLAN.md for each check's definition).

## Phase 0 — Scaffold
- [ ] P0.1 Vite + React + TS(strict) + vitest + ESLint + Playwright toolchain
- [ ] P0.2 `check` / `test:e2e` / `test:acceptance` / `demo` scripts wired

## Phase 1 — Geometry core (group A)
- [ ] P1.1 Geodesy (haversine, bearing, destination, wrap-safe angles)
- [ ] P1.2 Sightline (curvature + refraction, LoS sweep) — analytic cone test passing
- [ ] P1.3 Horizon profile (build + wrap-safe interpolation)
- [ ] P1.4 Camera projection (pose + FOV from focal length)
- [ ] P1.5 Visibility filter

## Phase 2 — Data providers (group B)
- [ ] P2.1 Transport layer (Fetch + Fixture transports, retry/backoff/abort)
- [ ] P2.2 Elevation provider (OpenTopoData, batching)
- [ ] P2.3 Peaks provider (Overpass, node+way, ele parsing)
- [ ] P2.4 Fixture recorder script + first recorded site

## Phase 3 — Photo ingestion (group C)
- [ ] P3.1 EXIF extraction (GPS, direction, focal→FOV)
- [ ] P3.2 Fallback model + manual override merge

## Phase 4 — Renderer (group D)
- [ ] P4.1 SVG overlay builder (horizon line, flags, labels, collision avoidance)
- [ ] P4.2 PNG compositor + export

## Phase 5 — Web app (group E)
- [ ] P5.1 App shell (drop-zone, autofill, overrides, trim sliders, test mode)
- [ ] P5.2 Annotated PNG export

## Phase 6 — Ground truth (group F)
- [ ] P6.1 Synthetic analytic scenes (cone, twin ridges, plateau)
- [ ] P6.2 Real photo set (3–5 open-license cases with documented coords)
- [ ] P6.3 Acceptance suite green

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
