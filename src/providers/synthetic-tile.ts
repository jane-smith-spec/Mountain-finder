/**
 * Synthetic `.hgt` tiles with mathematically known terrain.
 *
 * Real SRTM bytes prove the reader handles the real world (see
 * `fixtures/tiles/*.json`); these prove it handles ARITHMETIC. A tile whose
 * terrain is a known closed-form function has an exactly predictable value at
 * every sample and — for the affine/bilinear surfaces below — at every
 * interpolated point too, so a test can state its expectation from the formula
 * instead of from the reader's own output.
 *
 * Byte layout is identical to a real tile (big-endian int16, row-major, row 0 =
 * north), so these files exercise the same parse path, including the
 * "grid size derived from file length" rule. Test grids are small (e.g. 21 × 21,
 * 882 bytes) which is not a real SRTM size — that is deliberate: the reader must
 * derive `n` rather than assume 1201/3601.
 */

import {
  HgtTile,
  VOID_SAMPLE,
  encodeBigEndianInt16,
  parseHgtTile,
  type GridGeometry,
} from './hgt-tile.js';
import { ProviderError } from './errors.js';
import { parseTileName } from './tile-store.js';

/** Height in metres at a coordinate, or `null` to write a void there. */
export type TerrainFunction = (lat: number, lon: number) => number | null;

export interface SyntheticTileSpec {
  /** SRTM tile name; fixes the geometry, e.g. `S01W001`. */
  readonly name: string;
  /** Samples per side. Any n ≥ 2; the sample spacing is `1 / (n − 1)` degrees. */
  readonly gridSize: number;
  readonly terrain: TerrainFunction;
}

/** int16 range, minus the void marker which is reserved. */
const MIN_STORABLE = -32767;
const MAX_STORABLE = 32767;

/** Raw `.hgt` bytes for a synthetic tile. Heights are rounded to whole metres. */
export function buildSyntheticHgtBytes(spec: SyntheticTileSpec): Uint8Array {
  const corner = parseTileName(spec.name);
  if (corner === null) {
    throw new ProviderError('bad-tile', `"${spec.name}" is not an SRTM tile name`);
  }
  const size = spec.gridSize;
  if (!Number.isInteger(size) || size < 2) {
    throw new ProviderError('bad-tile', `gridSize must be an integer ≥ 2, got ${size}`);
  }
  const step = 1 / (size - 1);
  const northLat = corner.southLat + 1;
  const samples = new Int16Array(size * size);

  for (let row = 0; row < size; row += 1) {
    const lat = northLat - row * step;
    for (let col = 0; col < size; col += 1) {
      const lon = corner.westLon + col * step;
      const height = spec.terrain(lat, lon);
      samples[row * size + col] = height === null ? VOID_SAMPLE : toStorable(height, lat, lon);
    }
  }
  return encodeBigEndianInt16(samples);
}

function toStorable(height: number, lat: number, lon: number): number {
  const rounded = Math.round(height);
  if (!Number.isFinite(rounded) || rounded < MIN_STORABLE || rounded > MAX_STORABLE) {
    throw new ProviderError(
      'bad-tile',
      `Terrain height ${height} at ${lat},${lon} does not fit in an int16 sample`,
    );
  }
  return rounded;
}

/** Build the tile and parse it straight back — exercising the real parse path. */
export function buildSyntheticTile(spec: SyntheticTileSpec): HgtTile {
  return parseHgtTile(buildSyntheticHgtBytes(spec), cornerOf(spec.name), spec.name);
}

function cornerOf(name: string): { southLat: number; westLon: number } {
  const corner = parseTileName(name);
  if (corner === null) throw new ProviderError('bad-tile', `"${name}" is not an SRTM tile name`);
  return corner;
}

/** Everywhere the same height. Interpolation must return it exactly, everywhere. */
export function constantTerrain(heightM: number): TerrainFunction {
  return () => heightM;
}

/**
 * A bilinear surface: `base + perLat·Δlat + perLon·Δlon + cross·Δlat·Δlon`,
 * with Δ measured from `(originLat, originLon)`.
 *
 * Bilinear interpolation reproduces a bilinear surface EXACTLY, so this is the
 * one terrain where an interpolated value has a closed form and any error in the
 * weights, the row/column order, or the north/south sign shows up immediately.
 */
export function bilinearTerrain(params: {
  readonly originLat: number;
  readonly originLon: number;
  readonly baseM: number;
  readonly perLatDegM: number;
  readonly perLonDegM: number;
  readonly crossM?: number;
}): TerrainFunction {
  const cross = params.crossM ?? 0;
  return (lat, lon) => {
    const dLat = lat - params.originLat;
    const dLon = lon - params.originLon;
    return params.baseM + params.perLatDegM * dLat + params.perLonDegM * dLon + cross * dLat * dLon;
  };
}

/**
 * A right circular cone in degree-space: height falls linearly with angular
 * distance from the apex and is clamped at the plain height. Not exactly
 * reproducible by bilinear interpolation (it has a crease at the apex and is
 * radial), so tests assert its structural properties — apex value, radial
 * symmetry, monotone descent — rather than interpolated equality.
 */
export function coneTerrain(params: {
  readonly apexLat: number;
  readonly apexLon: number;
  readonly apexM: number;
  readonly plainM: number;
  readonly slopeMPerDeg: number;
}): TerrainFunction {
  return (lat, lon) => {
    const dLat = lat - params.apexLat;
    const dLon = lon - params.apexLon;
    const distanceDeg = Math.hypot(dLat, dLon);
    return Math.max(params.plainM, params.apexM - params.slopeMPerDeg * distanceDeg);
  };
}

/** Wrap a terrain function so a rectangular block of samples is written as voids. */
export function withVoidBlock(
  terrain: TerrainFunction,
  block: { readonly north: number; readonly south: number; readonly west: number; readonly east: number },
): TerrainFunction {
  const eps = 1e-9;
  return (lat, lon) => {
    const inside =
      lat <= block.north + eps &&
      lat >= block.south - eps &&
      lon >= block.west - eps &&
      lon <= block.east + eps;
    return inside ? null : terrain(lat, lon);
  };
}

/** The geometry a synthetic tile of this name and size will have. */
export function syntheticGeometry(name: string, gridSize: number): GridGeometry {
  const corner = cornerOf(name);
  const step = 1 / (gridSize - 1);
  return {
    northLat: corner.southLat + 1,
    westLon: corner.westLon,
    rows: gridSize,
    cols: gridSize,
    latStepDeg: step,
    lonStepDeg: step,
  };
}
