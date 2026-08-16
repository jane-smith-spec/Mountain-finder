/**
 * Import named summits from Overture Maps into a local peak dataset —
 * an ACQUISITION tool, in the same family as `fetch-tiles.ts`.
 *
 * This is one of the scripts allowed to touch the network. Nothing in `src/`
 * and no test fetches anything: the product reads a dataset this script has
 * already written (decision D7, offline-first).
 *
 * ── SOURCE ────────────────────────────────────────────────────────────────
 *   https://overturemaps-us-west-2.s3.amazonaws.com/release/<RELEASE>/
 *       theme=base/type=land/part-NNNNN-<uuid>-c000.zstd.parquet
 *
 * The 2026-06-17.0 release splits `type=land` into 32 parts totalling 29.5 GB.
 * Downloading any one of them would be the wrong shape, so this script never
 * does. It reads each part's Parquet footer (≤ 512 KiB, ~0.06% of a part),
 * keeps only the row groups whose bbox statistics intersect the wanted area,
 * and reads only six of the thirteen top-level columns from those — skipping
 * `geometry`, which is ~96% of the bytes. See `src/providers/overture-parquet.ts`
 * for why that is possible and `src/providers/overture-peaks.ts` for what a
 * summit looks like in this schema.
 *
 * The run prints bytes fetched against total part size, because that ratio is
 * the only honest evidence that the pruning is real.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────
 *   npm run fetch:peaks -- --region zermatt
 *   npm run fetch:peaks -- --around 46.0207,7.7491 --radius-km 60 --name zermatt
 *   npm run fetch:peaks -- --bbox 45.7,7.3,46.3,8.1 --name upper-valais
 *   flags: --out <dir>  --release <id>  --classes peak,volcano
 *          --dry-run (footers only: prints the plan and the byte cost)
 *          --no-cache (re-read footers from S3 instead of data/overture/)
 *
 * Footers are cached under `data/overture/footers/<release>/` (gitignored), so
 * a second region costs only the column reads.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SUMMIT_CLASSES,
  OVERTURE_LAND_COLUMNS,
  emptyRejectionCounts,
  importOvertureRows,
  type DegreeBox,
  type OvertureRejection,
} from '../src/providers/overture-peaks.js';
import {
  CountingRangeBuffer,
  planParquetRead,
  readParquetMetadata,
  readRowGroup,
  type AsyncBuffer,
  type FileMetaData,
} from '../src/providers/overture-parquet.js';
import type { PeakRecord, PeakSourceRecord } from '../src/providers/peak-store.js';
import {
  boundingBoxAround,
  cellNameForPeak,
  parsePeakCellIndex,
  type PeakCellEntry,
  type PeakCellIndex,
} from '../src/providers/peak-tile-store.js';

const BUCKET_URL = 'https://overturemaps-us-west-2.s3.amazonaws.com';
const DEFAULT_RELEASE = '2026-06-17.0';
const THEME_PREFIX = 'theme=base/type=land/';
const DEFAULT_OUT_ROOT = 'fixtures/peaks/regions';
const FOOTER_CACHE_ROOT = 'data/overture/footers';

/** How much of a part's tail is read to find the footer. hyparquet's own default. */
const FOOTER_TAIL_BYTES = 1 << 19;

/**
 * Named regions, so the common runs are one flag and are reproducible.
 *
 * Radii are chosen against `DEFAULT_PEAK_RADIUS_KM = 200` in the pipeline: a
 * region has to reach at least that far from its viewpoints or the app will ask
 * for summits the dataset was never cut wide enough to hold. `zermatt` is
 * deliberately smaller — it is the demonstration region, sized so its cells can
 * be committed as a fixture.
 */
const REGIONS: Readonly<Record<string, { readonly area: DegreeBox; readonly note: string }>> = {
  zermatt: {
    // The Gornergrat ground-truth viewpoint (45.9833, 7.7833) plus the summits
    // the case names, with room for the whole Monte Rosa / Mischabel skyline.
    area: { south: 45.6, west: 7.2, north: 46.4, east: 8.2 },
    note: 'Upper Valais: the Gornergrat acceptance case and the terrain tiles N45E007/N46E007.',
  },
  'mont-blanc': {
    area: { south: 45.5, west: 6.5, north: 46.2, east: 7.3 },
    note: 'Chamonix / Mont Blanc massif.',
  },
  'fort-william': {
    area: { south: 56.3, west: -5.7, north: 57.2, east: -4.5 },
    note: 'Lochaber: the Fort William acceptance case, Ben Nevis and Cow Hill.',
  },
};

interface Options {
  readonly area: DegreeBox;
  readonly name: string;
  readonly outDir: string;
  readonly release: string;
  readonly classes: readonly string[];
  readonly dryRun: boolean;
  readonly useCache: boolean;
  readonly note: string;
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return value;
}

function parseNumbers(text: string, count: number, flag: string): readonly number[] {
  const parts = text.split(',').map((part) => Number(part.trim()));
  if (parts.length !== count || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`${flag} wants ${count} comma-separated numbers — got "${text}"`);
  }
  return parts;
}

export function parseArgs(argv: readonly string[]): Options {
  let area: DegreeBox | null = null;
  let name: string | null = null;
  let note = '';
  let around: { lat: number; lon: number } | null = null;
  let radiusKm = 0;
  let outRoot = DEFAULT_OUT_ROOT;
  let outDir: string | null = null;
  let release = DEFAULT_RELEASE;
  let classes = DEFAULT_SUMMIT_CLASSES;
  let dryRun = false;
  let useCache = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case '--region': {
        const key = required(argv[i + 1], '--region');
        const region = REGIONS[key];
        if (region === undefined) {
          throw new Error(`Unknown region "${key}". Known: ${Object.keys(REGIONS).join(', ')}`);
        }
        area = region.area;
        note = region.note;
        name ??= key;
        i += 1;
        break;
      }
      case '--bbox': {
        const [south, west, north, east] = parseNumbers(
          required(argv[i + 1], '--bbox'),
          4,
          '--bbox',
        ) as [number, number, number, number];
        area = { south, west, north, east };
        i += 1;
        break;
      }
      case '--around': {
        const [lat, lon] = parseNumbers(required(argv[i + 1], '--around'), 2, '--around') as [
          number,
          number,
        ];
        around = { lat, lon };
        i += 1;
        break;
      }
      case '--radius-km': {
        radiusKm = Number(required(argv[i + 1], '--radius-km'));
        i += 1;
        break;
      }
      case '--name': {
        name = required(argv[i + 1], '--name');
        i += 1;
        break;
      }
      case '--out': {
        outDir = required(argv[i + 1], '--out');
        i += 1;
        break;
      }
      case '--out-root': {
        outRoot = required(argv[i + 1], '--out-root');
        i += 1;
        break;
      }
      case '--release': {
        release = required(argv[i + 1], '--release');
        i += 1;
        break;
      }
      case '--classes': {
        classes = required(argv[i + 1], '--classes')
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '');
        i += 1;
        break;
      }
      case '--dry-run':
        dryRun = true;
        break;
      case '--no-cache':
        useCache = false;
        break;
      default:
        throw new Error(`Unknown flag ${arg}`);
    }
  }

  if (around !== null) {
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
      throw new Error('--around needs --radius-km with a positive value');
    }
    area = boundingBoxAround(around, radiusKm);
    note ||= `Within ${radiusKm} km of ${around.lat}, ${around.lon}.`;
  }
  if (area === null) {
    throw new Error('Name an area: --region <name>, --bbox s,w,n,e, or --around lat,lon --radius-km N');
  }
  if (area.north < area.south) {
    throw new Error(`--bbox north ${area.north} is below south ${area.south}`);
  }
  if (area.east < area.west) {
    throw new Error(
      `--bbox east ${area.east} is west of west ${area.west}; ` +
        'an antimeridian-crossing area must be fetched as two runs',
    );
  }
  if (name === null) throw new Error('--name is required unless --region supplies one');
  if (classes.length === 0) throw new Error('--classes must name at least one class');

  return {
    area,
    name,
    outDir: outDir ?? join(outRoot, name),
    release,
    classes,
    dryRun,
    useCache,
    note,
  };
}

interface PartListing {
  readonly key: string;
  readonly fileName: string;
  readonly size: number;
}

/** List the parts of one release from S3. XML, because that is what S3 speaks. */
export function parseListing(xml: string): readonly PartListing[] {
  const parts: PartListing[] = [];
  for (const block of xml.split('<Contents>').slice(1)) {
    const key = /<Key>([^<]+)<\/Key>/.exec(block)?.[1];
    const size = /<Size>(\d+)<\/Size>/.exec(block)?.[1];
    if (key === undefined || size === undefined) continue;
    if (!key.endsWith('.parquet')) continue;
    const fileName = key.slice(key.lastIndexOf('/') + 1);
    parts.push({ key, fileName, size: Number(size) });
  }
  return parts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

async function listParts(release: string): Promise<readonly PartListing[]> {
  const prefix = `release/${release}/${THEME_PREFIX}`;
  const url = `${BUCKET_URL}/?list-type=2&max-keys=1000&prefix=${encodeURIComponent(prefix)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} listing ${prefix}`);
  const parts = parseListing(await response.text());
  if (parts.length === 0) throw new Error(`No parquet parts under ${prefix}`);
  if (parts.some((part) => part.key !== `${prefix}${part.fileName}`)) {
    throw new Error('S3 listing returned keys outside the requested prefix');
  }
  return parts;
}

/**
 * An `AsyncBuffer` over a cached tail. Reports the part's real length so the
 * footer offsets are the file's, but refuses any read outside the cached range
 * — a silent zero-fill there would be indistinguishable from real bytes.
 */
function tailBuffer(byteLength: number, tail: Uint8Array): AsyncBuffer {
  const tailStart = byteLength - tail.byteLength;
  return {
    byteLength,
    slice(start: number, end?: number): ArrayBuffer {
      const from = Math.max(0, Math.trunc(start));
      const to = end === undefined ? byteLength : Math.min(byteLength, Math.trunc(end));
      if (from < tailStart) {
        throw new Error(
          `cached footer holds only the last ${tail.byteLength} bytes; asked for ${from}…${to}`,
        );
      }
      const slice = tail.slice(from - tailStart, to - tailStart);
      return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
    },
  };
}

/** Read `metadataLength` out of the last 8 bytes of a tail. */
function metadataLengthFromTail(tail: Uint8Array): number {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  if (view.getUint32(tail.byteLength - 4, true) !== 0x31524150) {
    throw new Error('parquet footer magic PAR1 missing — is this a parquet file?');
  }
  return view.getUint32(tail.byteLength - 8, true);
}

interface FooterResult {
  readonly metadata: FileMetaData;
  readonly bytesFetched: number;
  readonly cached: boolean;
}

async function loadFooter(
  part: PartListing,
  buffer: CountingRangeBuffer,
  cacheDir: string,
  useCache: boolean,
): Promise<FooterResult> {
  const cachePath = join(cacheDir, `${part.fileName}.tail`);
  if (useCache) {
    try {
      const cached = await readFile(cachePath);
      const metadata = await readParquetMetadata(tailBuffer(part.size, cached));
      return { metadata, bytesFetched: 0, cached: true };
    } catch {
      // fall through and fetch
    }
  }

  const before = buffer.bytesFetched;
  let tailBytes = Math.min(FOOTER_TAIL_BYTES, part.size);
  let tail = new Uint8Array(await buffer.slice(part.size - tailBytes, part.size));
  const metadataLength = metadataLengthFromTail(tail);
  if (metadataLength + 8 > tailBytes) {
    tailBytes = Math.min(part.size, metadataLength + 8);
    tail = new Uint8Array(await buffer.slice(part.size - tailBytes, part.size));
  }
  const metadata = await readParquetMetadata(tailBuffer(part.size, tail));
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, tail);
  return { metadata, bytesFetched: buffer.bytesFetched - before, cached: false };
}

interface PartReport {
  readonly fileName: string;
  readonly size: number;
  readonly rowGroups: number;
  readonly hitGroups: number;
  readonly plannedBytes: number;
  readonly plannedBytesAllColumns: number;
  readonly bytesFetched: number;
  readonly footerCached: boolean;
  readonly peaks: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} kB`;
  return `${bytes} B`;
}

function sourceRecord(release: string, area: DegreeBox, retrieved: string): PeakSourceRecord {
  return {
    id: `overture-${release}-base-land`,
    title:
      `Overture Maps Foundation, base theme, type=land, release ${release} — ` +
      'summit features (subtype=physical, class=peak|volcano), © OpenStreetMap contributors, ODbL-1.0',
    url: `${BUCKET_URL}/release/${release}/${THEME_PREFIX}`,
    retrieved,
    access: 'fetched',
    note:
      'Position is the midpoint of Overture\'s float32-rounded `bbox` (sub-metre for a point ' +
      'feature); height is the `elevation` column, which carries the OpenStreetMap `ele` tag ' +
      'unchanged — verified row-by-row against the same rows\' `source_tags.ele`. Heights are ' +
      'therefore tagged/surveyed values, NEVER DEM samples (MISSION.md: SRTM under-reads sharp ' +
      `summits by 250–350 m). Area imported: ${area.south},${area.west} … ${area.north},${area.east}.`,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { area } = options;
  const retrieved = new Date().toISOString().slice(0, 10);

  process.stdout.write(
    `Overture peak import — release ${options.release}\n` +
      `  area    ${area.south}…${area.north} lat, ${area.west}…${area.east} lon\n` +
      `  classes ${options.classes.join(', ')} (subtype=physical)\n` +
      `  columns ${OVERTURE_LAND_COLUMNS.join(', ')}\n` +
      `  out     ${options.outDir}\n\n`,
  );

  const parts = await listParts(options.release);
  const totalSize = parts.reduce((sum, part) => sum + part.size, 0);
  process.stdout.write(
    `${parts.length} parts, ${formatBytes(totalSize)} in total. Reading footers…\n\n`,
  );

  const cacheDir = join(FOOTER_CACHE_ROOT, options.release);
  const reports: PartReport[] = [];
  const rejected = emptyRejectionCounts();
  const records = new Map<string, PeakRecord>();
  let duplicates = 0;
  let bytesFetched = 0;

  for (const part of parts) {
    const buffer = new CountingRangeBuffer(`${BUCKET_URL}/${part.key}`, part.size, (url, init) =>
      fetch(url, init),
    );
    const footer = await loadFooter(part, buffer, cacheDir, options.useCache);
    const plan = planParquetRead(footer.metadata, area, OVERTURE_LAND_COLUMNS);

    let peaksHere = 0;
    if (!options.dryRun) {
      for (const group of plan.groups) {
        const rows = await readRowGroup(buffer, footer.metadata, group, OVERTURE_LAND_COLUMNS);
        const imported = importOvertureRows(rows, {
          classes: options.classes,
          area,
          sourceId: sourceRecord(options.release, area, retrieved).id,
        });
        for (const [reason, count] of Object.entries(imported.rejected)) {
          rejected[reason as OvertureRejection] += count;
        }
        duplicates += imported.duplicates;
        for (const record of imported.peaks) {
          if (records.has(record.id)) {
            duplicates += 1;
            continue;
          }
          records.set(record.id, record);
          peaksHere += 1;
        }
      }
    }

    bytesFetched += buffer.bytesFetched;
    reports.push({
      fileName: part.fileName,
      size: part.size,
      rowGroups: plan.totalRowGroups,
      hitGroups: plan.groups.length,
      plannedBytes: plan.plannedBytes,
      plannedBytesAllColumns: plan.plannedBytesAllColumns,
      bytesFetched: buffer.bytesFetched,
      footerCached: footer.cached,
      peaks: peaksHere,
    });

    const label = part.fileName.slice(0, 10);
    if (plan.groups.length === 0) {
      process.stdout.write(
        `  ${label}  ${String(plan.totalRowGroups).padStart(3)} groups, 0 intersect — pruned ` +
          `(${footer.cached ? 'footer cached' : formatBytes(footer.bytesFetched) + ' footer'})\n`,
      );
    } else {
      process.stdout.write(
        `  ${label}  ${String(plan.groups.length).padStart(3)}/${plan.totalRowGroups} groups intersect · ` +
          `plan ${formatBytes(plan.plannedBytes)} of ${formatBytes(plan.plannedBytesAllColumns)} in those groups ` +
          `(part is ${formatBytes(part.size)}) · fetched ${formatBytes(buffer.bytesFetched)} · ${peaksHere} peaks\n`,
      );
    }
  }

  process.stdout.write('\n');
  const peaks = [...records.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  reportTotals(reports, totalSize, bytesFetched, peaks.length, rejected, duplicates);

  if (options.dryRun) {
    process.stdout.write('\n--dry-run: footers only, nothing written.\n');
    return;
  }
  if (peaks.length === 0) {
    process.stdout.write('\nNo summits in this area — nothing written.\n');
    process.exitCode = 1;
    return;
  }

  const index = await writeDataset(options, peaks, sourceRecord(options.release, area, retrieved));
  process.stdout.write(
    `\nWrote ${index.peakCount} peaks across ${index.cells.length} cells to ${options.outDir}\n`,
  );
}

function reportTotals(
  reports: readonly PartReport[],
  totalSize: number,
  bytesFetched: number,
  peaks: number,
  rejected: Readonly<Record<OvertureRejection, number>>,
  duplicates: number,
): void {
  const touched = reports.filter((report) => report.hitGroups > 0);
  const touchedSize = touched.reduce((sum, report) => sum + report.size, 0);
  const naiveBytes = touched.reduce((sum, report) => sum + report.plannedBytesAllColumns, 0);
  process.stdout.write(
    'Byte accounting — the number that proves the pruning:\n' +
      `  release total        ${formatBytes(totalSize)} across ${reports.length} parts\n` +
      `  parts touched        ${touched.length} (${formatBytes(touchedSize)})\n` +
      `  row groups read      ${touched.reduce((s, r) => s + r.hitGroups, 0)} of ` +
      `${reports.reduce((s, r) => s + r.rowGroups, 0)}\n` +
      `  those groups, whole  ${formatBytes(naiveBytes)}\n` +
      `  BYTES FETCHED        ${formatBytes(bytesFetched)} ` +
      `= ${((bytesFetched / totalSize) * 100).toFixed(4)}% of the release, ` +
      `${((bytesFetched / Math.max(1, touchedSize)) * 100).toFixed(3)}% of the parts touched\n` +
      `  summits kept         ${peaks}\n`,
  );
  const dropped = Object.entries(rejected).filter(([, count]) => count > 0);
  if (dropped.length > 0) {
    process.stdout.write(
      `  rows dropped         ${dropped.map(([reason, count]) => `${reason} ${count}`).join(', ')}\n`,
    );
  }
  if (duplicates > 0) process.stdout.write(`  duplicate ids        ${duplicates}\n`);
}

async function writeDataset(
  options: Options,
  peaks: readonly PeakRecord[],
  source: PeakSourceRecord,
): Promise<PeakCellIndex> {
  const byCell = new Map<string, PeakRecord[]>();
  for (const peak of peaks) {
    const cell = cellNameForPeak(peak);
    const bucket = byCell.get(cell);
    if (bucket === undefined) byCell.set(cell, [peak]);
    else bucket.push(peak);
  }

  const cellsDir = join(options.outDir, 'cells');
  await rm(cellsDir, { recursive: true, force: true });
  await mkdir(cellsDir, { recursive: true });

  const entries: PeakCellEntry[] = [];
  for (const name of [...byCell.keys()].sort()) {
    const cellPeaks = (byCell.get(name) ?? []).sort((a, b) => (a.id < b.id ? -1 : 1));
    const file = `cells/${name}.json`;
    await writeFile(
      join(options.outDir, file),
      `${JSON.stringify({ cell: name, peaks: cellPeaks }, null, 2)}\n`,
    );
    entries.push({ name, peaks: cellPeaks.length, file });
  }

  const index = {
    version: 1,
    description:
      `Named summits imported from Overture Maps for "${options.name}". ${options.note} ` +
      'Heights are OpenStreetMap `ele` tags carried through Overture, never DEM samples.',
    release: options.release,
    generatedBy: `npm run fetch:peaks -- ${process.argv.slice(2).join(' ')}`,
    bounds: options.area,
    sources: [source],
    cells: entries,
    peakCount: peaks.length,
  };
  // Validate what we are about to commit with the same parser the store uses,
  // so a malformed dataset never reaches disk looking usable.
  const parsed = parsePeakCellIndex(index, `${options.outDir}/index.json`);
  await writeFile(join(options.outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return parsed;
}

/** Only run when executed directly — importing this module must not fetch. */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
