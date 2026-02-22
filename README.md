# Mountain Finder

A React Native (Expo) app that overlays labeled mountain peak markers onto your phone's live camera feed using GPS, compass, and topographic data.

## How it works

```
GPS position
    │
    ├──► OpenTopoData API  ──► 360° elevation samples
    │         (SRTM 90m)         ──► terrain horizon profile
    │
    └──► OpenStreetMap      ──► nearby peaks (name, lat/lng, elevation)
          (Overpass API)

Compass heading
    │
    └──► projectToScreen()  ──► normalised screen x/y for each peak
                                 filtered by camera FOV
                                 visibility tested against horizon profile
                                 │
                                 └──► AROverlay drawn on top of CameraView
```

### Key pipeline steps

| Step | Module | Description |
|------|--------|-------------|
| 1 | `hooks/useLocation` | Streams GPS position via `expo-location` |
| 2 | `hooks/useCompass` | Reads magnetometer at 10 Hz, applies EMA smoothing |
| 3 | `services/elevationService` | Samples 1 260 elevation points in a 360° grid via OpenTopoData |
| 4 | `utils/terrainProjection` | Builds horizon profile; computes elevation angle & bearing per peak |
| 5 | `services/peakService` | Fetches OSM peaks within 100 km via Overpass QL |
| 6 | `hooks/useTerrainData` | Orchestrates steps 3–5; re-fetches when user moves > 500 m |
| 7 | `components/AROverlay` | Projects peaks to screen; draws silhouette SVG + name badges |

## Project structure

```
Mountain-finder/
├── app/
│   ├── _layout.tsx              Root navigator (expo-router Stack)
│   └── (tabs)/
│       ├── _layout.tsx          Tab bar (AR View / Settings)
│       ├── index.tsx            Main AR camera screen
│       └── settings.tsx         Display preferences
├── components/
│   ├── AROverlay.tsx            Transparent overlay composing all AR elements
│   ├── HorizonProfile.tsx       SVG terrain silhouette
│   ├── PeakMarker.tsx           Floating name badge + flag pole
│   └── CompassIndicator.tsx     Heading HUD badge
├── hooks/
│   ├── useLocation.ts           GPS stream
│   ├── useCompass.ts            Magnetometer → heading
│   └── useTerrainData.ts        Terrain + peak data orchestration
├── services/
│   ├── elevationService.ts      OpenTopoData API client
│   └── peakService.ts           Overpass API client
├── utils/
│   └── terrainProjection.ts     Geodetic math (haversine, bearing, projection)
└── constants/
    └── config.ts                Tuneable parameters
```

## Getting started

```bash
npm install
npx expo start
```

Scan the QR code with **Expo Go** on your phone.  The app requires:
- Location permission (GPS)
- Camera permission (AR view)
- Internet access (elevation + peak APIs)

## Configuration

All tuneable parameters live in `constants/config.ts`:

| Key | Default | Description |
|-----|---------|-------------|
| `PEAK_SEARCH_RADIUS_KM` | 100 | OSM peak search radius |
| `MAX_PEAKS_DISPLAYED` | 30 | Maximum simultaneous labels |
| `CAMERA_HFOV` | 60° | Horizontal camera field-of-view |
| `CAMERA_VFOV` | 45° | Vertical camera field-of-view |
| `HORIZON_ANGULAR_RESOLUTION_DEG` | 2° | Angular spacing of horizon samples |
| `HORIZON_SAMPLE_DISTANCES_KM` | [2,5,10,20,40,70,100] | Distances sampled per bearing |
| `REFETCH_THRESHOLD_KM` | 0.5 | Min movement before data re-fetch |

## Data sources

- **Elevation** — [OpenTopoData](https://www.opentopodata.org/) · SRTM 90 m (free, no API key)
- **Peaks** — [OpenStreetMap](https://www.openstreetmap.org/) via [Overpass API](https://overpass-api.de/) (free)

## Roadmap

- [ ] Wire settings toggles to `AROverlay` props (via Context / Zustand)
- [ ] Add tilt/pitch correction using gyroscope for vertical alignment
- [ ] Cache terrain data locally (SQLite / MMKV) to reduce API calls
- [ ] Show a distance-scaled radar mini-map of surrounding peaks
- [ ] Add offline SRTM tile support for areas without connectivity
