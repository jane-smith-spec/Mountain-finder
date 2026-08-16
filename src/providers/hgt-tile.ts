/**
 * SRTM `.hgt` tile reader — the offline elevation source.
 *
 * FORMAT (verified byte-wise against a real tile, see `fixtures/tiles/`):
 *   * `n × n` samples of **signed 16-bit BIG-ENDIAN** integers, metres above the
 *     WGS-84 geoid. No header, no footer — `n` is derived from the file length.
 *     SRTM1 (1 arc-second) is 3601 × 3601 = 25 934 402 bytes;
 *     SRTM3 (3 arc-second) is 1201 × 1201 = 2 884 802 bytes.
 *   * Row 0 is the **NORTH** edge, column 0 is the **WEST** edge, so latitude
 *     DECREASES with row index while longitude INCREASES with column index.
 *   * A tile is named after its **SOUTH-WEST** corner (`N45E007` covers
 *     lat 45…46, lon 7…8) and spans a full degree **inclusive of both edges**.
 *     That is why `n` is odd: adjacent tiles duplicate the shared edge line.
 *     Sample spacing is therefore `1 / (n − 1)` degrees, not `1 / n`.
 *
 * VOIDS. `-32768` is the void marker — "the radar got no return here" (radar
 * shadow on steep north faces, water, deep narrow valleys). It is NOT an
 * elevation. Coercing it to 0 m puts a fake sea-level pit in the terrain;
 * keeping it as −32768 m puts a fake 32 km trench there. Either one silently
 * corrupts a skyline. So voids are `null` everywhere in this module, and
 * `TileReading` is a discriminated union you cannot read a number out of
 * without first checking `status`.
 *
 * VOID POLICY FOR INTERPOLATION (`VoidPolicy`, default `'nearest-valid'`):
 *   Bilinear interpolation needs four corner samples. If any corner is a void,
 *   it is never averaged in — an average that includes −32768 is meaningless.
 *   Instead:
 *     `'nearest-valid'` — return the VALID corner of that cell with the largest
 *        bilinear weight (ties break toward the north-west, in the fixed corner
 *        order NW, NE, SW, SE, so the result is deterministic). The answer is
 *        displaced by at most one sample spacing (~30 m for SRTM1), and the
 *        caller can see the degradation in `method`. This only ever applies at
 *        the FRINGE of a void: inside a void larger than one cell all four
 *        corners are void and the result is `status: 'void'` regardless.
 *     `'no-data'` — any void corner makes the whole reading `status: 'void'`.
 *   Nearest-neighbour lookups never substitute: a void sample reads `'void'`.
 *
 * ACCURACY CAVEAT — READ BEFORE USING THIS FOR SUMMIT HEIGHTS.
 *   SRTM is a ~30 m-posting radar surface. It resolves ridge lines well but
 *   systematically UNDER-reads sharp summits, because no sample lands exactly on
 *   the point and the beam averages the sides in. Measured against this tile:
 *     Matterhorn      SRTM 4230 m   true 4478 m   −248 m
 *     Dent d'Hérens   SRTM 3835 m   true 4171 m   −336 m
 *     Grand Combin    SRTM 4287 m   true 4314 m    −27 m  (broad summit)
 *   So: use these tiles for the TERRAIN HORIZON (the occluding ridge line) and
 *   take peak summit heights from the peak database's tagged `ele` instead.
 */

import { ProviderError } from './errors.js';

/** The SRTM void marker. Not an elevation — see the module docs. */
export const VOID_SAMPLE = -32768;

/** Bytes per sample: signed 16-bit. */
export const BYTES_PER_SAMPLE = 2;

/** Grid size of a 1 arc-second (SRTM1) tile. */
export const SRTM1_GRID_SIZE = 3601;

/** Grid size of a 3 arc-second (SRTM3) tile. */
export const SRTM3_GRID_SIZE = 1201;

/**
 * Where a grid of samples sits on the globe.
 *
 * Row 0 is at `northLat` and rows march SOUTH; column 0 is at `westLon` and
 * columns march EAST. Both edges are inclusive, so the grid covers
 * `(rows − 1) × latStepDeg` degrees of latitude.
 */
export interface GridGeometry {
  /** Latitude of row 0 — the NORTH edge. */
  readonly northLat: number;
  /** Longitude of column 0 — the WEST edge. */
  readonly westLon: number;
  readonly rows: number;
  readonly cols: number;
  /** Degrees of latitude between adjacent rows (positive; rows go south). */
  readonly latStepDeg: number;
  /** Degrees of longitude between adjacent columns (positive; columns go east). */
  readonly lonStepDeg: number;
}

/**
 * How an elevation was obtained.
 *
 * There is deliberately no `'exact'` value for "the query landed on a sample".
 * Sample lines sit at multiples of 1/3600°, which is not representable in binary
 * floating point, so `(northLat − lat) / latStepDeg` is only ever *nearly* an
 * integer and an exactness flag would be a coin toss. Landing on a sample is
 * already handled correctly by both methods — bilinear gives that sample's value
 * because the other three weights are ~0.
 */
export type TileReadingMethod =
  /** Weighted average of four valid corner samples. */
  | 'bilinear'
  /** Nearest-neighbour lookup that the caller asked for. */
  | 'nearest'
  /** A void corner forced a fall back to the nearest VALID corner of the cell. */
  | 'nearest-valid';

/**
 * The outcome of a lookup. A discriminated union on purpose: there is no way to
 * pull a `number` out of a void or an out-of-bounds query without noticing.
 */
export type TileReading =
  | { readonly status: 'ok'; readonly elevationM: number; readonly method: TileReadingMethod }
  /** Inside the grid, but the data there is void (no radar return). */
  | { readonly status: 'void'; readonly elevationM: null }
  /** The coordinate lies outside this grid's bounds. */
  | { readonly status: 'outside'; readonly elevationM: null };

/** What interpolation should do when a corner sample is void. See module docs. */
export type VoidPolicy = 'nearest-valid' | 'no-data';

export interface ReadOptions {
  /** Default `'bilinear'`. */
  readonly interpolation?: 'bilinear' | 'nearest';
  /** Default `'nearest-valid'`. */
  readonly voidPolicy?: VoidPolicy;
}

/**
 * Tolerance for "is this coordinate inside the tile" and for snapping a query
 * that lands a hair outside the last row/column. 1e-9° ≈ 0.1 mm — far below any
 * meaningful positional accuracy, but wide enough to absorb the float error of
 * `northLat - rows * step` style arithmetic.
 */
const EDGE_EPSILON_DEG = 1e-9;

/** An addressable grid of elevation samples: a whole `.hgt` tile or a window of one. */
export class HgtTile {
  /** Samples in host byte order, row-major, row 0 = north. Voids kept as −32768. */
  private readonly samples: Int16Array;

  readonly geometry: GridGeometry;

  /** Diagnostic label, e.g. `N45E007` or a fixture window name. */
  readonly name: string;

  constructor(samples: Int16Array, geometry: GridGeometry, name = 'unnamed') {
    const expected = geometry.rows * geometry.cols;
    if (samples.length !== expected) {
      throw new ProviderError(
        'bad-tile',
        `${name}: geometry says ${geometry.rows}×${geometry.cols} = ${expected} samples ` +
          `but ${samples.length} were supplied`,
      );
    }
    if (geometry.rows < 2 || geometry.cols < 2) {
      throw new ProviderError(
        'bad-tile',
        `${name}: a grid needs at least 2×2 samples to interpolate, got ` +
          `${geometry.rows}×${geometry.cols}`,
      );
    }
    this.samples = samples;
    this.geometry = geometry;
    this.name = name;
  }

  /** Latitude of the SOUTH edge (row `rows − 1`). */
  get southLat(): number {
    return this.geometry.northLat - (this.geometry.rows - 1) * this.geometry.latStepDeg;
  }

  /** Longitude of the EAST edge (column `cols − 1`). */
  get eastLon(): number {
    return this.geometry.westLon + (this.geometry.cols - 1) * this.geometry.lonStepDeg;
  }

  /** Latitude of a row index (row 0 = north edge). */
  latForRow(row: number): number {
    return this.geometry.northLat - row * this.geometry.latStepDeg;
  }

  /** Longitude of a column index (column 0 = west edge). */
  lonForCol(col: number): number {
    return this.geometry.westLon + col * this.geometry.lonStepDeg;
  }

  /**
   * The stored sample, void marker included. Throws on an out-of-range index —
   * that is a programming error, not a data condition.
   */
  rawAt(row: number, col: number): number {
    const { rows, cols } = this.geometry;
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= rows || col >= cols) {
      throw new RangeError(`${this.name}: sample (${row}, ${col}) is outside ${rows}×${cols}`);
    }
    const value = this.samples[row * cols + col];
    if (value === undefined) {
      // Unreachable given the bounds check above; kept because the index type is
      // `number | undefined` and silencing it with `!` is exactly the habit that
      // hides off-by-one bugs in this file.
      throw new RangeError(`${this.name}: sample (${row}, ${col}) is missing`);
    }
    return value;
  }

  /** The sample as an elevation: `null` when it is a void. */
  sampleAt(row: number, col: number): number | null {
    const value = this.rawAt(row, col);
    return value === VOID_SAMPLE ? null : value;
  }

  /** How many samples in this grid are voids. Diagnostic. */
  countVoids(): number {
    let voids = 0;
    for (const value of this.samples) if (value === VOID_SAMPLE) voids += 1;
    return voids;
  }

  /** Is this coordinate within the grid's bounds (edges inclusive)? */
  contains(lat: number, lon: number): boolean {
    return (
      lat <= this.geometry.northLat + EDGE_EPSILON_DEG &&
      lat >= this.southLat - EDGE_EPSILON_DEG &&
      lon >= this.geometry.westLon - EDGE_EPSILON_DEG &&
      lon <= this.eastLon + EDGE_EPSILON_DEG
    );
  }

  /**
   * Fractional grid position of a coordinate: row 0.0 is the north edge,
   * column 0.0 the west edge. Returns `null` when the point is outside.
   */
  indexFor(lat: number, lon: number): { readonly row: number; readonly col: number } | null {
    if (!this.contains(lat, lon)) return null;
    const { northLat, westLon, latStepDeg, lonStepDeg, rows, cols } = this.geometry;
    const row = clamp((northLat - lat) / latStepDeg, 0, rows - 1);
    const col = clamp((lon - westLon) / lonStepDeg, 0, cols - 1);
    return { row, col };
  }

  /** Nearest-sample lookup. A void sample reads as `'void'` — never substituted. */
  nearest(lat: number, lon: number): TileReading {
    const index = this.indexFor(lat, lon);
    if (index === null) return OUTSIDE;
    const row = Math.round(index.row);
    const col = Math.round(index.col);
    const value = this.sampleAt(row, col);
    if (value === null) return VOID_READING;
    return { status: 'ok', elevationM: value, method: 'nearest' };
  }

  /**
   * Bilinear interpolation over the enclosing cell. See the module docs for the
   * void policy — voids are never averaged in.
   */
  bilinear(lat: number, lon: number, voidPolicy: VoidPolicy = 'nearest-valid'): TileReading {
    const index = this.indexFor(lat, lon);
    if (index === null) return OUTSIDE;

    // The cell whose corners bracket the point. At the south/east edge the point
    // sits ON the last line, so step back one cell and let the fraction be 1.
    const row0 = Math.min(Math.floor(index.row), this.geometry.rows - 2);
    const col0 = Math.min(Math.floor(index.col), this.geometry.cols - 2);
    const fRow = index.row - row0;
    const fCol = index.col - col0;

    const corners = [
      { row: row0, col: col0, weight: (1 - fRow) * (1 - fCol) },
      { row: row0, col: col0 + 1, weight: (1 - fRow) * fCol },
      { row: row0 + 1, col: col0, weight: fRow * (1 - fCol) },
      { row: row0 + 1, col: col0 + 1, weight: fRow * fCol },
    ] as const;

    let sum = 0;
    let voidSeen = false;
    let best: { value: number; weight: number } | null = null;
    for (const corner of corners) {
      const value = this.sampleAt(corner.row, corner.col);
      if (value === null) {
        voidSeen = true;
        continue;
      }
      sum += value * corner.weight;
      if (best === null || corner.weight > best.weight) best = { value, weight: corner.weight };
    }

    if (!voidSeen) return { status: 'ok', elevationM: sum, method: 'bilinear' };
    if (voidPolicy === 'no-data' || best === null) return VOID_READING;
    return { status: 'ok', elevationM: best.value, method: 'nearest-valid' };
  }

  /** Convenience wrapper honouring `ReadOptions`. */
  read(lat: number, lon: number, options: ReadOptions = {}): TileReading {
    return options.interpolation === 'nearest'
      ? this.nearest(lat, lon)
      : this.bilinear(lat, lon, options.voidPolicy ?? 'nearest-valid');
  }
}

const OUTSIDE = { status: 'outside', elevationM: null } as const;
const VOID_READING = { status: 'void', elevationM: null } as const;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Grid size implied by a `.hgt` file length: `n = sqrt(bytes / 2)`.
 * Throws `bad-tile` if the length is not `n × n × 2` for an integer n — the
 * usual cause is a truncated download.
 */
export function gridSizeForByteLength(byteLength: number, label = 'tile'): number {
  if (byteLength <= 0 || byteLength % BYTES_PER_SAMPLE !== 0) {
    throw new ProviderError(
      'bad-tile',
      `${label}: ${byteLength} bytes is not a whole number of 16-bit samples`,
    );
  }
  const sampleCount = byteLength / BYTES_PER_SAMPLE;
  const size = Math.round(Math.sqrt(sampleCount));
  if (size * size !== sampleCount) {
    throw new ProviderError(
      'bad-tile',
      `${label}: ${sampleCount} samples is not a square grid ` +
        `(expected e.g. ${SRTM1_GRID_SIZE}² for SRTM1 or ${SRTM3_GRID_SIZE}² for SRTM3) — ` +
        'a truncated download looks exactly like this',
    );
  }
  return size;
}

/** Decode big-endian int16 samples out of raw bytes. */
export function decodeBigEndianInt16(bytes: Uint8Array, label = 'tile'): Int16Array {
  if (bytes.length % BYTES_PER_SAMPLE !== 0) {
    throw new ProviderError(
      'bad-tile',
      `${label}: ${bytes.length} bytes is not a whole number of 16-bit samples`,
    );
  }
  const count = bytes.length / BYTES_PER_SAMPLE;
  const out = new Int16Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; i += 1) {
    out[i] = view.getInt16(i * BYTES_PER_SAMPLE, /* littleEndian */ false);
  }
  return out;
}

/** Encode int16 samples as big-endian bytes — the inverse of the reader. */
export function encodeBigEndianInt16(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * BYTES_PER_SAMPLE);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(i * BYTES_PER_SAMPLE, samples[i] ?? VOID_SAMPLE, /* littleEndian */ false);
  }
  return bytes;
}

/**
 * Parse a whole `.hgt` tile. The grid size comes from the byte length, and the
 * geometry from the tile's south-west corner: the tile spans exactly one degree
 * in each direction with both edges included.
 */
export function parseHgtTile(
  bytes: Uint8Array,
  corner: { readonly southLat: number; readonly westLon: number },
  name = 'tile',
): HgtTile {
  const size = gridSizeForByteLength(bytes.length, name);
  const step = 1 / (size - 1);
  return new HgtTile(
    decodeBigEndianInt16(bytes, name),
    {
      northLat: corner.southLat + 1,
      westLon: corner.westLon,
      rows: size,
      cols: size,
      latStepDeg: step,
      lonStepDeg: step,
    },
    name,
  );
}

/**
 * Parse a rectangular WINDOW of a tile — same byte format, arbitrary
 * (documented) geometry. This is what the committed real-data fixture uses, so
 * tests read genuine SRTM bytes without a 25 MB file in the repository.
 */
export function parseGridWindow(
  bytes: Uint8Array,
  geometry: GridGeometry,
  name = 'window',
): HgtTile {
  const expected = geometry.rows * geometry.cols * BYTES_PER_SAMPLE;
  if (bytes.length !== expected) {
    throw new ProviderError(
      'bad-tile',
      `${name}: geometry says ${geometry.rows}×${geometry.cols} (${expected} bytes) ` +
        `but the file has ${bytes.length}`,
    );
  }
  return new HgtTile(decodeBigEndianInt16(bytes, name), geometry, name);
}
