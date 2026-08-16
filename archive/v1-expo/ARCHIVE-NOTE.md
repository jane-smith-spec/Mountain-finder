# Archived: v1 Expo/React Native attempt

**Archived 2026-08-16.** Retired, kept for reference. Do not build on this code.

## Why it was retired

The app targeted live AR on a phone from day one (Expo + camera + GPS + magnetometer). None of those exist in the agent's build environment, so no line of it was ever executed end-to-end — the prime failure mode v2 is designed against. The dependency set additionally failed to resolve (ERESOLVE, fixed late by downgrading to SDK 51).

## What is worth referencing

- `utils/terrainProjection.ts` — geodesy + curvature/refraction math (re-derived with tests in v2 `/src/core`)
- `services/horizonCalculator.ts` — line-of-sight sweep design, typed error pattern, batching/retry approach
- `services/peakService.ts` — Overpass query shape (node + way centroids), ele/ele:ft parsing, horizon interpolation with 0/360 wrap
- The UI composition (camera → overlay → HUD layering) as a sketch for v3 live view

## What not to repeat

- Building against hardware the builder cannot run
- Writing ~2,500 lines before the first `npm install`
- Visibility math without analytic known-answer tests
