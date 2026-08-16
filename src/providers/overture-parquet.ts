/**
 * Range-reading Overture's Parquet: footer → row-group pruning → column read.
 *
 * This module does no I/O. It is handed an `AsyncBuffer` — `{ byteLength,
 * slice(start, end) }` — exactly the same injectable seam as `Transport` and
 * `TileStore` elsewhere in this directory. `scripts/fetch-peaks.ts` supplies
 * one backed by HTTP Range requests against S3; the offline tests supply one
 * backed by a committed slice of real Overture bytes. Neither the app nor any
 * test ever reaches the network through here.
 *
 * ── WHY THIS SHAPE ────────────────────────────────────────────────────────
 * One Overture `theme=base/type=land` part is 0.4–1.7 GB and the 32 parts of
 * the 2026-06-17.0 release total 29.5 GB. Nothing in this project may download
 * that. Two properties of Parquet make a bounded read possible:
 *
 *   1. The footer carries, for EVERY row group, min/max statistics on
 *      `bbox.xmin`, `bbox.xmax`, `bbox.ymin` and `bbox.ymax` — so a row group's
 *      geographic extent is known without reading the group at all. Verified on
 *      the live files: all 32 parts, every row group, statistics present.
 *   2. A row group stores each column as its own contiguous byte range, so a
 *      read can name the six columns it needs and skip `geometry`, which is
 *      ~96% of the bytes.
 *
 * Together those turn "find the peaks near Zermatt" from a 29.5 GB download
 * into a few megabytes. {@link planParquetRead} computes exactly how few, and
 * the importer prints it, because bytes-fetched over file-size is the number
 * that proves the design rather than describing it.
 */

import { parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import type { AsyncBuffer, FileMetaData, RowGroup } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

import { boxesIntersect, overtureError, type DegreeBox } from './overture-peaks.js';

export type { AsyncBuffer, FileMetaData };

/** Statistics-derived extent of one row group, plus where its rows live. */
export interface RowGroupExtent {
  /** Index into `metadata.row_groups`. */
  readonly index: number;
  /** Index of this group's first row within the file. */
  readonly rowStart: number;
  readonly numRows: number;
  /** The group's own bounding box, from the footer statistics. */
  readonly box: DegreeBox;
  /** Compressed bytes of the whole group, all columns. */
  readonly totalCompressedBytes: number;
  /** Compressed bytes of just the columns named in the read plan. */
  readonly selectedColumnBytes: number;
}

function statNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  return null;
}

/**
 * The min or max statistic of one leaf column in one row group.
 *
 * Parquet writes both the deprecated `min`/`max` and the current
 * `min_value`/`max_value`; hyparquet surfaces whichever the file carries, so
 * both are consulted. `null` means the file did not state it — and a missing
 * statistic must never be read as "no data out here", so callers treat it as
 * "cannot prune" rather than "can skip".
 */
function leafStat(group: RowGroup, path: string, which: 'min' | 'max'): number | null {
  for (const chunk of group.columns) {
    const meta = chunk.meta_data;
    if (meta === undefined) continue;
    if (meta.path_in_schema.join('.') !== path) continue;
    const stats = meta.statistics;
    if (stats === undefined) return null;
    const primary = which === 'min' ? stats.min_value : stats.max_value;
    const legacy = which === 'min' ? stats.min : stats.max;
    return statNumber(primary) ?? statNumber(legacy);
  }
  return null;
}

/** Compressed bytes of the column chunks whose TOP-LEVEL name is in `columns`. */
function selectedBytes(group: RowGroup, columns: readonly string[]): number {
  let bytes = 0;
  for (const chunk of group.columns) {
    const meta = chunk.meta_data;
    if (meta === undefined) continue;
    const top = meta.path_in_schema[0];
    if (top === undefined || !columns.includes(top)) continue;
    bytes += Number(meta.total_compressed_size);
  }
  return bytes;
}

/**
 * Every row group's extent, read from the footer alone.
 *
 * A group whose bbox statistics are incomplete gets the whole world as its
 * extent. That is the safe direction: it will be fetched and filtered rather
 * than skipped unseen. If Overture ever stops writing these statistics the
 * importer's byte report will jump by orders of magnitude, which is a louder
 * failure than quietly returning no peaks.
 */
export function rowGroupExtents(
  metadata: FileMetaData,
  columns: readonly string[],
): readonly RowGroupExtent[] {
  const extents: RowGroupExtent[] = [];
  let rowStart = 0;
  for (const [index, group] of metadata.row_groups.entries()) {
    const numRows = Number(group.num_rows);
    const west = leafStat(group, 'bbox.xmin', 'min');
    const east = leafStat(group, 'bbox.xmax', 'max');
    const south = leafStat(group, 'bbox.ymin', 'min');
    const north = leafStat(group, 'bbox.ymax', 'max');
    const box: DegreeBox =
      west === null || east === null || south === null || north === null
        ? { south: -90, west: -180, north: 90, east: 180 }
        : { south, west, north, east };
    extents.push({
      index,
      rowStart,
      numRows,
      box,
      totalCompressedBytes: Number(group.total_byte_size),
      selectedColumnBytes: selectedBytes(group, columns),
    });
    rowStart += numRows;
  }
  return extents;
}

/** What a bounded read of one part will cost, decided before any of it happens. */
export interface ParquetReadPlan {
  readonly totalRowGroups: number;
  readonly totalRows: number;
  /** The groups that survive spatial pruning, in file order. */
  readonly groups: readonly RowGroupExtent[];
  /** Compressed bytes of the selected columns across the surviving groups. */
  readonly plannedBytes: number;
  /** Compressed bytes those groups would cost with every column read. */
  readonly plannedBytesAllColumns: number;
}

/** Prune row groups to a query box and price the read. Pure: metadata in, plan out. */
export function planParquetRead(
  metadata: FileMetaData,
  box: DegreeBox,
  columns: readonly string[],
): ParquetReadPlan {
  const extents = rowGroupExtents(metadata, columns);
  const groups = extents.filter((extent) => boxesIntersect(extent.box, box));
  let plannedBytes = 0;
  let plannedBytesAllColumns = 0;
  for (const group of groups) {
    plannedBytes += group.selectedColumnBytes;
    plannedBytesAllColumns += group.totalCompressedBytes;
  }
  return {
    totalRowGroups: extents.length,
    totalRows: Number(metadata.num_rows),
    groups,
    plannedBytes,
    plannedBytesAllColumns,
  };
}

/**
 * Read the footer of a Parquet file through an injected buffer.
 *
 * Costs one range request of at most 512 KiB — 0.06% of an 850 MB part —
 * because that is what hyparquet asks for and Overture's footers fit inside it
 * (part-00011's metadata is 511,495 bytes).
 */
export function readParquetMetadata(file: AsyncBuffer): Promise<FileMetaData> {
  return parquetMetadataAsync(file);
}

/**
 * Decode one row group's selected columns into plain objects.
 *
 * `rowStart`/`rowEnd` name the group's own row span, which is how hyparquet is
 * told to read exactly one group; `columns` restricts the byte ranges fetched
 * to those columns' chunks.
 */
export async function readRowGroup(
  file: AsyncBuffer,
  metadata: FileMetaData,
  extent: RowGroupExtent,
  columns: readonly string[],
): Promise<readonly unknown[]> {
  if (extent.numRows === 0) return [];
  const rows = await parquetReadObjects({
    file,
    metadata,
    compressors,
    columns: [...columns],
    rowStart: extent.rowStart,
    rowEnd: extent.rowStart + extent.numRows,
  });
  if (rows.length !== extent.numRows) {
    throw overtureError(
      `row group ${extent.index} decoded ${rows.length} rows, footer says ${extent.numRows}`,
    );
  }
  return rows;
}

/**
 * An `AsyncBuffer` over HTTP Range requests, counting every byte it pulls.
 *
 * Lives here rather than in the script so the byte accounting is the same
 * object the tests can exercise with a fake fetch; `fetchLike` is injected for
 * exactly that reason. Nothing in `src/` calls this with the global `fetch` —
 * only `scripts/fetch-peaks.ts` does.
 */
export interface RangeFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type RangeFetchLike = (
  url: string,
  init: { readonly headers: Record<string, string> },
) => Promise<RangeFetchResponse>;

export class CountingRangeBuffer implements AsyncBuffer {
  readonly byteLength: number;

  private readonly url: string;
  private readonly fetchLike: RangeFetchLike;
  private bytes = 0;
  private requests = 0;

  constructor(url: string, byteLength: number, fetchLike: RangeFetchLike) {
    if (!Number.isInteger(byteLength) || byteLength <= 0) {
      throw overtureError(`byteLength must be a positive integer, received ${byteLength}`);
    }
    this.url = url;
    this.byteLength = byteLength;
    this.fetchLike = fetchLike;
  }

  /** Bytes actually transferred so far. The number the importer reports. */
  get bytesFetched(): number {
    return this.bytes;
  }

  /** Range requests issued so far. */
  get requestCount(): number {
    return this.requests;
  }

  async slice(start: number, end?: number): Promise<ArrayBuffer> {
    const from = Math.max(0, Math.trunc(start));
    const to = end === undefined ? this.byteLength : Math.min(this.byteLength, Math.trunc(end));
    if (to <= from) return new ArrayBuffer(0);
    // HTTP ranges are inclusive at both ends; Parquet's are half-open.
    const header = `bytes=${from}-${to - 1}`;
    const response = await this.fetchLike(this.url, { headers: { Range: header } });
    if (!response.ok) {
      throw overtureError(`HTTP ${response.status} for ${header} of ${this.url}`);
    }
    const buffer = await response.arrayBuffer();
    this.requests += 1;
    this.bytes += buffer.byteLength;
    if (buffer.byteLength !== to - from) {
      throw overtureError(
        `range ${header} returned ${buffer.byteLength} bytes, expected ${to - from} — ` +
          'the server ignored the Range header, which would mean downloading the whole part',
      );
    }
    return buffer;
  }
}
