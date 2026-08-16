/**
 * Reader tests against MATHEMATICALLY KNOWN terrain.
 *
 * Every expectation here is computed from the terrain formula or from the byte
 * layout, written out as a literal with the arithmetic shown. Nothing is copied
 * back from the reader's own output — this is byte-level index arithmetic, which
 * is exactly the code where a wrong answer still looks plausible.
 */

import { describe, expect, it } from 'vitest';

import {
  BYTES_PER_SAMPLE,
  HgtTile,
  SRTM1_GRID_SIZE,
  SRTM3_GRID_SIZE,
  VOID_SAMPLE,
  decodeBigEndianInt16,
  encodeBigEndianInt16,
  gridSizeForByteLength,
  parseGridWindow,
  parseHgtTile,
} from './hgt-tile.js';
import { isProviderError } from './errors.js';
import { bilinearTerrain, buildSyntheticTile, constantTerrain } from './synthetic-tile.js';

/* ------------------------------------------------------------------ *
 * Byte format
 * ------------------------------------------------------------------ */

describe('big-endian int16 decoding', () => {
  it('reads the high byte first', () => {
    // 0x0A 0xD7 = 10 × 256 + 215 = 2775. Little-endian would read 0xD70A = −10486.
    const samples = decodeBigEndianInt16(new Uint8Array([0x0a, 0xd7]));
    expect([...samples]).toEqual([2775]);
    expect(samples[0]).not.toBe(-10486);
  });

  it('reads negative samples and the void marker', () => {
    // 0xFFFF = −1 two's complement; 0x8000 = −32768 = the void marker.
    expect([...decodeBigEndianInt16(new Uint8Array([0xff, 0xff, 0x80, 0x00]))]).toEqual([
      -1,
      VOID_SAMPLE,
    ]);
  });

  it('round-trips through the encoder', () => {
    const original = Int16Array.from([0, 1, -1, 4230, -32768, 32767]);
    expect([...decodeBigEndianInt16(encodeBigEndianInt16(original))]).toEqual([...original]);
  });

  it('rejects an odd byte count', () => {
    expect(() => decodeBigEndianInt16(new Uint8Array([1, 2, 3]))).toThrow(/16-bit samples/);
  });

  it('honours a byte offset into a larger buffer', () => {
    // A Buffer from fs is often a view into a pooled ArrayBuffer; reading the
    // whole underlying buffer instead of the view is a classic silent bug.
    const backing = new Uint8Array([0xde, 0xad, 0x0a, 0xd7, 0xbe, 0xef]);
    const view = backing.subarray(2, 4);
    expect([...decodeBigEndianInt16(view)]).toEqual([2775]);
  });
});

describe('grid size derived from file length', () => {
  it('recognises the SRTM1 and SRTM3 sizes', () => {
    // 3601² × 2 = 25 934 402 ; 1201² × 2 = 2 884 802
    expect(gridSizeForByteLength(25_934_402)).toBe(SRTM1_GRID_SIZE);
    expect(gridSizeForByteLength(2_884_802)).toBe(SRTM3_GRID_SIZE);
  });

  it('derives non-standard sizes too, so tiny test tiles work', () => {
    expect(gridSizeForByteLength(21 * 21 * BYTES_PER_SAMPLE)).toBe(21);
    expect(gridSizeForByteLength(41 * 41 * BYTES_PER_SAMPLE)).toBe(41);
  });

  it('rejects a truncated tile rather than guessing', () => {
    // One sample short of SRTM1: 25 934 400 bytes = 12 967 200 samples, and
    // 3600.99…² ≠ that, so this must not silently parse as a 3600-grid.
    expect(() => gridSizeForByteLength(25_934_400, 'truncated')).toThrow(/not a square grid/);
    expect(() => gridSizeForByteLength(3)).toThrow(/whole number of 16-bit samples/);
    expect(() => gridSizeForByteLength(0)).toThrow();
  });

  it('raises a typed provider error', () => {
    try {
      gridSizeForByteLength(25_934_400);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isProviderError(error)).toBe(true);
      if (isProviderError(error)) expect(error.code).toBe('bad-tile');
    }
  });
});

/* ------------------------------------------------------------------ *
 * Geometry and orientation
 * ------------------------------------------------------------------ */

/**
 * The reference surface used throughout: h = 500 + 300·lat + 200·lon + 400·lat·lon.
 * On tile N00E000 with a 21 × 21 grid the spacing is 1/20 = 0.05°, and every
 * coefficient times 0.05 (or 0.05²) is a whole number, so every stored sample is
 * exact — no rounding stands between the formula and the bytes.
 */
const SURFACE = bilinearTerrain({
  originLat: 0,
  originLon: 0,
  baseM: 500,
  perLatDegM: 300,
  perLonDegM: 200,
  crossM: 400,
});

/** The formula, written out a second time, deliberately independently. */
function expectedHeight(lat: number, lon: number): number {
  return 500 + 300 * lat + 200 * lon + 400 * lat * lon;
}

describe('tile geometry', () => {
  const tile = buildSyntheticTile({ name: 'N00E000', gridSize: 21, terrain: SURFACE });

  it('spans one degree with both edges included', () => {
    expect(tile.geometry).toEqual({
      northLat: 1,
      westLon: 0,
      rows: 21,
      cols: 21,
      latStepDeg: 1 / 20,
      lonStepDeg: 1 / 20,
    });
    expect(tile.southLat).toBeCloseTo(0, 12);
    expect(tile.eastLon).toBeCloseTo(1, 12);
  });

  it('puts row 0 at the NORTH edge and column 0 at the WEST edge', () => {
    // h(1, 0) = 500 + 300 = 800 at the north-west corner;
    // h(0, 0) = 500 at the south-west corner. If rows were flipped these swap.
    expect(tile.sampleAt(0, 0)).toBe(800);
    expect(tile.sampleAt(20, 0)).toBe(500);
    expect(tile.latForRow(0)).toBe(1);
    expect(tile.latForRow(20)).toBeCloseTo(0, 12);
    expect(tile.lonForCol(0)).toBe(0);
    expect(tile.lonForCol(20)).toBeCloseTo(1, 12);
  });

  it('has the hand-computed values at all four corners', () => {
    // h(1,0) = 800 ; h(1,1) = 500+300+200+400 = 1400 ;
    // h(0,0) = 500 ; h(0,1) = 500+200 = 700
    expect(tile.sampleAt(0, 0)).toBe(800);
    expect(tile.sampleAt(0, 20)).toBe(1400);
    expect(tile.sampleAt(20, 0)).toBe(500);
    expect(tile.sampleAt(20, 20)).toBe(700);
  });

  it('has the hand-computed value at an interior sample', () => {
    // row 7 → lat = 1 − 7·0.05 = 0.65 ; col 13 → lon = 13·0.05 = 0.65
    // h = 500 + 195 + 130 + 400·0.4225 = 994
    expect(tile.sampleAt(7, 13)).toBe(994);
    expect(expectedHeight(0.65, 0.65)).toBe(994);
  });

  it('refuses out-of-range sample indices instead of wrapping to another row', () => {
    // (0, 21) is the classic off-by-one: it would silently read (1, 0).
    expect(() => tile.rawAt(0, 21)).toThrow(RangeError);
    expect(() => tile.rawAt(21, 0)).toThrow(RangeError);
    expect(() => tile.rawAt(-1, 0)).toThrow(RangeError);
    expect(() => tile.rawAt(0.5, 0)).toThrow(RangeError);
  });

  it('knows what it contains, edges included', () => {
    expect(tile.contains(1, 0)).toBe(true);
    expect(tile.contains(0, 1)).toBe(true);
    expect(tile.contains(0.5, 0.5)).toBe(true);
    expect(tile.contains(1.0001, 0.5)).toBe(false);
    expect(tile.contains(-0.0001, 0.5)).toBe(false);
    expect(tile.contains(0.5, 1.0001)).toBe(false);
    expect(tile.contains(0.5, -0.0001)).toBe(false);
  });

  it('parses an SRTM3-sized tile from its byte length alone', () => {
    const srtm3 = buildSyntheticTile({
      name: 'N45E007',
      gridSize: SRTM3_GRID_SIZE,
      terrain: constantTerrain(1500),
    });
    expect(srtm3.geometry.rows).toBe(1201);
    expect(srtm3.geometry.latStepDeg).toBe(1 / 1200);
    expect(srtm3.sampleAt(0, 0)).toBe(1500);
    expect(srtm3.sampleAt(1200, 1200)).toBe(1500);
    expect(srtm3.geometry.northLat).toBe(46);
    expect(srtm3.southLat).toBe(45);
  });

  it('rejects a grid whose byte count disagrees with its declared geometry', () => {
    expect(() =>
      parseGridWindow(new Uint8Array(4 * 2), {
        northLat: 46,
        westLon: 7,
        rows: 3,
        cols: 3,
        latStepDeg: 1 / 3600,
        lonStepDeg: 1 / 3600,
      }),
    ).toThrow(/but the file has/);
  });

  it('rejects a grid too small to interpolate in', () => {
    expect(
      () =>
        new HgtTile(Int16Array.from([1]), {
          northLat: 1,
          westLon: 0,
          rows: 1,
          cols: 1,
          latStepDeg: 1,
          lonStepDeg: 1,
        }),
    ).toThrow(/at least 2×2/);
  });
});

/* ------------------------------------------------------------------ *
 * Interpolation
 * ------------------------------------------------------------------ */

describe('bilinear interpolation', () => {
  const tile = buildSyntheticTile({ name: 'N00E000', gridSize: 21, terrain: SURFACE });

  it('is exact on a bilinear surface at a cell centre', () => {
    // Cell (0,0)–(1,1): corners h(1,0)=800, h(1,0.05)=830, h(0.95,0)=785, h(0.95,0.05)=814.
    // Centre lat 0.975, lon 0.025 → (800 + 830 + 785 + 814)/4 = 3229/4 = 807.25,
    // which equals the closed form 500 + 292.5 + 5 + 9.75 = 807.25.
    const reading = tile.bilinear(0.975, 0.025);
    expect(reading.status).toBe('ok');
    expect(reading.elevationM).toBeCloseTo(807.25, 10);
    expect(expectedHeight(0.975, 0.025)).toBeCloseTo(807.25, 10);
  });

  it('is exact at asymmetric weights (0.25 / 0.75), which catches swapped axes', () => {
    // lat 0.9875 → row fraction 0.25 ; lon 0.0375 → col fraction 0.75.
    // 0.1875·800 + 0.5625·830 + 0.0625·785 + 0.1875·814 = 818.5625
    // closed form: 500 + 296.25 + 7.5 + 14.8125 = 818.5625
    const reading = tile.bilinear(0.9875, 0.0375);
    expect(reading.elevationM).toBeCloseTo(818.5625, 10);
    // Swapping lat/lon fractions would give 500+300·0.9625+200·0.0125+400·0.9625·0.0125
    // = 793.5625 — a plausible-looking number, and wrong.
    expect(reading.elevationM).not.toBeCloseTo(793.5625, 3);
  });

  it('reports an exact hit on a sample as method "exact"', () => {
    const reading = tile.bilinear(0.65, 0.65);
    expect(reading).toEqual({ status: 'ok', elevationM: 994, method: 'exact' });
  });

  it('works on the south and east edges, where the cell must step back', () => {
    // Exactly on the south-east corner: h(0,1) = 700.
    expect(tile.bilinear(0, 1)).toEqual({ status: 'ok', elevationM: 700, method: 'exact' });
    // Half a cell in from the south edge, along it: lat 0, lon 0.025 →
    // h = 500 + 0 + 5 + 0 = 505.
    const south = tile.bilinear(0, 0.025);
    expect(south.elevationM).toBeCloseTo(505, 10);
    // Half a cell in from the east edge: lat 0.975, lon 1 →
    // h = 500 + 292.5 + 200 + 390 = 1382.5
    const east = tile.bilinear(0.975, 1);
    expect(east.elevationM).toBeCloseTo(1382.5, 10);
  });

  it('reports coordinates outside the tile rather than clamping them', () => {
    expect(tile.bilinear(1.5, 0.5)).toEqual({ status: 'outside', elevationM: null });
    expect(tile.nearest(0.5, 2)).toEqual({ status: 'outside', elevationM: null });
    expect(tile.indexFor(1.5, 0.5)).toBeNull();
  });
});

describe('nearest-sample lookup', () => {
  const tile = buildSyntheticTile({ name: 'N00E000', gridSize: 21, terrain: SURFACE });

  it('rounds to the closest sample, not the one below', () => {
    // lat 0.94 → row (1 − 0.94)/0.05 = 1.2 → row 1 (lat 0.95)
    // lon 0.16 → col 3.2 → col 3 (lon 0.15)
    // h(0.95, 0.15) = 500 + 285 + 30 + 57 = 872
    expect(tile.nearest(0.94, 0.16)).toEqual({ status: 'ok', elevationM: 872, method: 'nearest' });
    // lat 0.9 → row 2 exactly, lon 0.19 → col 3.8 → col 4 (lon 0.2)
    // h(0.9, 0.2) = 500 + 270 + 40 + 72 = 882
    expect(tile.nearest(0.9, 0.19)).toEqual({ status: 'ok', elevationM: 882, method: 'nearest' });
  });

  it('marks a lookup that lands exactly on a sample', () => {
    expect(tile.nearest(0.9, 0.2)).toEqual({ status: 'ok', elevationM: 882, method: 'exact' });
  });
});

/* ------------------------------------------------------------------ *
 * Voids — the highest-risk detail in the data path
 * ------------------------------------------------------------------ */

/**
 * A hand-built 3 × 3 tile (spacing 0.5°) with one void, so every weight in the
 * interpolation is known by hand:
 *
 *          lon 0    lon 0.5   lon 1
 *   lat 1    100      200      300
 *   lat 0.5  400     VOID      600
 *   lat 0    700      800      900
 */
function tileWithOneVoid(): HgtTile {
  const samples = Int16Array.from([100, 200, 300, 400, VOID_SAMPLE, 600, 700, 800, 900]);
  return new HgtTile(
    samples,
    { northLat: 1, westLon: 0, rows: 3, cols: 3, latStepDeg: 0.5, lonStepDeg: 0.5 },
    'one-void',
  );
}

describe('void handling', () => {
  const tile = tileWithOneVoid();

  it('never returns the void marker as an elevation', () => {
    expect(tile.rawAt(1, 1)).toBe(VOID_SAMPLE);
    expect(tile.sampleAt(1, 1)).toBeNull();
    expect(tile.countVoids()).toBe(1);
  });

  it('reports a nearest-sample hit on a void as no data, never as a number', () => {
    expect(tile.nearest(0.5, 0.5)).toEqual({ status: 'void', elevationM: null });
    // …and does not substitute a neighbour: nearest is nearest.
    expect(tile.nearest(0.45, 0.45)).toEqual({ status: 'void', elevationM: null });
  });

  it('falls back to the highest-weight VALID corner instead of averaging the void in', () => {
    // lat 0.875 → row fraction 0.25 ; lon 0.125 → col fraction 0.25.
    // Weights: (0,0) 0.5625 = 100 ; (0,1) 0.1875 = 200 ; (1,0) 0.1875 = 400 ;
    //          (1,1) 0.0625 = VOID.
    // Largest valid weight is (0,0) → 100 m.
    const reading = tile.bilinear(0.875, 0.125);
    expect(reading).toEqual({ status: 'ok', elevationM: 100, method: 'nearest-valid' });

    // If the void had been averaged in as −32768 the answer would have been
    // 0.5625·100 + 0.1875·200 + 0.1875·400 + 0.0625·(−32768) = −1879.25.
    expect(reading.elevationM).toBeGreaterThan(0);
  });

  it('picks the largest valid weight even when the void dominates the cell', () => {
    // lat 0.55 → row fraction 0.9 ; lon 0.4 → col fraction 0.8.
    // Weights: (0,0) 0.02 ; (0,1) 0.08 ; (1,0) 0.18 ; (1,1) 0.72 = VOID.
    // Largest valid weight is (1,0) → 400 m.
    expect(tile.bilinear(0.55, 0.4)).toEqual({
      status: 'ok',
      elevationM: 400,
      method: 'nearest-valid',
    });
  });

  it('returns no data for the whole cell under the strict policy', () => {
    expect(tile.bilinear(0.875, 0.125, 'no-data')).toEqual({ status: 'void', elevationM: null });
    expect(tile.read(0.875, 0.125, { voidPolicy: 'no-data' })).toEqual({
      status: 'void',
      elevationM: null,
    });
  });

  it('interpolates normally in a cell that has no void', () => {
    // Cell (1,1)–(2,2) is void at its north-west corner, but cell (1,0)–(2,1)
    // has corners 400, VOID… — use the clean south-west cell instead:
    // corners (1,0)=400, (1,1)=VOID → still void-touched. The only clean cells
    // are those not containing (1,1): here, none. So use a clean tile.
    const clean = new HgtTile(
      Int16Array.from([100, 200, 300, 400, 500, 600, 700, 800, 900]),
      { northLat: 1, westLon: 0, rows: 3, cols: 3, latStepDeg: 0.5, lonStepDeg: 0.5 },
      'clean',
    );
    // Centre of the north-west cell: (100 + 200 + 400 + 500)/4 = 300.
    expect(clean.bilinear(0.75, 0.25)).toEqual({
      status: 'ok',
      elevationM: 300,
      method: 'bilinear',
    });
  });

  it('returns no data when every corner of the cell is void', () => {
    //          lon 0   lon 0.5  lon 1
    //  lat 1    100     200      300
    //  lat 0.5  400    VOID     VOID
    //  lat 0    700    VOID     VOID
    const samples = Int16Array.from([
      100, 200, 300,
      400, VOID_SAMPLE, VOID_SAMPLE,
      700, VOID_SAMPLE, VOID_SAMPLE,
    ]);
    const holed = new HgtTile(
      samples,
      { northLat: 1, westLon: 0, rows: 3, cols: 3, latStepDeg: 0.5, lonStepDeg: 0.5 },
      'holed',
    );
    // Anywhere strictly inside the south-east cell, all four corners are void.
    expect(holed.bilinear(0.25, 0.75)).toEqual({ status: 'void', elevationM: null });
    expect(holed.bilinear(0.25, 0.75, 'no-data')).toEqual({ status: 'void', elevationM: null });
    expect(holed.countVoids()).toBe(4);
  });
});

/* ------------------------------------------------------------------ *
 * Round trip through the file format
 * ------------------------------------------------------------------ */

describe('parseHgtTile', () => {
  it('places a tile by its SOUTH-WEST corner', () => {
    const bytes = encodeBigEndianInt16(Int16Array.from([1, 2, 3, 4]));
    const tile = parseHgtTile(bytes, { southLat: -34, westLon: -44 }, 'S34W044');
    expect(tile.geometry.northLat).toBe(-33);
    expect(tile.geometry.westLon).toBe(-44);
    expect(tile.southLat).toBe(-34);
    expect(tile.eastLon).toBe(-43);
    // 2 × 2 grid: row 0 = north = lat −33, col 0 = west = lon −44.
    expect(tile.sampleAt(0, 0)).toBe(1);
    expect(tile.nearest(-33, -44).elevationM).toBe(1);
    expect(tile.nearest(-33, -43).elevationM).toBe(2);
    expect(tile.nearest(-34, -44).elevationM).toBe(3);
    expect(tile.nearest(-34, -43).elevationM).toBe(4);
  });
});
