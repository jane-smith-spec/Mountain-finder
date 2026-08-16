/**
 * Elevation sources for offline runs: an analytic terrain function, and a
 * lookup over a pre-generated cloud of samples.
 *
 * Both implement `ElevationProvider`, so they drop into the pipeline exactly
 * where a tile store would. Neither touches the network or the filesystem.
 *
 * `SampleCloudElevationSource` is the one the acceptance suite uses for the
 * synthetic scenes. The scenes hand out `ElevationSample[]` produced by their
 * own generator — the pipeline is supposed to consume the GENERATED DATA, not
 * to call the scene's analytic terrain function, because a pipeline that
 * evaluated the terrain function directly would never exercise the sampling
 * geometry that real tiles force on it. So the cloud is indexed by position and
 * the pipeline's own ray points are matched against it.
 *
 * The match tolerance is a metre. The scenes generate their points with an
 * independent copy of the great-circle destination formula (deliberately, so
 * that a bug in core's geodesy cannot move the terrain and the expectation in
 * lockstep), and the two implementations agree to about a nanometre — so a
 * missed match means a genuine disagreement about where a ray goes, not a
 * rounding artefact. Misses are counted and never filled in.
 */

import { haversineDistanceM } from '../../core/geodesy.js';
import type { ElevationSample, LatLng, Peak } from '../../core/types.js';
import type {
  ElevationProvider,
  ElevationRequestOptions,
  ElevationResult,
} from '../../providers/elevation.js';

/** Terrain as a function of position. `null` = no data here (ocean, void). */
export type TerrainFunctionM = (point: LatLng) => number | null;

/** An analytic terrain, sampled exactly, with the calls counted. */
export class FunctionElevationSource implements ElevationProvider {
  readonly dataset: string;

  /** How many points have been asked for. Lets a test prove a lookup was skipped. */
  pointsRequested = 0;

  private readonly terrain: TerrainFunctionM;

  constructor(terrain: TerrainFunctionM, dataset = 'analytic') {
    this.terrain = terrain;
    this.dataset = dataset;
  }

  fetchElevations(
    points: readonly LatLng[],
    _options: ElevationRequestOptions = {},
  ): Promise<readonly ElevationResult[]> {
    this.pointsRequested += points.length;
    return Promise.resolve(
      points.map((point) => ({
        lat: point.lat,
        lon: point.lon,
        elevationM: this.terrain(point),
        dataset: this.dataset,
      })),
    );
  }
}

/** Cell size of the lookup index, in degrees. ~1.1 m of latitude. */
const CELL_DEG = 1e-5;

/** Default largest accepted separation between a query and a sample, degrees. */
const DEFAULT_MATCH_TOLERANCE_DEG = 1e-5;

function cellKey(lat: number, lon: number): string {
  return `${Math.round(lat / CELL_DEG)}:${Math.round(lon / CELL_DEG)}`;
}

/**
 * Nearest-sample lookup over a fixed cloud of elevation samples.
 *
 * A query that lands further than `matchToleranceDeg` from every sample returns
 * `elevationM: null` — "no data here" — rather than the nearest value from
 * somewhere else. Silently widening the search is how a terrain sample from the
 * next valley ends up on a skyline.
 */
export class SampleCloudElevationSource implements ElevationProvider {
  readonly dataset: string;

  /** Queries that found no sample within tolerance. Should be zero in a test. */
  misses = 0;

  pointsRequested = 0;

  private readonly cells = new Map<string, ElevationSample[]>();

  private readonly matchToleranceDeg: number;

  constructor(
    samples: readonly ElevationSample[],
    options: { readonly matchToleranceDeg?: number; readonly dataset?: string } = {},
  ) {
    this.matchToleranceDeg = options.matchToleranceDeg ?? DEFAULT_MATCH_TOLERANCE_DEG;
    this.dataset = options.dataset ?? 'sample-cloud';
    for (const sample of samples) {
      const key = cellKey(sample.lat, sample.lon);
      const bucket = this.cells.get(key);
      if (bucket === undefined) this.cells.set(key, [sample]);
      else bucket.push(sample);
    }
  }

  get size(): number {
    let total = 0;
    for (const bucket of this.cells.values()) total += bucket.length;
    return total;
  }

  /** The sample nearest `point`, or `undefined` if none is within tolerance. */
  lookup(point: LatLng): ElevationSample | undefined {
    const latCell = Math.round(point.lat / CELL_DEG);
    const lonCell = Math.round(point.lon / CELL_DEG);

    let best: ElevationSample | undefined;
    let bestSeparationDeg = Number.POSITIVE_INFINITY;

    for (let dLat = -1; dLat <= 1; dLat += 1) {
      for (let dLon = -1; dLon <= 1; dLon += 1) {
        const bucket = this.cells.get(`${latCell + dLat}:${lonCell + dLon}`);
        if (bucket === undefined) continue;
        for (const sample of bucket) {
          const separationDeg = Math.hypot(sample.lat - point.lat, sample.lon - point.lon);
          if (separationDeg < bestSeparationDeg) {
            bestSeparationDeg = separationDeg;
            best = sample;
          }
        }
      }
    }
    return bestSeparationDeg <= this.matchToleranceDeg ? best : undefined;
  }

  fetchElevations(
    points: readonly LatLng[],
    _options: ElevationRequestOptions = {},
  ): Promise<readonly ElevationResult[]> {
    this.pointsRequested += points.length;
    return Promise.resolve(
      points.map((point) => {
        const sample = this.lookup(point);
        if (sample === undefined) this.misses += 1;
        return {
          lat: point.lat,
          lon: point.lon,
          elevationM: sample?.elevationM ?? null,
          dataset: sample === undefined ? `${this.dataset}(no-sample)` : this.dataset,
        };
      }),
    );
  }
}

/**
 * A peak source over a fixed list — the injectable counterpart to the database.
 *
 * The radius filter is real, not a formality: a source that ignored it would
 * hide a pipeline that forgot to pass one.
 */
export class StaticPeakSource {
  private readonly peaks: readonly Peak[];

  constructor(peaks: readonly Peak[]) {
    this.peaks = peaks;
  }

  peaksWithin(center: LatLng, radiusKm: number): Promise<readonly Peak[]> {
    return Promise.resolve(
      this.peaks.filter((peak) => haversineDistanceM(center, peak) / 1000 <= radiusKm),
    );
  }
}
