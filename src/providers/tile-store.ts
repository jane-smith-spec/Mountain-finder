/**
 * Mapping coordinates to SRTM tiles, and the store seam that hands them back.
 *
 * TILE NAMING — the part that is easy to get subtly wrong.
 *   A tile is named after its SOUTH-WEST corner, so the name comes from
 *   `floor(lat)` and `floor(lon)`, never from truncation. In the northern and
 *   eastern hemispheres those agree; in the southern and western ones they do
 *   NOT, and `Math.trunc` produces a name one degree off that still parses and
 *   still loads a real (wrong) tile — a silent 111 km error.
 *
 *     lat  45.98  → floor  45 → N45      lat −33.92 → floor −34 → S34
 *     lon   7.66  → floor   7 → E007     lon −43.21 → floor −44 → W044
 *     lat  −0.50  → floor  −1 → S01      lon  −0.10 → floor  −1 → W001
 *
 *   Exact integers belong to the tile they open: lat 46.0 is the SOUTH edge of
 *   N46, not the north edge of N45 — even though N45's last row holds the same
 *   line of samples. That duplication is real: neighbouring tiles SHARE their
 *   boundary row/column, and both copies must agree.
 *
 *   Degrees are zero padded: 2 digits for latitude, 3 for longitude.
 *   Longitude wraps into [−180, 180) first, so lon 180 and lon −180 both name
 *   W180 rather than a nonexistent E180.
 */

import { HgtTile, parseHgtTile } from './hgt-tile.js';
import { ProviderError } from './errors.js';

/** The south-west corner a tile name encodes. */
export interface TileCorner {
  readonly southLat: number;
  readonly westLon: number;
}

const TILE_NAME_PATTERN = /^([NS])(\d{2})([EW])(\d{3})$/;

/** Normalise longitude into [−180, 180). */
export function normaliseLon(lon: number): number {
  const wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  // `-0` would format as "E000" via Object.is checks elsewhere; fold it to 0.
  return wrapped === 0 ? 0 : wrapped;
}

/** The south-west corner of the tile containing this coordinate. */
export function tileCornerFor(lat: number, lon: number): TileCorner {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new ProviderError('bad-tile', `Cannot name a tile for lat ${lat}, lon ${lon}`);
  }
  if (lat < -90 || lat > 90) {
    throw new ProviderError('bad-tile', `Latitude ${lat} is outside [−90, 90]`);
  }
  // At the north pole floor(90) = 90 would name a tile spanning 90…91, which
  // does not exist; the pole belongs to the tile below it.
  const southLat = lat === 90 ? 89 : Math.floor(lat);
  return { southLat, westLon: Math.floor(normaliseLon(lon)) };
}

/** `N45E007`-style name of the tile containing this coordinate. */
export function tileNameFor(lat: number, lon: number): string {
  return tileNameForCorner(tileCornerFor(lat, lon));
}

/** Format a south-west corner as a tile name. */
export function tileNameForCorner(corner: TileCorner): string {
  const { southLat, westLon } = corner;
  const ns = southLat < 0 ? 'S' : 'N';
  const ew = westLon < 0 ? 'W' : 'E';
  return (
    `${ns}${String(Math.abs(southLat)).padStart(2, '0')}` +
    `${ew}${String(Math.abs(westLon)).padStart(3, '0')}`
  );
}

/** Parse `N45E007` into its south-west corner. Returns `null` if it is not a tile name. */
export function parseTileName(name: string): TileCorner | null {
  const match = TILE_NAME_PATTERN.exec(name.trim().toUpperCase());
  if (match === null) return null;
  const [, ns, latText, ew, lonText] = match;
  if (ns === undefined || latText === undefined || ew === undefined || lonText === undefined) {
    return null;
  }
  const lat = Number.parseInt(latText, 10);
  const lon = Number.parseInt(lonText, 10);
  if (lat > 90 || lon > 180) return null;
  return { southLat: ns === 'S' ? -lat : lat, westLon: ew === 'W' ? -lon : lon };
}

/** Parse tile bytes using the geometry implied by the tile's name. */
export function parseNamedTile(name: string, bytes: Uint8Array): HgtTile {
  const corner = parseTileName(name);
  if (corner === null) {
    throw new ProviderError('bad-tile', `"${name}" is not an SRTM tile name (expected e.g. N45E007)`);
  }
  return parseHgtTile(bytes, corner, name.toUpperCase());
}

/** A latitude/longitude rectangle, edges inclusive. */
export interface TileBounds {
  readonly south: number;
  readonly north: number;
  readonly west: number;
  readonly east: number;
}

/**
 * Every tile name needed to cover a bounding box.
 *
 * The box is walked in whole degrees from `floor(south)` to `floor(north)`; a
 * north edge that lands exactly on an integer degree still needs the tile above
 * only if the box has height there, so the loop uses the corner of the north
 * edge itself. East of the antimeridian the box is walked the short way round.
 */
export function tileNamesForBounds(bounds: TileBounds): readonly string[] {
  const { south, north } = bounds;
  if (north < south) {
    throw new ProviderError('bad-tile', `Bounds have north ${north} below south ${south}`);
  }
  const latStart = tileCornerFor(south, 0).southLat;
  const latEnd = tileCornerFor(north, 0).southLat;

  const west = normaliseLon(bounds.west);
  const east = normaliseLon(bounds.east);
  const lonStart = Math.floor(west);
  // Width in degrees, going east; a box crossing the antimeridian has east < west.
  const width = east >= west ? east - west : east + 360 - west;
  const lonCount = Math.floor(west + width) - lonStart + 1;

  const names: string[] = [];
  for (let lat = latStart; lat <= latEnd; lat += 1) {
    for (let i = 0; i < lonCount; i += 1) {
      names.push(tileNameForCorner({ southLat: lat, westLon: Math.floor(normaliseLon(lonStart + i)) }));
    }
  }
  return names;
}

/**
 * Where tiles come from. Async because the production implementation reads (and
 * may one day download) files; `MemoryTileStore` resolves immediately.
 *
 * A tile that is simply not held is `null`, not an error: "we have no data for
 * that square" is a normal, expected answer that callers must handle anyway.
 */
export interface TileStore {
  /** The tile covering this coordinate, or `null` if it is not available. */
  tileFor(lat: number, lon: number): Promise<HgtTile | null>;
  /** The named tile, or `null`. */
  tileByName(name: string): Promise<HgtTile | null>;
}

/** A store over tiles already in memory. Pure — usable in the browser and in tests. */
export class MemoryTileStore implements TileStore {
  private readonly tiles = new Map<string, HgtTile>();

  constructor(tiles: Iterable<readonly [string, HgtTile]> = []) {
    for (const [name, tile] of tiles) this.tiles.set(name.toUpperCase(), tile);
  }

  /** Add or replace a tile. Returns `this` so setup reads as one expression. */
  set(name: string, tile: HgtTile): this {
    this.tiles.set(name.toUpperCase(), tile);
    return this;
  }

  get names(): readonly string[] {
    return [...this.tiles.keys()].sort();
  }

  tileByName(name: string): Promise<HgtTile | null> {
    return Promise.resolve(this.tiles.get(name.trim().toUpperCase()) ?? null);
  }

  tileFor(lat: number, lon: number): Promise<HgtTile | null> {
    return this.tileByName(tileNameFor(lat, lon));
  }
}
