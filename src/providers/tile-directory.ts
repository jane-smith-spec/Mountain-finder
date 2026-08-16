/**
 * Loading elevation tiles from disk.
 *
 * NODE ONLY — like `fixture-store.ts`, this is a filesystem edge. Everything the
 * web app imports (`hgt-tile.ts`, `tile-store.ts`, `tile-elevation.ts`) stays
 * pure, so a browser build can feed a `MemoryTileStore` from whatever storage it
 * has instead.
 *
 * Files are looked up as `<NAME>.hgt` first, then `<NAME>.hgt.gz` (the form S3
 * serves), transparently gunzipped. Tiles are big — 25 MB each for SRTM1 — so
 * the cache is a small LRU rather than an unbounded map.
 */

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join, dirname, isAbsolute } from 'node:path';

import { ProviderError } from './errors.js';
import { HgtTile, parseGridWindow, type GridGeometry } from './hgt-tile.js';
import { parseNamedTile, tileNameFor, type TileStore } from './tile-store.js';

export interface DirectoryTileStoreOptions {
  /**
   * How many parsed tiles to keep in memory. SRTM1 tiles cost ~26 MB each, so
   * the default is deliberately small; raise it for batch work on a desktop.
   */
  readonly maxCachedTiles?: number;
}

const DEFAULT_MAX_CACHED_TILES = 4;

/** Reads `<dir>/<NAME>.hgt[.gz]`, parses, and caches with an LRU. */
export class DirectoryTileStore implements TileStore {
  readonly directory: string;

  private readonly maxCachedTiles: number;

  /** name → parsed tile, or `null` for "checked, not present". Insertion order = LRU order. */
  private readonly cache = new Map<string, Promise<HgtTile | null>>();

  constructor(directory: string, options: DirectoryTileStoreOptions = {}) {
    this.directory = directory;
    this.maxCachedTiles = Math.max(1, options.maxCachedTiles ?? DEFAULT_MAX_CACHED_TILES);
  }

  /** Tile names currently held in memory, most recently used last. */
  get cachedNames(): readonly string[] {
    return [...this.cache.keys()];
  }

  tileFor(lat: number, lon: number): Promise<HgtTile | null> {
    return this.tileByName(tileNameFor(lat, lon));
  }

  tileByName(name: string): Promise<HgtTile | null> {
    const key = name.trim().toUpperCase();
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      // Refresh recency.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const loading = this.load(key);
    this.cache.set(key, loading);
    this.evictIfNeeded();
    return loading;
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxCachedTiles) {
      const oldest = this.cache.keys().next();
      if (oldest.done === true) return;
      this.cache.delete(oldest.value);
    }
  }

  private async load(name: string): Promise<HgtTile | null> {
    const plain = await readIfPresent(join(this.directory, `${name}.hgt`));
    if (plain !== null) return parseNamedTile(name, plain);

    const gzipped = await readIfPresent(join(this.directory, `${name}.hgt.gz`));
    if (gzipped !== null) return parseNamedTile(name, gunzip(gzipped, `${name}.hgt.gz`));

    return null;
  }
}

async function readIfPresent(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch (cause) {
    if (isNotFound(cause)) return null;
    throw new ProviderError('bad-tile', `Could not read ${path}`, { cause });
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function gunzip(bytes: Uint8Array, label: string): Uint8Array {
  try {
    return gunzipSync(bytes);
  } catch (cause) {
    throw new ProviderError('bad-tile', `${label} is not valid gzip`, { cause });
  }
}

/**
 * Sidecar describing a committed window of real tile data.
 *
 * The window is the same byte format as a `.hgt` (big-endian int16, row-major,
 * row 0 = north) but a rectangle rather than a whole degree, so its geometry has
 * to be written down rather than derived from a file length.
 */
export interface TileWindowMeta {
  readonly name: string;
  /** Relative path (next to the sidecar) of the raw sample bytes. */
  readonly data: string;
  readonly format: 'int16-be-row-major-north-first';
  readonly geometry: GridGeometry;
  readonly source: {
    readonly tile: string;
    readonly url: string;
    readonly dataset: string;
    readonly extractedFromRow: number;
    readonly extractedFromCol: number;
  };
}

function assertNumber(value: unknown, field: string, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProviderError('bad-tile', `${label}: ${field} must be a finite number`);
  }
  return value;
}

/** Validate a parsed sidecar. Exported so the generator and the tests share one schema. */
export function parseTileWindowMeta(value: unknown, label: string): TileWindowMeta {
  if (typeof value !== 'object' || value === null) {
    throw new ProviderError('bad-tile', `${label}: sidecar is not an object`);
  }
  const raw = value as Record<string, unknown>;
  const geometry = raw['geometry'];
  const source = raw['source'];
  if (typeof geometry !== 'object' || geometry === null) {
    throw new ProviderError('bad-tile', `${label}: sidecar has no geometry`);
  }
  if (typeof source !== 'object' || source === null) {
    throw new ProviderError('bad-tile', `${label}: sidecar has no source provenance`);
  }
  if (raw['format'] !== 'int16-be-row-major-north-first') {
    throw new ProviderError(
      'bad-tile',
      `${label}: unsupported window format ${String(raw['format'])}`,
    );
  }
  const g = geometry as Record<string, unknown>;
  const s = source as Record<string, unknown>;
  const data = raw['data'];
  const name = raw['name'];
  if (typeof data !== 'string' || typeof name !== 'string') {
    throw new ProviderError('bad-tile', `${label}: sidecar needs string name and data fields`);
  }
  return {
    name,
    data,
    format: 'int16-be-row-major-north-first',
    geometry: {
      northLat: assertNumber(g['northLat'], 'geometry.northLat', label),
      westLon: assertNumber(g['westLon'], 'geometry.westLon', label),
      rows: assertNumber(g['rows'], 'geometry.rows', label),
      cols: assertNumber(g['cols'], 'geometry.cols', label),
      latStepDeg: assertNumber(g['latStepDeg'], 'geometry.latStepDeg', label),
      lonStepDeg: assertNumber(g['lonStepDeg'], 'geometry.lonStepDeg', label),
    },
    source: {
      tile: String(s['tile'] ?? 'unknown'),
      url: String(s['url'] ?? 'unknown'),
      dataset: String(s['dataset'] ?? 'unknown'),
      extractedFromRow: assertNumber(s['extractedFromRow'], 'source.extractedFromRow', label),
      extractedFromCol: assertNumber(s['extractedFromCol'], 'source.extractedFromCol', label),
    },
  };
}

/** Load a window fixture from its sidecar path. Returns the grid and the metadata. */
export async function loadTileWindow(
  metaPath: string,
): Promise<{ readonly tile: HgtTile; readonly meta: TileWindowMeta }> {
  const meta = parseTileWindowMeta(
    JSON.parse(await readFile(metaPath, 'utf8')) as unknown,
    metaPath,
  );
  const dataPath = isAbsolute(meta.data) ? meta.data : join(dirname(metaPath), meta.data);
  const bytes = await readFile(dataPath);
  return { tile: parseGridWindow(bytes, meta.geometry, meta.name), meta };
}
