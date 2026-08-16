API clients behind a Transport interface so tests replay fixtures offline.

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

## Using it

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

## Rules

* No test in this directory touches the network; they all replay
  `fixtures/api/**` through `FixtureTransport`.
* Only `scripts/record-fixtures.ts` may call the live APIs.
* Naming follows `src/core/types.ts`: `elevationM` is a height in metres,
  `bearingDeg` / `altitudeDeg` are angles.
