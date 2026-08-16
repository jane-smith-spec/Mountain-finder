Where the pipeline's data comes from.

**Elevation is offline-first.** Terrain heights are read from local SRTM `.hgt`
tiles in `data/tiles/`, downloaded once by `npm run fetch:tiles`. Mountain photos
are taken where there is no signal, so the runtime must not depend on an
elevation API — and in this environment the JSON elevation APIs are unreachable
anyway. `elevation.ts` (OpenTopoData over HTTP) is retained as an *acquisition*
path and as the definition of the shared `ElevationProvider` seam; `tile-elevation.ts`
implements that same seam from disk.

## Layout

| File | What it is |
|---|---|
| `errors.ts` | `ProviderError` with a discriminating `code`: `network`, `timeout`, `aborted`, `rate-limited`, `bad-response`, `empty-result`, `fixture-missing`. |
| `transport.ts` | The `Transport` seam plus the canonical request key used to address recordings. |
| `fetch-transport.ts` | Production transport: 3 attempts, exponential backoff, longer backoff on HTTP 429 (`Retry-After` honoured when longer), per-request timeout, immediate typed error on abort. The delay function is injectable so tests assert backoff without waiting. |
| `fixture-transport.ts` | Offline replay from recorded exchanges. Pure — no fs, no network. |
| `fixture-store.ts` | **Node only.** Reads/writes `fixtures/api/**`. Never import from the web app. |
| `elevation.ts` | OpenTopoData SRTM 90 m client. Batches at the API's hard limit of 100 locations, preserves request order, keeps `null` (ocean/void) distinct from 0 m. |
| `peaks.ts` | Overpass client. `natural=peak` + `name`, nodes **and** ways (`out body center` for centroids), `ele` / `ele:ft` parsing, `elevationSource` set honestly. |
| `hgt-tile.ts` | The `.hgt` reader: big-endian int16, row 0 = north, grid size derived from file length (SRTM1 3601², SRTM3 1201²). Bilinear + nearest lookup returning a discriminated `TileReading`. |
| `tile-store.ts` | lat/lon → `N45E007` tile name (**floor**, both hemispheres), name parsing, bbox → tile list, `MemoryTileStore`. Pure. |
| `tile-directory.ts` | **Node only.** Loads `<NAME>.hgt` / `<NAME>.hgt.gz` from a directory with an LRU cache; also loads the committed real-data window fixtures. |
| `tile-elevation.ts` | `TileElevationProvider` — the `ElevationProvider` seam, served from local tiles. |
| `synthetic-tile.ts` | Builds `.hgt` bytes from a closed-form terrain function, so tests have exactly-known values. |

## Using it

```ts
// Elevation, offline, from tiles already on disk.
const store = new DirectoryTileStore('data/tiles');           // MemoryTileStore in the browser
const elevation = new TileElevationProvider(store);
const [reading] = await elevation.fetchElevations([{ lat: 45.9756, lon: 7.6547 }]);
// reading.elevationM === 4230 (SRTM's Matterhorn), or null for void / no tile.

// Why a point has no elevation, when you need to know:
const sample = await elevation.sampleTerrain({ lat: 45.9756, lon: 7.6547 });
// { status: 'ok' | 'void' | 'missing-tile' | 'outside-tile',
//   method: 'bilinear' | 'nearest' | 'nearest-valid', tileName: 'N45E007', … }
```

```ts
const transport = new FetchTransport();                       // or FixtureTransport in tests
const peaks = await new OverpassPeaksProvider(transport).fetchPeaks({
  center: { lat: 45.9833, lon: 7.7847 },
  radiusKm: 15,
});
const { peaks: resolved, unresolved } = await resolvePeakElevations(
  peaks,
  new OpenTopoDataElevationProvider(transport),
);
```

`fetchPeaks` returns `PeakCandidate[]`, whose `elevationM` may be `null` when
OSM has no usable `ele` tag. `resolvePeakElevations` fills those from SRTM and
returns `Peak[]` (`src/core/types.ts`) with `elevationSource` set to `osm`,
`srtm`, and anything still unplaceable reported separately in `unresolved` —
never silently defaulted.

Elevation readings are `ElevationResult[]` with `elevationM: number | null`.
Convert to the core's `ElevationSample[]` with `toElevationSamples(results,
policy)`, where policy is `'throw'`, `'drop'`, or `{ fillM }` — the caller has
to say what "no data" means.

## Tiles: the three things that silently go wrong

**1. Voids.** `-32768` in a `.hgt` means "no radar return", not an elevation.
Treated as 0 m it puts a fake sea-level pit in the terrain; treated as −32768 m,
a 32 km trench. Either silently corrupts a skyline. So:

* `sampleAt` returns `number | null`; `TileReading` is a union you cannot read a
  number out of without checking `status`.
* **Bilinear never averages a void in.** If a corner of the cell is void the
  reading falls back to the **valid corner with the largest bilinear weight**
  (`method: 'nearest-valid'` — at most one sample spacing, ~30 m, of
  displacement, and visible to the caller). If **all four** corners are void the
  result is `status: 'void'`. Pass `voidPolicy: 'no-data'` to make any void
  corner produce `'void'` instead.
* **…but only a void the interpolation actually weighted.** On a grid line the
  off-line corners have weight zero, so a reading exactly on a valid sample —
  or anywhere along an edge whose void sits off that edge — is plain
  `'bilinear'`: its value cannot depend on what is stored in the void. Calling
  that `'nearest-valid'` would understate good data, and under `'no-data'` it
  would discard a correct measurement. The bound is stated as an elevation
  error (`NEGLIGIBLE_VOID_WEIGHT` in `hgt-tile.ts`) rather than a bare
  `weight === 0`, because 1/3600° is not representable in binary and a query
  aimed at a sample line lands ~1e-12 off it.
* Nearest-neighbour never substitutes: a void sample reads `'void'`.

The AWS `elevation-tiles-prod/skadi` mirror that `fetch:tiles` uses is
**void-filled** — verified: 0 voids in 51 868 804 samples across N45E007,
N46E007, N27E086, N28E086. The void path is therefore proven on synthetic
fixtures, and stays in the code because the format defines it and other SRTM
distributions are full of them.

**2. Tile naming is `floor`, not truncation.** Tiles are named for their
south-west corner, so `-33.92 → S34` and `-43.21 → W044`. `Math.trunc` gives
`S33` / `W043`: a real, loadable tile 111 km away. Exact integers name the tile
they *open* — 46.0 is the south edge of N46, not the north edge of N45 — even
though N45's last row holds the same line of samples. Adjacent tiles genuinely
**share** their boundary row/column (which is why the grid is 3601 and not 3600);
verified against the real pair: N45E007 row 0 and N46E007 row 3600 agree on all
3601 samples.

**3. SRTM is a terrain surface, not a summit register.** It under-reads and
displaces sharp peaks: Matterhorn 4230 m vs 4478 m surveyed, and its highest
posting sits ~320 m WSW of the surveyed summit; broad Grand Combin 4287 vs
4314 m. Use tiles for the **terrain horizon**; take peak heights from the peak
database's `ele` tag (`elevationSource: 'osm'`).

## Getting tiles

```
npm run fetch:tiles -- N45E007 N46E007
npm run fetch:tiles -- --bbox 45.90,7.60,46.10,7.90     # south,west,north,east
npm run fetch:tiles -- --around 45.976,7.659 --radius-km 20
```

Tiles land in `data/tiles/` (gitignored, ~25 MB each), already present ones are
skipped, and a truncated download is rejected before it can be mistaken for a
good tile. This script and `record-fixtures.ts` are the only code allowed to use
the network. Test fixtures live in `fixtures/tiles/` — see its README.

## Rules

* No test in this directory touches the network: HTTP tests replay
  `fixtures/api/**` through `FixtureTransport`, tile tests read
  `fixtures/tiles/**`. No test depends on `data/tiles/` existing.
* Only `scripts/record-fixtures.ts` may call the live APIs.
* Naming follows `src/core/types.ts`: `elevationM` is a height in metres,
  `bearingDeg` / `altitudeDeg` are angles.
