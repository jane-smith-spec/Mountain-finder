# Mountain Finder

Point the app at a photo of mountains — it figures out which peaks you're looking at and plants labeled flags on their summits.

**Status:** v2 restart. The v1 Expo/React Native attempt is preserved in [`archive/v1-expo/`](archive/v1-expo/ARCHIVE-NOTE.md). v2 is a self-testable TypeScript pipeline + web app, built still-photo-first.

| Document | Purpose |
|---|---|
| [MISSION.md](MISSION.md) | What we're building, the prime directive, and the decision record |
| [PLAN.md](PLAN.md) | Phased build plan — every product with its self-check, tasks grouped for agents |
| [TODO.md](TODO.md) | Live checklist, updated as work lands |
| [CLAUDE.md](CLAUDE.md) | Working rules for agent sessions in this repo |

## The pipeline at a glance

```
photo (JPEG)
  │
  ├─ EXIF extract ──► lat/lng, altitude, compass direction, focal length → FOV
  │                    (manual override for any missing/wrong value)
  │
  ├─ elevation data (OpenTopoData SRTM) ──► 360° line-of-sight sweep
  │                                          ──► terrain horizon silhouette
  ├─ peak database (OpenStreetMap Overpass) ─► named peaks + geometry
  │
  └─ camera projection ──► visible peaks placed at pixel coordinates
                            ──► SVG overlay: horizon line + flags + names
```

Later phases add computer-vision skyline alignment (snap the computed silhouette to the actual one in the photo) and a live-camera mobile app that reuses the same core.
