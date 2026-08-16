/**
 * The local-tile elevation provider: same seam as the HTTP one, so it has to
 * behave the same where the contract is shared (order preserved, `null` means no
 * data) and be explicit where it knows more (void vs. missing tile).
 */

import { describe, expect, it } from 'vitest';

import { MemoryTileStore } from './tile-store.js';
import {
  MISSING_TILE_DATASET,
  TileElevationProvider,
  datasetLabelForGridSize,
  datasetLabelForStepDeg,
} from './tile-elevation.js';
import { toElevationSamples } from './elevation.js';
import { isProviderError } from './errors.js';
import { HgtTile, VOID_SAMPLE } from './hgt-tile.js';
import { bilinearTerrain, buildSyntheticTile } from './synthetic-tile.js';

/** h = 500 + 300·lat + 200·lon + 400·lat·lon on N00E000, 21 × 21 (0.05° spacing). */
const SURFACE = bilinearTerrain({
  originLat: 0,
  originLon: 0,
  baseM: 500,
  perLatDegM: 300,
  perLonDegM: 200,
  crossM: 400,
});

/**
 * A 3 × 3 tile at S01W001 (spacing 0.5°) with one void in the middle:
 *
 *            lon −1   lon −0.5   lon 0
 *   lat 0      100      200       300
 *   lat −0.5   400     VOID       600
 *   lat −1     700      800       900
 */
function voidTile(): HgtTile {
  return new HgtTile(
    Int16Array.from([100, 200, 300, 400, VOID_SAMPLE, 600, 700, 800, 900]),
    { northLat: 0, westLon: -1, rows: 3, cols: 3, latStepDeg: 0.5, lonStepDeg: 0.5 },
    'S01W001',
  );
}

function storeWithBoth(): MemoryTileStore {
  return new MemoryTileStore([
    ['N00E000', buildSyntheticTile({ name: 'N00E000', gridSize: 21, terrain: SURFACE })],
    ['S01W001', voidTile()],
  ]);
}

describe('TileElevationProvider — the ElevationProvider contract', () => {
  it('returns one result per point, in request order', async () => {
    const provider = new TileElevationProvider(storeWithBoth());
    // All three are interior to N00E000: a point exactly on the tile's north or
    // east edge belongs to the NEXT tile by the floor rule, which this store
    // does not hold — that is the store's job to say, not this test's.
    const points = [
      { lat: 0.65, lon: 0.65 }, // h = 500 + 195 + 130 + 169 = 994
      { lat: 0.9, lon: 0.2 }, //  h = 500 + 270 + 40 + 72   = 882
      { lat: 0.05, lon: 0.95 }, // h = 500 + 15 + 190 + 19  = 724
    ];
    const results = await provider.fetchElevations(points);
    for (const [i, expected] of [994, 882, 724].entries()) {
      expect(results[i]?.elevationM).toBeCloseTo(expected, 9);
    }
    expect(results.map((r) => [r.lat, r.lon])).toEqual([
      [0.65, 0.65],
      [0.9, 0.2],
      [0.05, 0.95],
    ]);
  });

  it('returns an empty array for no points, without touching the store', async () => {
    const provider = new TileElevationProvider(new MemoryTileStore());
    expect(await provider.fetchElevations([])).toEqual([]);
  });

  it('reports a void as elevationM null — never 0 m, never −32768 m', async () => {
    const provider = new TileElevationProvider(storeWithBoth(), { interpolation: 'nearest' });
    const [result] = await provider.fetchElevations([{ lat: -0.5, lon: -0.5 }]);
    expect(result?.elevationM).toBeNull();
  });

  it('reports a missing tile as elevationM null with a distinct dataset label', async () => {
    const provider = new TileElevationProvider(storeWithBoth());
    const [result] = await provider.fetchElevations([{ lat: 45.9763, lon: 7.6586 }]);
    expect(result?.elevationM).toBeNull();
    expect(result?.dataset).toBe(MISSING_TILE_DATASET);
  });

  it('labels the dataset by the tile resolution', async () => {
    const provider = new TileElevationProvider(storeWithBoth());
    const [result] = await provider.fetchElevations([{ lat: 0.5, lon: 0.5 }]);
    // A 21 × 21 test tile is neither SRTM1 nor SRTM3 and must not claim to be.
    expect(result?.dataset).toBe('hgt-21');
    expect(datasetLabelForGridSize(3601)).toBe('srtm1');
    expect(datasetLabelForGridSize(1201)).toBe('srtm3');
    // Resolution IS the sample spacing; grid size is only a proxy for it, and
    // only for a grid that spans a whole degree.
    expect(datasetLabelForStepDeg(1 / 3600)).toBe('srtm1');
    expect(datasetLabelForStepDeg(1 / 1200)).toBe('srtm3');
    expect(datasetLabelForStepDeg(1 / 20)).toBe('hgt-21');
    // A spacing that does not divide a degree evenly is named by the spacing.
    expect(datasetLabelForStepDeg(0.3)).toBe('hgt-1080arcsec');
    expect(() => datasetLabelForStepDeg(0)).toThrow(/positive/);
  });

  /* Wave 3 finding 4 — a WINDOW is not a tile, so its column count says
   * nothing about its resolution. The committed case windows are exactly this
   * shape: rectangles cut out of a 1-arc-second tile. A 1201-column window of
   * SRTM1 data labelled `srtm3` claims 90 m posting over 30 m data — the
   * manifest and the provider then disagree about the same bytes. */
  it('labels a 1201-column WINDOW of 1-arc-second data as srtm1, not srtm3', async () => {
    const step = 1 / 3600;
    const window = new HgtTile(
      new Int16Array(3 * 1201),
      { northLat: 46, westLon: 7, rows: 3, cols: 1201, latStepDeg: step, lonStepDeg: step },
      'N45E007-window',
    );
    const provider = new TileElevationProvider(new MemoryTileStore([['N45E007', window]]), {
      interpolation: 'nearest',
    });
    const sample = await provider.sampleTerrain({ lat: 46 - step, lon: 7 + 100 * step });
    expect(sample.status).toBe('ok');
    expect(sample.dataset).toBe('srtm1');
  });

  it('plugs into toElevationSamples, which forces a no-data decision', async () => {
    const provider = new TileElevationProvider(storeWithBoth(), { interpolation: 'nearest' });
    const results = await provider.fetchElevations([
      { lat: 0.5, lon: 0.5 }, // h = 500 + 150 + 100 + 100 = 850 m
      { lat: -0.5, lon: -0.5 }, // void
    ]);
    expect(toElevationSamples(results, 'drop')).toEqual([{ lat: 0.5, lon: 0.5, elevationM: 850 }]);
    expect(() => toElevationSamples(results, 'throw')).toThrow(/No elevation data/);
    expect(toElevationSamples(results, { fillM: -1 })).toEqual([
      { lat: 0.5, lon: 0.5, elevationM: 850 },
      { lat: -0.5, lon: -0.5, elevationM: -1 },
    ]);
  });

  it('surfaces an abort as a typed error', async () => {
    const provider = new TileElevationProvider(storeWithBoth());
    const controller = new AbortController();
    controller.abort();
    try {
      await provider.fetchElevations([{ lat: 0.5, lon: 0.5 }], { signal: controller.signal });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isProviderError(error)).toBe(true);
      if (isProviderError(error)) expect(error.code).toBe('aborted');
    }
  });
});

describe('TileElevationProvider — the richer local view', () => {
  it('distinguishes void from missing tile from outside', async () => {
    const provider = new TileElevationProvider(storeWithBoth(), { interpolation: 'nearest' });

    const onGrid = await provider.sampleTerrain({ lat: 0.5, lon: 0.5 });
    // h(0.5, 0.5) = 500 + 150 + 100 + 100 = 850, and (0.5, 0.5) is sample (10, 10).
    expect(onGrid).toEqual({
      lat: 0.5,
      lon: 0.5,
      status: 'ok',
      elevationM: 850,
      method: 'nearest',
      tileName: 'N00E000',
      dataset: 'hgt-21',
    });

    const inVoid = await provider.sampleTerrain({ lat: -0.5, lon: -0.5 });
    expect(inVoid.status).toBe('void');
    expect(inVoid.elevationM).toBeNull();
    expect(inVoid.tileName).toBe('S01W001');

    const noTile = await provider.sampleTerrain({ lat: 45.9763, lon: 7.6586 });
    expect(noTile.status).toBe('missing-tile');
    expect(noTile.tileName).toBe('N45E007');
  });

  it('records how each value was derived', async () => {
    const bilinear = new TileElevationProvider(storeWithBoth());
    // Cell centre: (800 + 830 + 785 + 814)/4 = 807.25 — see hgt-tile.test.ts.
    const interpolated = await bilinear.sampleTerrain({ lat: 0.975, lon: 0.025 });
    expect(interpolated.method).toBe('bilinear');
    expect(interpolated.elevationM).toBeCloseTo(807.25, 10);

    // Same point, nearest instead: the point sits at the exact centre of the
    // cell, row fraction 0.5 and column fraction 0.5, and Math.round takes .5
    // upward → sample (1, 1) = h(0.95, 0.05) = 500 + 285 + 10 + 19 = 814.
    const nearest = new TileElevationProvider(storeWithBoth(), { interpolation: 'nearest' });
    const rounded = await nearest.sampleTerrain({ lat: 0.975, lon: 0.025 });
    expect(rounded).toMatchObject({ method: 'nearest', elevationM: 814 });
  });

  it('flags a value that had to fall back past a void', async () => {
    const provider = new TileElevationProvider(storeWithBoth());
    // Cell (0,0)–(1,1) of S01W001 has VOID at its south-east corner.
    // lat −0.125 → row fraction 0.25 ; lon −0.875 → col fraction 0.25.
    // Largest valid weight is corner (0,0) = 100 m.
    const sample = await provider.sampleTerrain({ lat: -0.125, lon: -0.875 });
    expect(sample).toMatchObject({ status: 'ok', elevationM: 100, method: 'nearest-valid' });
  });

  it('honours the strict void policy', async () => {
    const strict = new TileElevationProvider(storeWithBoth(), { voidPolicy: 'no-data' });
    const sample = await strict.sampleTerrain({ lat: -0.125, lon: -0.875 });
    expect(sample.status).toBe('void');
    expect(sample.elevationM).toBeNull();
  });

  it('can be told to fail loudly on a missing tile instead of returning no data', async () => {
    const provider = new TileElevationProvider(storeWithBoth(), { missingTilePolicy: 'throw' });
    try {
      await provider.sampleTerrain({ lat: 45.9763, lon: 7.6586 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isProviderError(error)).toBe(true);
      if (isProviderError(error)) {
        expect(error.code).toBe('empty-result');
        expect(error.message).toContain('N45E007');
        expect(error.message).toContain('fetch:tiles');
      }
    }
  });

  it('lists the tiles a set of points would need but does not have', async () => {
    const provider = new TileElevationProvider(storeWithBoth());
    const missing = await provider.missingTilesFor([
      { lat: 0.5, lon: 0.5 }, // held
      { lat: 45.9763, lon: 7.6586 }, // N45E007
      { lat: 46.0207, lon: 7.7491 }, // N46E007 — Zermatt is in the tile above
      { lat: 45.99, lon: 7.5 }, // N45E007 again, must not be listed twice
    ]);
    expect(missing).toEqual(['N45E007', 'N46E007']);
  });
});
