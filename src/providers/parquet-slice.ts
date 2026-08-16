/**
 * A committed slice of a real remote Parquet file, served as an `AsyncBuffer`.
 *
 * WHY THIS EXISTS
 *   `scripts/fetch-peaks.ts` reads Overture over HTTP Range requests. Tests may
 *   not. But a test that replays hand-authored JSON would prove nothing about
 *   Parquet — the format is where every interesting mistake lives (footer
 *   offsets, row-group row spans, per-column byte ranges, zstd pages). So the
 *   fixture is the same thing `fixtures/tiles/` is for SRTM: **real bytes, in
 *   the real format, with a provenance sidecar** naming the release, the part,
 *   and the exact byte ranges they were cut from.
 *
 *   The slice is not a valid standalone Parquet file, and deliberately so:
 *   re-encoding it would mean the tests parse bytes some writer produced rather
 *   than bytes Overture published. Instead the recorded ranges are replayed at
 *   their ORIGINAL file offsets, behind a buffer that reports the original
 *   part's `byteLength`. Every offset in the footer therefore resolves exactly
 *   as it does against S3, and a read of anything that was not recorded THROWS
 *   rather than returning zeros — because a plausible-looking buffer of zeros
 *   would decode into plausible-looking wrong data, which is the failure mode
 *   this whole project is organised against.
 */

import { ProviderError } from './errors.js';
import type { AsyncBuffer } from './overture-parquet.js';

/** One recorded byte range: `[start, end)` of the original file. */
export interface ParquetSliceRange {
  /** Inclusive start offset in the ORIGINAL part. */
  readonly start: number;
  /** Exclusive end offset in the ORIGINAL part. */
  readonly end: number;
  /** Offset of these bytes within the committed `.bin`. */
  readonly offset: number;
  /** What this range is: `footer`, or a column path. */
  readonly label: string;
}

/** The provenance sidecar committed next to the bytes. */
export interface ParquetSliceMeta {
  readonly release: string;
  /** S3 key of the part the ranges were cut from. */
  readonly key: string;
  readonly url: string;
  /** Byte length of the ORIGINAL part — what the buffer reports. */
  readonly partByteLength: number;
  readonly retrieved: string;
  /** Index of the row group whose columns were recorded. */
  readonly rowGroup: number;
  /** Top-level columns recorded for that row group. */
  readonly columns: readonly string[];
  readonly ranges: readonly ParquetSliceRange[];
  /** Total bytes committed — the sum of the ranges. */
  readonly sliceByteLength: number;
  readonly regenerateWith: string;
  readonly description: string;
}

function fail(label: string, message: string): never {
  throw new ProviderError('bad-response', `${label}: ${message}`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(label, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function asString(raw: Record<string, unknown>, field: string, label: string): string {
  const value = raw[field];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(label, `${field} must be a non-empty string`);
  }
  return value.trim();
}

function asInteger(raw: Record<string, unknown>, field: string, label: string): number {
  const value = raw[field];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(label, `${field} must be a non-negative integer`);
  }
  return value;
}

/** Validate a parsed sidecar. */
export function parseParquetSliceMeta(value: unknown, label = 'parquet slice'): ParquetSliceMeta {
  const raw = asRecord(value, label);
  const rawRanges = raw['ranges'];
  if (!Array.isArray(rawRanges) || rawRanges.length === 0) {
    fail(label, 'ranges must be a non-empty array');
  }
  const ranges: ParquetSliceRange[] = rawRanges.map((entry, index) => {
    const rangeLabel = `${label}.ranges[${index}]`;
    const range = asRecord(entry, rangeLabel);
    const start = asInteger(range, 'start', rangeLabel);
    const end = asInteger(range, 'end', rangeLabel);
    if (end <= start) fail(rangeLabel, `end ${end} must be above start ${start}`);
    return { start, end, offset: asInteger(range, 'offset', rangeLabel), label: asString(range, 'label', rangeLabel) };
  });

  const rawColumns = raw['columns'];
  if (!Array.isArray(rawColumns) || rawColumns.some((c) => typeof c !== 'string')) {
    fail(label, 'columns must be an array of strings');
  }

  const sliceByteLength = asInteger(raw, 'sliceByteLength', label);
  const summed = ranges.reduce((total, range) => total + (range.end - range.start), 0);
  if (summed !== sliceByteLength) {
    fail(label, `sliceByteLength ${sliceByteLength} disagrees with the ranges' ${summed}`);
  }

  return {
    release: asString(raw, 'release', label),
    key: asString(raw, 'key', label),
    url: asString(raw, 'url', label),
    partByteLength: asInteger(raw, 'partByteLength', label),
    retrieved: asString(raw, 'retrieved', label),
    rowGroup: asInteger(raw, 'rowGroup', label),
    columns: rawColumns as readonly string[],
    ranges,
    sliceByteLength,
    regenerateWith: asString(raw, 'regenerateWith', label),
    description: asString(raw, 'description', label),
  };
}

/** Ranges merged where they touch, so a coalesced read spanning two is served. */
interface Segment {
  readonly start: number;
  readonly end: number;
  readonly offset: number;
}

function segmentsFor(meta: ParquetSliceMeta): readonly Segment[] {
  const sorted = [...meta.ranges].sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  for (const range of sorted) {
    const last = segments[segments.length - 1];
    const contiguousInFile = last !== undefined && range.start === last.end;
    const contiguousInSlice =
      last !== undefined && range.offset === last.offset + (last.end - last.start);
    if (last !== undefined && contiguousInFile && contiguousInSlice) {
      segments[segments.length - 1] = { start: last.start, end: range.end, offset: last.offset };
    } else {
      segments.push({ start: range.start, end: range.end, offset: range.offset });
    }
  }
  return segments;
}

/**
 * An `AsyncBuffer` over the committed slice.
 *
 * hyparquet coalesces column chunks that touch into one request, so a read may
 * span several recorded ranges; ranges are written in ascending file order and
 * merged here when they are contiguous in both the file and the slice.
 */
export function parquetSliceBuffer(meta: ParquetSliceMeta, bytes: Uint8Array): AsyncBuffer {
  if (bytes.byteLength !== meta.sliceByteLength) {
    fail(
      'parquet slice',
      `data is ${bytes.byteLength} bytes, the sidecar says ${meta.sliceByteLength}`,
    );
  }
  const segments = segmentsFor(meta);
  return {
    byteLength: meta.partByteLength,
    slice(start: number, end?: number): ArrayBuffer {
      const from = Math.max(0, Math.trunc(start));
      const to = end === undefined ? meta.partByteLength : Math.min(meta.partByteLength, Math.trunc(end));
      if (to <= from) return new ArrayBuffer(0);
      for (const segment of segments) {
        if (from >= segment.start && to <= segment.end) {
          const at = segment.offset + (from - segment.start);
          const view = bytes.subarray(at, at + (to - from));
          const copy = new Uint8Array(view.byteLength);
          copy.set(view);
          return copy.buffer;
        }
      }
      fail(
        'parquet slice',
        `bytes ${from}…${to} of ${meta.key} were not recorded. ` +
          `Recorded: ${segments.map((s) => `${s.start}…${s.end}`).join(', ')}. ` +
          'Re-record the fixture rather than filling the gap.',
      );
    },
  };
}
