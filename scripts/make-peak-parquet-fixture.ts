/**
 * Record a committed slice of real Overture Parquet — an ACQUISITION tool.
 *
 * Cuts the byte ranges that a single row-group read actually touches out of a
 * live Overture part and writes them, with a provenance sidecar, under
 * `fixtures/parquet/`. That is what lets `overture-parquet.test.ts` parse real
 * bytes in the real format with no network — the same standard
 * `fixtures/tiles/` holds for SRTM.
 *
 * WHAT IS RECORDED
 *   1. the last 512 KiB of the part (the Parquet footer — Overture's is
 *      511,495 bytes for part-00011, so it fits), and
 *   2. every column chunk of ONE row group belonging to the six columns the
 *      importer reads.
 *
 * Ranges are written in ascending file order, and the sidecar records each
 * one's original offsets, so the fixture can be replayed at the exact positions
 * the footer points at. See `src/providers/parquet-slice.ts`.
 *
 * USAGE
 *   npm run fixtures:peak-parquet
 *   flags: --release <id>  --part <file-name>  --at lat,lon  --out <dir>
 *
 * Default target: the row group of `part-00011` containing the Matterhorn, so
 * the fixture's contents can be checked against summit heights this repository
 * already cites in `fixtures/peaks/ground-truth-peaks.json`.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OVERTURE_LAND_COLUMNS,
  boxContains,
  type DegreeBox,
} from '../src/providers/overture-peaks.js';
import {
  CountingRangeBuffer,
  readParquetMetadata,
  rowGroupExtents,
} from '../src/providers/overture-parquet.js';
import {
  parseParquetSliceMeta,
  type ParquetSliceRange,
} from '../src/providers/parquet-slice.js';

const BUCKET_URL = 'https://overturemaps-us-west-2.s3.amazonaws.com';
const DEFAULT_RELEASE = '2026-06-17.0';
const THEME_PREFIX = 'theme=base/type=land/';
const DEFAULT_PART = 'part-00011-2a3be0da-0aa7-5a09-88d0-9c0cf1d3e21e-c000.zstd.parquet';
const DEFAULT_OUT = 'fixtures/parquet/overture-zermatt-rowgroup';
const FOOTER_TAIL_BYTES = 1 << 19;

/** The Matterhorn summit, as `fixtures/peaks/ground-truth-peaks.json` cites it. */
const DEFAULT_AT = { lat: 45.976389, lon: 7.658611 };

interface Options {
  readonly release: string;
  readonly part: string;
  readonly at: { readonly lat: number; readonly lon: number };
  readonly outDir: string;
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return value;
}

function parseArgs(argv: readonly string[]): Options {
  let release = DEFAULT_RELEASE;
  let part = DEFAULT_PART;
  let at = DEFAULT_AT;
  let outDir = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case '--release':
        release = required(argv[i + 1], '--release');
        i += 1;
        break;
      case '--part':
        part = required(argv[i + 1], '--part');
        i += 1;
        break;
      case '--out':
        outDir = required(argv[i + 1], '--out');
        i += 1;
        break;
      case '--at': {
        const parts = required(argv[i + 1], '--at')
          .split(',')
          .map((value) => Number(value.trim()));
        const [lat, lon] = parts;
        if (parts.length !== 2 || lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) {
          throw new Error('--at wants lat,lon');
        }
        at = { lat, lon };
        i += 1;
        break;
      }
      default:
        throw new Error(`Unknown flag ${arg}`);
    }
  }
  return { release, part, at, outDir };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const key = `release/${options.release}/${THEME_PREFIX}${options.part}`;
  const url = `${BUCKET_URL}/${key}`;

  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) throw new Error(`HTTP ${head.status} for HEAD ${url}`);
  const partByteLength = Number(head.headers.get('content-length'));
  if (!Number.isInteger(partByteLength) || partByteLength <= 0) {
    throw new Error(`No usable content-length for ${url}`);
  }

  const buffer = new CountingRangeBuffer(url, partByteLength, (target, init) =>
    fetch(target, init),
  );

  const footerStart = partByteLength - Math.min(FOOTER_TAIL_BYTES, partByteLength);
  const footerBytes = new Uint8Array(await buffer.slice(footerStart, partByteLength));
  const metadata = await readParquetMetadata({
    byteLength: partByteLength,
    slice(start: number, end?: number): ArrayBuffer {
      const from = Math.max(0, Math.trunc(start));
      const to = end === undefined ? partByteLength : Math.trunc(end);
      if (from < footerStart) throw new Error('footer larger than the recorded tail');
      const view = footerBytes.subarray(from - footerStart, to - footerStart);
      const copy = new Uint8Array(view.byteLength);
      copy.set(view);
      return copy.buffer;
    },
  });

  const extents = rowGroupExtents(metadata, OVERTURE_LAND_COLUMNS);
  const point: DegreeBox = {
    south: options.at.lat,
    north: options.at.lat,
    west: options.at.lon,
    east: options.at.lon,
  };
  const chosen = extents.find((extent) => boxContains(extent.box, point.south, point.west));
  if (chosen === undefined) {
    throw new Error(`No row group of ${options.part} covers ${options.at.lat}, ${options.at.lon}`);
  }

  const group = metadata.row_groups[chosen.index];
  if (group === undefined) throw new Error(`row group ${chosen.index} vanished from the metadata`);

  // Every leaf column chunk of the selected top-level columns, in file order.
  const chunkRanges: { start: number; end: number; label: string }[] = [];
  for (const chunk of group.columns) {
    const meta = chunk.meta_data;
    if (meta === undefined) continue;
    const top = meta.path_in_schema[0];
    if (top === undefined || !OVERTURE_LAND_COLUMNS.includes(top)) continue;
    const start = Number(meta.dictionary_page_offset ?? meta.data_page_offset);
    chunkRanges.push({
      start,
      end: start + Number(meta.total_compressed_size),
      label: meta.path_in_schema.join('.'),
    });
  }
  chunkRanges.sort((a, b) => a.start - b.start);

  const ordered = [
    ...chunkRanges,
    { start: footerStart, end: partByteLength, label: 'footer' },
  ].sort((a, b) => a.start - b.start);

  const chunks: Uint8Array[] = [];
  const ranges: ParquetSliceRange[] = [];
  let offset = 0;
  for (const range of ordered) {
    const bytes =
      range.label === 'footer'
        ? footerBytes
        : new Uint8Array(await buffer.slice(range.start, range.end));
    chunks.push(bytes);
    ranges.push({ start: range.start, end: range.end, offset, label: range.label });
    offset += bytes.byteLength;
  }

  const slice = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) {
    slice.set(chunk, at);
    at += chunk.byteLength;
  }

  const meta = {
    release: options.release,
    key,
    url,
    partByteLength,
    retrieved: new Date().toISOString().slice(0, 10),
    rowGroup: chosen.index,
    columns: [...OVERTURE_LAND_COLUMNS],
    ranges,
    sliceByteLength: slice.byteLength,
    regenerateWith: 'npm run fixtures:peak-parquet',
    description:
      `Row group ${chosen.index} of ${options.part}, plus the part's Parquet footer: the exact ` +
      `byte ranges one pruned read touches. The group holds ${chosen.numRows} rows spanning ` +
      `lon ${chosen.box.west}…${chosen.box.east}, lat ${chosen.box.south}…${chosen.box.north} ` +
      `(from the footer's bbox statistics) and contains the Matterhorn. The part has ` +
      `${extents.length} row groups and ${Number(metadata.num_rows)} rows in total. ` +
      'Overture data © OpenStreetMap contributors, ODbL-1.0.',
    // Stated here so the offline test asserts against the FILE'S OWN claims,
    // recorded at acquisition time, not against whatever the reader returns.
    expectations: {
      rowGroupCount: extents.length,
      fileRowCount: Number(metadata.num_rows),
      rowGroupRowStart: chosen.rowStart,
      rowGroupRows: chosen.numRows,
      rowGroupBox: chosen.box,
      selectedColumnBytes: chosen.selectedColumnBytes,
      totalCompressedBytes: chosen.totalCompressedBytes,
    },
  };
  parseParquetSliceMeta(meta, `${options.outDir}/slice.json`);

  await mkdir(options.outDir, { recursive: true });
  await writeFile(join(options.outDir, 'slice.bin'), slice);
  await writeFile(join(options.outDir, 'slice.json'), `${JSON.stringify(meta, null, 2)}\n`);

  process.stdout.write(
    `Recorded row group ${chosen.index} of ${options.part}\n` +
      `  part            ${partByteLength} bytes\n` +
      `  rows in group   ${chosen.numRows} (file rows ${chosen.rowStart}…${chosen.rowStart + chosen.numRows})\n` +
      `  group bbox      lon ${chosen.box.west}…${chosen.box.east}, lat ${chosen.box.south}…${chosen.box.north}\n` +
      `  footer          ${footerBytes.byteLength} bytes\n` +
      `  columns         ${chunkRanges.length} leaf chunks, ${chosen.selectedColumnBytes} bytes\n` +
      `  slice           ${slice.byteLength} bytes = ` +
      `${((slice.byteLength / partByteLength) * 100).toFixed(4)}% of the part\n` +
      `  fetched         ${buffer.bytesFetched} bytes in ${buffer.requestCount} range requests\n` +
      `  written to      ${options.outDir}\n`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
