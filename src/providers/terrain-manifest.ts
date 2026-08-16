/**
 * The terrain index — how a BROWSER finds out what elevation data it has.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 * Decision D7 makes elevation an *acquisition-time* dependency: `.hgt` tiles on
 * disk, no live API at runtime. In Node that is `DirectoryTileStore`, which
 * reads a directory. A browser has no directory to read — it can only ask a
 * server for a URL, and it cannot enumerate one. So the served terrain
 * directory publishes a small JSON index of what it holds, and the browser
 * reads that first.
 *
 * The index is deliberately NOT a list of tile names. Every entry states its
 * full grid geometry, which buys three things:
 *
 *   1. **One code path for tiles and windows.** A whole SRTM1 tile is just a
 *      3601 × 3601 grid; the committed case windows (`fixtures/tiles/cases/`)
 *      are smaller rectangles of the same bytes. Both parse through
 *      `parseGridWindow`, so an app that ships a 728 KB window and an app
 *      serving 25 MB tiles run identical code.
 *   2. **Coverage is answerable BEFORE downloading anything.** "Is there
 *      terrain where this photo was taken" is a question about bounds, and the
 *      honest answer for "no" has to come cheaply and specifically — see
 *      `selectTerrainGrid`.
 *   3. **A truncated download cannot masquerade as data.** The index states the
 *      sample count, so `expectedGridByteLength` turns a half-fetched tile into
 *      an error instead of a plausible-looking grid of the wrong shape.
 *
 * Nothing here fetches. This module is pure — index in, bounds and choices out
 * — and the fetching lives in `http-terrain-store.ts`.
 */

import { ProviderError } from './errors.js';
import { BYTES_PER_SAMPLE, gridSizeForByteLength, type GridGeometry } from './hgt-tile.js';
import { parseTileName, type TileBounds } from './tile-store.js';
import { datasetLabelForStepDeg } from './tile-elevation.js';

/** Version of the index format this module understands. */
export const TERRAIN_MANIFEST_VERSION = 1;

/** Conventional path of the index inside the served terrain directory. */
export const DEFAULT_TERRAIN_MANIFEST_URL = '/terrain/manifest.json';

/** One grid of samples the server holds: a whole tile, or a window of one. */
export interface TerrainGrid {
  /** Diagnostic name — a tile name (`N45E007`) or a window name. */
  readonly name: string;
  /** Where the raw big-endian int16 samples live, relative to the index. */
  readonly url: string;
  /** Resolution label, e.g. `srtm1`. */
  readonly dataset: string;
  readonly geometry: GridGeometry;
  /** Optional provenance line, shown in diagnostics. */
  readonly source?: string;
}

export interface TerrainManifest {
  readonly version: typeof TERRAIN_MANIFEST_VERSION;
  readonly grids: readonly TerrainGrid[];
  /** Free text for whoever opens the JSON by hand. */
  readonly note?: string;
}

/**
 * Slack when testing whether a coordinate is inside a grid.
 *
 * Matches `HgtTile`'s own edge epsilon: 1e-9° ≈ 0.1 mm, far below any
 * meaningful position, but wide enough to absorb `northLat − rows × step`.
 */
const EDGE_EPSILON_DEG = 1e-9;

/** Bytes a grid of this geometry must have, exactly. */
export function expectedGridByteLength(geometry: GridGeometry): number {
  return geometry.rows * geometry.cols * BYTES_PER_SAMPLE;
}

/** The rectangle a grid covers, edges inclusive (row 0 is the north edge). */
export function terrainGridBounds(geometry: GridGeometry): TileBounds {
  return {
    north: geometry.northLat,
    south: geometry.northLat - (geometry.rows - 1) * geometry.latStepDeg,
    west: geometry.westLon,
    east: geometry.westLon + (geometry.cols - 1) * geometry.lonStepDeg,
  };
}

/**
 * Is this coordinate inside the grid?
 *
 * Longitude is compared MODULO 360, for the reason spelled out in
 * `tile-store.ts`: this repository deliberately runs two longitude seam
 * conventions, and a coordinate arriving as +180 must still land in `W180`.
 */
export function gridContains(geometry: GridGeometry, lat: number, lon: number): boolean {
  const bounds = terrainGridBounds(geometry);
  if (lat > bounds.north + EDGE_EPSILON_DEG || lat < bounds.south - EDGE_EPSILON_DEG) return false;
  const lonSpan = (geometry.cols - 1) * geometry.lonStepDeg;
  const offset = (((lon - geometry.westLon) % 360) + 360) % 360;
  return offset <= lonSpan + EDGE_EPSILON_DEG;
}

/** Square degrees a grid covers — the tie-break when several hold a point. */
export function gridAreaDeg2(geometry: GridGeometry): number {
  return (geometry.rows - 1) * geometry.latStepDeg * ((geometry.cols - 1) * geometry.lonStepDeg);
}

/**
 * The best grid covering a point, or `undefined` when none does.
 *
 * "Best" is the LARGEST coverage, not the smallest download and not the first
 * listed. A window is cut to the terrain one acceptance case turns on; it can
 * therefore produce a FALSE VISIBLE, because the ridge that would have blocked
 * a summit may lie outside the cut (`src/pipeline/testing/case-terrain.ts`
 * spells this out). Given the choice between a small window and the whole tile
 * it came from, the tile is the one that can prove an occlusion, so it wins —
 * and the cost of that choice is bandwidth, which is the right thing to spend.
 *
 * `undefined` is a first-class answer. There is deliberately no "nearest grid"
 * fallback: terrain from the next valley is not a degraded answer, it is a
 * wrong one, and the app says "no terrain here" instead.
 */
export function selectTerrainGrid(
  manifest: TerrainManifest,
  lat: number,
  lon: number,
): TerrainGrid | undefined {
  let best: TerrainGrid | undefined;
  let bestArea = -1;
  for (const grid of manifest.grids) {
    if (!gridContains(grid.geometry, lat, lon)) continue;
    const area = gridAreaDeg2(grid.geometry);
    if (area > bestArea) {
      best = grid;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Describe a whole `.hgt` file as a grid, from its NAME and its BYTE LENGTH.
 *
 * Both facts are needed and neither is guessed: the name gives the south-west
 * corner (floor semantics, both hemispheres — see `tile-store.ts`), and the
 * length gives the grid size, hence the sample spacing `1/(n−1)`.
 */
export function terrainGridForTileFile(
  name: string,
  byteLength: number,
  url: string,
): TerrainGrid {
  const corner = parseTileName(name);
  if (corner === null) {
    throw new ProviderError('bad-tile', `"${name}" is not an SRTM tile name (expected e.g. N45E007)`);
  }
  const size = gridSizeForByteLength(byteLength, name);
  const step = 1 / (size - 1);
  return {
    name: name.toUpperCase(),
    url,
    // Labelled from the spacing, so a whole tile and a window cut from it
    // report the same resolution — see `datasetLabelForStepDeg`.
    dataset: datasetLabelForStepDeg(step),
    geometry: {
      northLat: corner.southLat + 1,
      westLon: corner.westLon,
      rows: size,
      cols: size,
      latStepDeg: step,
      lonStepDeg: step,
    },
  };
}

function fail(label: string, detail: string): never {
  throw new ProviderError('bad-response', `${label}: ${detail}`);
}

function requireFiniteNumber(
  value: unknown,
  label: string,
  field: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(label, `grid geometry field "${field}" must be a finite number, got ${String(value)}`);
  }
  return value;
}

function parseGeometry(value: unknown, label: string): GridGeometry {
  if (typeof value !== 'object' || value === null) {
    fail(label, 'every grid needs a geometry object (northLat, westLon, rows, cols, steps)');
  }
  const raw = value as Record<string, unknown>;
  const rows = requireFiniteNumber(raw.rows, label, 'rows');
  const cols = requireFiniteNumber(raw.cols, label, 'cols');
  if (!Number.isInteger(rows) || rows < 2) fail(label, `rows must be an integer >= 2, got ${rows}`);
  if (!Number.isInteger(cols) || cols < 2) fail(label, `cols must be an integer >= 2, got ${cols}`);
  const latStepDeg = requireFiniteNumber(raw.latStepDeg, label, 'latStepDeg');
  const lonStepDeg = requireFiniteNumber(raw.lonStepDeg, label, 'lonStepDeg');
  if (latStepDeg <= 0 || lonStepDeg <= 0) {
    fail(label, `sample spacing must be positive, got ${latStepDeg} × ${lonStepDeg}`);
  }
  return {
    northLat: requireFiniteNumber(raw.northLat, label, 'northLat'),
    westLon: requireFiniteNumber(raw.westLon, label, 'westLon'),
    rows,
    cols,
    latStepDeg,
    lonStepDeg,
  };
}

/**
 * Validate an index fetched from the server.
 *
 * The index is *data crossing a boundary*, so it is checked at runtime rather
 * than merely typed — the same rule `peak-store.ts` follows for the peak
 * dataset. A malformed entry throws here, where the message can name the file,
 * instead of surfacing later as a grid of the wrong shape.
 */
export function parseTerrainManifest(value: unknown, label: string): TerrainManifest {
  if (typeof value !== 'object' || value === null) {
    fail(label, `expected a terrain index object, got ${value === null ? 'null' : typeof value}`);
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== TERRAIN_MANIFEST_VERSION) {
    fail(label, `unsupported index version ${String(raw.version)} (expected ${TERRAIN_MANIFEST_VERSION})`);
  }
  if (!Array.isArray(raw.grids)) fail(label, '"grids" must be an array');

  const grids: TerrainGrid[] = raw.grids.map((entry: unknown, index): TerrainGrid => {
    const where = `${label} grid[${index}]`;
    if (typeof entry !== 'object' || entry === null) fail(where, 'must be an object');
    const record = entry as Record<string, unknown>;
    const name = record.name;
    const url = record.url;
    const dataset = record.dataset;
    if (typeof name !== 'string' || name === '') fail(where, 'needs a non-empty "name"');
    if (typeof url !== 'string' || url === '') fail(where, 'needs a non-empty "url"');
    if (typeof dataset !== 'string' || dataset === '') fail(where, 'needs a non-empty "dataset"');
    const grid: TerrainGrid = {
      name,
      url,
      dataset,
      geometry: parseGeometry(record.geometry, `${where} (${name})`),
    };
    return typeof record.source === 'string' ? { ...grid, source: record.source } : grid;
  });

  const manifest: TerrainManifest = { version: TERRAIN_MANIFEST_VERSION, grids };
  return typeof raw.note === 'string' ? { ...manifest, note: raw.note } : manifest;
}
