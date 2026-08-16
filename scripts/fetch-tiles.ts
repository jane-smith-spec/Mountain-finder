/**
 * Download SRTM elevation tiles into `data/tiles/` — an ACQUISITION tool.
 *
 * This is one of the two scripts allowed to touch the network (the other is
 * `record-fixtures.ts`). Nothing in `src/` and no test may fetch anything; the
 * product reads tiles that this script has already put on disk.
 *
 * SOURCE. The AWS public-dataset mirror of SRTM, "skadi" layout:
 *
 *   https://s3.amazonaws.com/elevation-tiles-prod/skadi/<BAND>/<TILE>.hgt.gz
 *
 * where `<TILE>` is named for its SOUTH-WEST corner (`N45E007` covers
 * lat 45…46, lon 7…8) and `<BAND>` is the tile's latitude part (`N45`).
 * Ocean squares simply do not exist there and return 404 — that is expected and
 * reported, not a failure of the run.
 *
 * USAGE
 *   npm run fetch:tiles -- N45E007 N46E007
 *   npm run fetch:tiles -- --bbox 45.90,7.60,46.10,7.90      # south,west,north,east
 *   npm run fetch:tiles -- --around 45.976,7.659 --radius-km 20
 *   flags: --dir <path> (default data/tiles)  --force  --keep-gz  --dry-run
 *
 * Tiles already present are skipped, so re-running is cheap and safe.
 */

import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VOID_SAMPLE,
  decodeBigEndianInt16,
  gridSizeForByteLength,
} from '../src/providers/hgt-tile.js';
import { parseTileName, tileNamesForBounds, tileNameFor } from '../src/providers/tile-store.js';

const S3_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/skadi';
const DEFAULT_DIR = 'data/tiles';

/** Metres per degree of latitude — good to 0.5% anywhere, plenty for picking tiles. */
const KM_PER_DEG_LAT = 111.32;

export function tileUrl(name: string): string {
  const upper = name.toUpperCase();
  if (parseTileName(upper) === null) {
    throw new Error(`"${name}" is not an SRTM tile name (expected e.g. N45E007)`);
  }
  return `${S3_BASE}/${upper.slice(0, 3)}/${upper}.hgt.gz`;
}

interface Options {
  readonly names: readonly string[];
  readonly dir: string;
  readonly force: boolean;
  readonly keepGz: boolean;
  readonly dryRun: boolean;
}

export function parseArgs(argv: readonly string[]): Options {
  const names = new Set<string>();
  let dir = DEFAULT_DIR;
  let force = false;
  let keepGz = false;
  let dryRun = false;
  let around: { lat: number; lon: number } | null = null;
  let radiusKm = 0;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case '--dir': {
        dir = required(argv[i + 1], '--dir');
        i += 1;
        break;
      }
      case '--bbox': {
        for (const name of tileNamesForBounds(parseBbox(required(argv[i + 1], '--bbox')))) {
          names.add(name);
        }
        i += 1;
        break;
      }
      case '--around': {
        around = parseLatLon(required(argv[i + 1], '--around'));
        i += 1;
        break;
      }
      case '--radius-km': {
        radiusKm = Number(required(argv[i + 1], '--radius-km'));
        i += 1;
        break;
      }
      case '--force':
        force = true;
        break;
      case '--keep-gz':
        keepGz = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      default: {
        if (arg.startsWith('--')) throw new Error(`Unknown flag ${arg}`);
        names.add(arg.toUpperCase());
      }
    }
  }

  if (around !== null) {
    if (!Number.isFinite(radiusKm) || radiusKm < 0) {
      throw new Error('--radius-km must be a non-negative number');
    }
    if (radiusKm === 0) {
      names.add(tileNameFor(around.lat, around.lon));
    } else {
      for (const name of tileNamesForBounds(boundsAround(around, radiusKm))) names.add(name);
    }
  }

  for (const name of names) {
    if (parseTileName(name) === null) {
      throw new Error(`"${name}" is not an SRTM tile name (expected e.g. N45E007)`);
    }
  }
  return { names: [...names].sort(), dir, force, keepGz, dryRun };
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return value;
}

function parseBbox(text: string): { south: number; west: number; north: number; east: number } {
  const parts = text.split(',').map((p) => Number(p.trim()));
  const [south, west, north, east] = parts;
  if (
    parts.length !== 4 ||
    south === undefined ||
    west === undefined ||
    north === undefined ||
    east === undefined ||
    parts.some((n) => !Number.isFinite(n))
  ) {
    throw new Error(`--bbox wants south,west,north,east — got "${text}"`);
  }
  return { south, west, north, east };
}

function parseLatLon(text: string): { lat: number; lon: number } {
  const parts = text.split(',').map((p) => Number(p.trim()));
  const [lat, lon] = parts;
  if (parts.length !== 2 || lat === undefined || lon === undefined || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`--around wants lat,lon — got "${text}"`);
  }
  return { lat, lon };
}

/**
 * A degree box that contains the circle of `radiusKm` around a point. Longitude
 * degrees shrink with cos(lat), so the box widens toward the poles; clamped to a
 * whole hemisphere at extreme latitudes where the circle wraps.
 */
export function boundsAround(
  centre: { readonly lat: number; readonly lon: number },
  radiusKm: number,
): { south: number; west: number; north: number; east: number } {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const south = Math.max(-90, centre.lat - dLat);
  const north = Math.min(90, centre.lat + dLat);
  const cos = Math.cos((Math.max(Math.abs(south), Math.abs(north)) * Math.PI) / 180);
  const dLon = cos < 1e-6 ? 180 : Math.min(180, dLat / cos);
  return { south, north, west: centre.lon - dLon, east: centre.lon + dLon };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

interface TileReport {
  readonly name: string;
  readonly outcome: 'downloaded' | 'skipped' | 'missing' | 'failed' | 'planned';
  readonly detail: string;
}

async function fetchTile(name: string, options: Options): Promise<TileReport> {
  const url = tileUrl(name);
  const target = join(options.dir, `${name}.hgt`);

  if (!options.force && (await exists(target))) {
    const stats = await stat(target);
    return { name, outcome: 'skipped', detail: `${target} already present (${stats.size} bytes)` };
  }
  if (options.dryRun) return { name, outcome: 'planned', detail: url };

  const response = await fetch(url);
  if (response.status === 404) {
    return { name, outcome: 'missing', detail: `404 — no such tile (all ocean?) ${url}` };
  }
  if (!response.ok) {
    return { name, outcome: 'failed', detail: `HTTP ${response.status} ${url}` };
  }

  const gz = new Uint8Array(await response.arrayBuffer());
  const raw = gunzipSync(gz);
  // Validate BEFORE the file lands under its final name: a truncated download
  // that keeps the .hgt extension is indistinguishable from a good one later.
  const size = gridSizeForByteLength(raw.length, name);

  await mkdir(options.dir, { recursive: true });
  const temp = `${target}.part`;
  await writeFile(temp, raw);
  await rename(temp, target);
  if (options.keepGz) await writeFile(join(options.dir, `${name}.hgt.gz`), gz);

  const voids = countVoids(raw);
  return {
    name,
    outcome: 'downloaded',
    detail:
      `${raw.length} bytes, ${size}×${size} (${size === 3601 ? 'SRTM1 1″' : size === 1201 ? 'SRTM3 3″' : 'non-standard'}), ` +
      `${voids} void samples (${((voids / (size * size)) * 100).toFixed(2)}%)`,
  };
}

function countVoids(raw: Uint8Array): number {
  const samples = decodeBigEndianInt16(raw);
  let voids = 0;
  for (const value of samples) if (value === VOID_SAMPLE) voids += 1;
  return voids;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.names.length === 0) {
    process.stdout.write(
      'Nothing to fetch. Name tiles (N45E007), or use --bbox south,west,north,east, ' +
        'or --around lat,lon --radius-km N.\n',
    );
    return;
  }

  process.stdout.write(`Fetching ${options.names.length} tile(s) into ${options.dir}\n`);
  const reports: TileReport[] = [];
  for (const name of options.names) {
    process.stdout.write(`  ${name} … `);
    try {
      const report = await fetchTile(name, options);
      reports.push(report);
      process.stdout.write(`${report.outcome}: ${report.detail}\n`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reports.push({ name, outcome: 'failed', detail });
      process.stdout.write(`failed: ${detail}\n`);
    }
  }

  const counts = new Map<string, number>();
  for (const report of reports) counts.set(report.outcome, (counts.get(report.outcome) ?? 0) + 1);
  process.stdout.write(
    `Done: ${[...counts].map(([outcome, n]) => `${n} ${outcome}`).join(', ')}\n`,
  );
  if ((counts.get('failed') ?? 0) > 0) process.exitCode = 1;
}

/**
 * Only run when executed directly. Importing this module (to reuse `tileUrl` or
 * `parseArgs`) must never start a download — tests are offline.
 */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
