/**
 * Elevation from LOCAL SRTM tiles — the offline replacement for the HTTP
 * elevation provider (PLAN.md P2.2 said OpenTopoData; this is the same seam).
 *
 * WHY LOCAL IS THE DEFAULT NOW.
 *   Mountain photographs are taken where there is no signal, so the product has
 *   to work from data already on the device. Practically, the JSON elevation and
 *   peak APIs are also unreachable from this environment. `.hgt` tiles turn
 *   elevation from a runtime dependency into an acquisition-time one:
 *   `npm run fetch:tiles` downloads squares of the world once, and the pipeline
 *   then runs with no network at all.
 *
 * THE SEAM. This class implements `ElevationProvider` from `elevation.ts`, so
 * anything that already takes an `ElevationProvider` accepts it unchanged. The
 * meaning of `elevationM: null` is identical in both: NO DATA HERE (ocean, void,
 * or — new for tiles — no tile downloaded for that square). It is never 0 m.
 *
 * `fetchElevations` flattens everything to `number | null` because that is the
 * shared contract. When you need to know WHY a point has no elevation — void vs.
 * missing tile vs. outside the grid — call `sampleTerrain`, which keeps the
 * distinction and also reports how the value was interpolated.
 */

import type { LatLng } from '../core/types.js';
import { ProviderError } from './errors.js';
import type { ElevationProvider, ElevationRequestOptions, ElevationResult } from './elevation.js';
import {
  SRTM1_GRID_SIZE,
  SRTM3_GRID_SIZE,
  type TileReadingMethod,
  type VoidPolicy,
} from './hgt-tile.js';
import { tileNameFor, type TileStore } from './tile-store.js';

export interface TileElevationOptions {
  /** Default `'bilinear'`. `'nearest'` returns the raw posting, no averaging. */
  readonly interpolation?: 'bilinear' | 'nearest';
  /** What interpolation does at the fringe of a void. Default `'nearest-valid'`. */
  readonly voidPolicy?: VoidPolicy;
  /**
   * What to do when the tile covering a point has not been downloaded.
   * `'no-data'` (default) reports `elevationM: null`, exactly like a void;
   * `'throw'` raises `ProviderError('empty-result')` naming the missing tile,
   * which is what a batch job wants so it can go and fetch it.
   */
  readonly missingTilePolicy?: 'no-data' | 'throw';
}

/** Why a point has no elevation, or how it got one. */
export type TerrainStatus = 'ok' | 'void' | 'missing-tile' | 'outside-tile';

export interface TerrainSample extends LatLng {
  readonly status: TerrainStatus;
  /** Metres above sea level, or `null` for every non-`ok` status. */
  readonly elevationM: number | null;
  /** How the value was derived. Absent unless `status === 'ok'`. */
  readonly method?: TileReadingMethod;
  /** Which tile was consulted, whether or not it was available. */
  readonly tileName: string;
  /** Resolution label of the tile consulted, e.g. `srtm1`. */
  readonly dataset: string;
}

/** Dataset label reported for a point whose tile has not been downloaded. */
export const MISSING_TILE_DATASET = 'local-tiles(missing)';

/** Human-readable dataset label for a grid size, used in `ElevationResult.dataset`. */
export function datasetLabelForGridSize(size: number): string {
  if (size === SRTM1_GRID_SIZE) return 'srtm1';
  if (size === SRTM3_GRID_SIZE) return 'srtm3';
  return `hgt-${size}`;
}

export class TileElevationProvider implements ElevationProvider {
  private readonly store: TileStore;

  private readonly options: TileElevationOptions;

  constructor(store: TileStore, options: TileElevationOptions = {}) {
    this.store = store;
    this.options = options;
  }

  /** One point, with the full explanation of what happened. */
  async sampleTerrain(point: LatLng): Promise<TerrainSample> {
    const tileName = tileNameFor(point.lat, point.lon);
    const tile = await this.store.tileFor(point.lat, point.lon);
    if (tile === null) {
      if (this.options.missingTilePolicy === 'throw') {
        throw new ProviderError(
          'empty-result',
          `No local tile ${tileName} for ${point.lat},${point.lon} — ` +
            `run: npm run fetch:tiles -- ${tileName}`,
        );
      }
      return {
        lat: point.lat,
        lon: point.lon,
        status: 'missing-tile',
        elevationM: null,
        tileName,
        dataset: MISSING_TILE_DATASET,
      };
    }

    const reading = tile.read(point.lat, point.lon, {
      interpolation: this.options.interpolation ?? 'bilinear',
      voidPolicy: this.options.voidPolicy ?? 'nearest-valid',
    });
    const dataset = datasetLabelForGridSize(tile.geometry.cols);

    if (reading.status === 'ok') {
      return {
        lat: point.lat,
        lon: point.lon,
        status: 'ok',
        elevationM: reading.elevationM,
        method: reading.method,
        tileName: tile.name,
        dataset,
      };
    }
    return {
      lat: point.lat,
      lon: point.lon,
      status: reading.status === 'void' ? 'void' : 'outside-tile',
      elevationM: null,
      tileName: tile.name,
      dataset,
    };
  }

  /** Many points, order preserved, with the full explanation of each. */
  async sampleTerrainBatch(
    points: readonly LatLng[],
    options: ElevationRequestOptions = {},
  ): Promise<readonly TerrainSample[]> {
    const out: TerrainSample[] = [];
    for (const point of points) {
      throwIfAborted(options.signal);
      out.push(await this.sampleTerrain(point));
    }
    return out;
  }

  /**
   * `ElevationProvider` contract: same shape the HTTP provider returns, so local
   * tiles drop straight into anything already written against it.
   */
  async fetchElevations(
    points: readonly LatLng[],
    options: ElevationRequestOptions = {},
  ): Promise<readonly ElevationResult[]> {
    if (points.length === 0) return [];
    const samples = await this.sampleTerrainBatch(points, options);
    return samples.map((sample) => ({
      lat: sample.lat,
      lon: sample.lon,
      elevationM: sample.elevationM,
      dataset: sample.dataset,
    }));
  }

  /** Which tiles a set of points needs but the store does not have. */
  async missingTilesFor(points: readonly LatLng[]): Promise<readonly string[]> {
    const missing = new Set<string>();
    const checked = new Set<string>();
    for (const point of points) {
      const name = tileNameFor(point.lat, point.lon);
      if (checked.has(name)) continue;
      checked.add(name);
      if ((await this.store.tileByName(name)) === null) missing.add(name);
    }
    return [...missing].sort();
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw new ProviderError('aborted', 'Elevation sampling was aborted by the caller');
}
