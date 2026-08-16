/**
 * The tiled peak store (PLAN.md P9.5): "peaks within a radius of this point"
 * answered by loading only the 1° cells that radius touches.
 *
 * HOW THE EXPECTATIONS WERE OBTAINED. The bounding-box numbers are computed
 * from the spherical formulae written out in `boundingBoxAround`'s doc comment,
 * evaluated by hand rather than by the function under test:
 *
 *   one degree of latitude = R·π/180 = 6 371 008.8 · π/180 m = 111.19508 km
 *   Δλ at latitude φ for angular radius δ = asin(sin δ / cos φ)
 *     φ = 0°,  δ = 1°  →  asin(0.017452406 / 1)   = 1.0000000°
 *     φ = 45°, δ = 1°  →  asin(0.017452406 / cos45°) = 1.4142854°
 *     φ = 60°, δ = 1°  →  asin(0.017452406 / 0.5)    = 2.0003048°
 *
 * The Alpine assertions are checked against the summits and heights that
 * `fixtures/peaks/ground-truth-peaks.json` cites, which predate this store.
 */

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ProviderError } from './errors.js';
import { loadPeakCellIndex, peakCellFileLoader } from './peak-directory.js';
import type { PeakRecord } from './peak-store.js';
import {
  TiledPeakStore,
  boundingBoxAround,
  cellNameForPeak,
  parsePeakCell,
  parsePeakCellIndex,
  type PeakCellEntry,
  type PeakCellIndex,
} from './peak-tile-store.js';

/** Kilometres in one degree of latitude on the datum sphere. */
const KM_PER_DEGREE = 111.19508023353292;

const SOURCES = [
  {
    id: 'test-source',
    title: 'Test citation',
    url: 'https://example.invalid/',
    retrieved: '2026-08-16',
    access: 'derived' as const,
  },
];

function record(id: string, lat: number, lon: number, elevationM: number): PeakRecord {
  return {
    id,
    name: id,
    lat,
    lon,
    elevationM,
    positionSourceId: 'test-source',
    elevationSourceId: 'test-source',
    elevationSourceKind: 'osm',
    usedBy: [],
  };
}

function indexFor(cells: readonly { name: string; peaks: number }[]): PeakCellIndex {
  return parsePeakCellIndex({
    version: 1,
    description: 'test index',
    release: 'test',
    generatedBy: 'hand',
    bounds: { south: 45, west: 7, north: 47, east: 9 },
    sources: SOURCES,
    cells: cells.map((cell) => ({ ...cell, file: `cells/${cell.name}.json` })),
    peakCount: cells.reduce((total, cell) => total + cell.peaks, 0),
  });
}

describe('boundingBoxAround', () => {
  it('spans exactly the angular radius in latitude', () => {
    const box = boundingBoxAround({ lat: 0, lon: 0 }, KM_PER_DEGREE);
    expect(box.north).toBeCloseTo(1, 12);
    expect(box.south).toBeCloseTo(-1, 12);
  });

  it('matches the hand-evaluated asin(sin δ / cos φ) at three latitudes', () => {
    expect(boundingBoxAround({ lat: 0, lon: 0 }, KM_PER_DEGREE).east).toBeCloseTo(1.0, 9);
    expect(boundingBoxAround({ lat: 45, lon: 0 }, KM_PER_DEGREE).east).toBeCloseTo(1.4142854, 6);
    expect(boundingBoxAround({ lat: 60, lon: 0 }, KM_PER_DEGREE).east).toBeCloseTo(2.0003048, 6);
  });

  it('is WIDER than the naive δ/cos φ, which would lose peaks in the sliver', () => {
    // The naive rule used for tile fetching gives exactly 2.0000000° at 60°N.
    // A summit between 2.0000000° and 2.0003048° of longitude away is inside
    // the circle and outside the naive box — silently absent, the worst kind.
    const exact = boundingBoxAround({ lat: 60, lon: 0 }, KM_PER_DEGREE).east;
    expect(exact).toBeGreaterThan(1 / Math.cos((60 * Math.PI) / 180));
  });

  it('opens to every longitude once the circle swallows a pole', () => {
    const box = boundingBoxAround({ lat: 89.5, lon: 12 }, KM_PER_DEGREE);
    expect(box.west).toBe(-180);
    expect(box.east).toBe(180);
    expect(box.north).toBe(90);
  });

  it('is a point for a zero radius, and refuses a negative one', () => {
    expect(boundingBoxAround({ lat: 45.9, lon: 7.7 }, 0)).toEqual({
      south: 45.9,
      north: 45.9,
      west: 7.7,
      east: 7.7,
    });
    expect(() => boundingBoxAround({ lat: 0, lon: 0 }, -1)).toThrow(RangeError);
  });
});

describe('cellNameForPeak', () => {
  it('uses the same 1° naming as the terrain tiles, in every hemisphere', () => {
    expect(cellNameForPeak({ lat: 45.976389, lon: 7.658611 })).toBe('N45E007');
    expect(cellNameForPeak({ lat: 46.0207, lon: 7.7491 })).toBe('N46E007');
    expect(cellNameForPeak({ lat: 37.8817, lon: -121.9142 })).toBe('N37W122');
    expect(cellNameForPeak({ lat: -0.5, lon: -0.5 })).toBe('S01W001');
  });
});

describe('parsePeakCellIndex', () => {
  it('refuses a peak count that disagrees with the cells', () => {
    expect(() =>
      parsePeakCellIndex({
        version: 1,
        description: 'test',
        release: 'test',
        generatedBy: 'hand',
        bounds: { south: 45, west: 7, north: 47, east: 9 },
        sources: SOURCES,
        cells: [{ name: 'N45E007', peaks: 2, file: 'cells/N45E007.json' }],
        peakCount: 3,
      }),
    ).toThrow(/peakCount 3 disagrees/);
  });

  it('refuses a duplicate cell', () => {
    expect(() =>
      parsePeakCellIndex({
        version: 1,
        description: 'test',
        release: 'test',
        generatedBy: 'hand',
        bounds: { south: 45, west: 7, north: 47, east: 9 },
        sources: SOURCES,
        cells: [
          { name: 'N45E007', peaks: 0, file: 'a.json' },
          { name: 'n45e007', peaks: 0, file: 'b.json' },
        ],
        peakCount: 0,
      }),
    ).toThrow(/duplicate cell N45E007/);
  });
});

describe('parsePeakCell', () => {
  const entry: PeakCellEntry = { name: 'N45E007', peaks: 1, file: 'cells/N45E007.json' };

  it('accepts a cell whose peaks all belong in it', () => {
    const dataset = parsePeakCell(
      { cell: 'N45E007', peaks: [record('a', 45.5, 7.5, 3000)] },
      entry,
      SOURCES,
    );
    expect(dataset.peaks).toHaveLength(1);
  });

  it('refuses a peak filed in the wrong cell — it would be invisible to queries', () => {
    expect(() =>
      parsePeakCell({ cell: 'N45E007', peaks: [record('a', 46.5, 7.5, 3000)] }, entry, SOURCES),
    ).toThrow(/belongs in cell N46E007/);
  });

  it('refuses a cell whose count disagrees with the index', () => {
    expect(() => parsePeakCell({ cell: 'N45E007', peaks: [] }, entry, SOURCES)).toThrow(
      /holds 0 peaks, the index says 1/,
    );
  });

  it('refuses a file that claims to be a different cell', () => {
    expect(() =>
      parsePeakCell({ cell: 'N46E007', peaks: [record('a', 45.5, 7.5, 3000)] }, entry, SOURCES),
    ).toThrow(/declares cell N46E007/);
  });
});

describe('TiledPeakStore — laziness', () => {
  const cells: Record<string, PeakRecord[]> = {
    N45E007: [record('south-west', 45.5, 7.5, 3000)],
    N45E008: [record('south-east', 45.5, 8.5, 3100)],
    N46E007: [record('north-west', 46.5, 7.5, 3200)],
    N46E008: [record('north-east', 46.5, 8.5, 3300)],
  };

  function store(): { store: TiledPeakStore; loads: string[] } {
    const loads: string[] = [];
    const index = indexFor(Object.keys(cells).map((name) => ({ name, peaks: 1 })));
    const tiled = new TiledPeakStore(index, async (entry) => {
      loads.push(entry.name);
      return { cell: entry.name, peaks: cells[entry.name] ?? [] };
    });
    return { store: tiled, loads };
  }

  it('knows how many peaks it holds without opening a single cell', () => {
    const { store: tiled, loads } = store();
    expect(tiled.size).toBe(4);
    expect(tiled.cellNames).toEqual(['N45E007', 'N45E008', 'N46E007', 'N46E008']);
    expect(loads).toEqual([]);
    expect(tiled.loadedCellCount).toBe(0);
  });

  it('loads only the cells the query radius reaches', async () => {
    const { store: tiled, loads } = store();
    // 5 km around 45.5, 7.5 — well inside N45E007 and nowhere near the others.
    const peaks = await tiled.peaksWithin({ lat: 45.5, lon: 7.5 }, 5);
    expect(peaks.map((peak) => peak.id)).toEqual(['south-west']);
    expect(loads).toEqual(['N45E007']);
  });

  it('spans cells when the radius crosses a boundary', async () => {
    const { store: tiled, loads } = store();
    // 120 km around 46.0, 8.0 reaches every corner of the 2×2 block.
    const peaks = await tiled.peaksWithin({ lat: 46, lon: 8 }, 120);
    expect(peaks).toHaveLength(4);
    expect([...loads].sort()).toEqual(['N45E007', 'N45E008', 'N46E007', 'N46E008']);
  });

  it('reads each cell once, even when two queries race', async () => {
    const { store: tiled, loads } = store();
    await Promise.all([
      tiled.peaksWithin({ lat: 45.5, lon: 7.5 }, 5),
      tiled.peaksWithin({ lat: 45.5, lon: 7.5 }, 5),
    ]);
    expect(loads).toEqual(['N45E007']);
    expect(tiled.loadedCellCount).toBe(1);
  });

  it('orders results nearest first', async () => {
    const { store: tiled } = store();
    const peaks = await tiled.peaksWithin({ lat: 45.6, lon: 7.6 }, 300);
    expect(peaks[0]?.id).toBe('south-west');
  });

  it('says so loudly when a listed cell cannot be loaded', async () => {
    const index = indexFor([{ name: 'N45E007', peaks: 1 }]);
    const tiled = new TiledPeakStore(index, async () => null);
    await expect(tiled.peaksWithin({ lat: 45.5, lon: 7.5 }, 5)).rejects.toThrow(
      /lists cell N45E007/,
    );
  });

  it('ignores cells the dataset simply does not hold', async () => {
    const index = indexFor([{ name: 'N45E007', peaks: 1 }]);
    const tiled = new TiledPeakStore(index, async (entry) => ({
      cell: entry.name,
      peaks: cells[entry.name] ?? [],
    }));
    // A radius reaching into N46E007, which the index never lists: not an error.
    const peaks = await tiled.peaksWithin({ lat: 45.99, lon: 7.5 }, 20);
    expect(peaks).toHaveLength(0);
  });
});

describe('TiledPeakStore — the PeaksProvider contract', () => {
  const index = indexFor([{ name: 'N45E007', peaks: 1 }]);
  const build = (): TiledPeakStore =>
    new TiledPeakStore(index, async (entry) => ({
      cell: entry.name,
      peaks: [record('a', 45.5, 7.5, 3000)],
    }));

  it('rejects an empty area with empty-result, like the Overpass client', async () => {
    await expect(
      build().fetchPeaks({ center: { lat: 20, lon: 20 }, radiusKm: 10 }),
    ).rejects.toThrow(ProviderError);
  });

  it('returns [] for an empty area when the caller opts in', async () => {
    await expect(
      build().fetchPeaks({ center: { lat: 20, lon: 20 }, radiusKm: 10 }, { allowEmpty: true }),
    ).resolves.toEqual([]);
  });

  it('honours an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      build().fetchPeaks({ center: { lat: 45.5, lon: 7.5 }, radiusKm: 10 }, {
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/);
  });

  it('answers a bbox query too', async () => {
    const peaks = await build().fetchPeaks({
      bbox: { south: 45.4, west: 7.4, north: 45.6, east: 7.6 },
    });
    expect(peaks.map((peak) => peak.id)).toEqual(['a']);
    expect(peaks[0]?.elevationSource).toBe('osm');
  });
});

describe('the committed Overture import of the Zermatt region', () => {
  const INDEX = fileURLToPath(
    new URL('../../fixtures/peaks/regions/zermatt/index.json', import.meta.url),
  );

  it('is cut from a named Overture release and cites it', async () => {
    const store = await loadPeakCellIndex(INDEX);
    expect(store.index.release).toBe('2026-06-17.0');
    expect(store.index.sources).toHaveLength(1);
    const source = store.index.sources[0];
    expect(source?.url).toContain('overturemaps-us-west-2.s3.amazonaws.com');
    expect(source?.note).toContain('ele');
    // Coverage, stated: the hand-built dataset holds 15 records for four
    // viewpoints. This one region alone holds more than a thousand summits.
    expect(store.size).toBeGreaterThan(1000);
  });

  it('finds the Gornergrat skyline without loading the whole region', async () => {
    const store = await loadPeakCellIndex(INDEX);
    // The Gornergrat ground-truth viewpoint. 10 km reaches the Matterhorn
    // (9.6 km), Dufourspitze (8.4 km) and the Breithorn (5.4 km).
    const peaks = await store.peaksWithin({ lat: 45.9833, lon: 7.7833 }, 10);
    const names = peaks.map((peak) => peak.name);
    expect(names).toContain('Matterhorn');
    expect(names).toContain('Dufourspitze');
    expect(names).toContain('Breithorn Occidentale / Westgipfel');

    // Two of the region's four cells are enough for that radius.
    expect(store.loadedCellCount).toBe(2);
    expect(store.cellNames).toHaveLength(4);

    // …and there are far more than three summits up there.
    expect(peaks.length).toBeGreaterThan(50);
  });

  it('carries the cited heights, not DEM samples', async () => {
    const store = await loadPeakCellIndex(INDEX);
    const peaks = await store.peaksWithin({ lat: 45.9833, lon: 7.7833 }, 12);
    const matterhorn = peaks.find((peak) => peak.name === 'Matterhorn');
    expect(matterhorn?.elevationM).toBe(4478); // cited; SRTM reads 4230 m here
    expect(matterhorn?.elevationSource).toBe('osm');
    const dufourspitze = peaks.find((peak) => peak.name === 'Dufourspitze');
    expect(dufourspitze?.elevationM).toBe(4634); // cited
  });

  it('files every peak in the cell its coordinates put it in', async () => {
    // parsePeakCell enforces this per cell; loading all four proves the whole
    // committed dataset satisfies it.
    const store = await loadPeakCellIndex(INDEX);
    const records = await store.recordsInBox(store.index.bounds);
    expect(records).toHaveLength(store.size);
    for (const peak of records) {
      expect(cellNameForPeak(peak)).toMatch(/^N4[56]E00[78]$/);
    }
  });
});

describe('peakCellFileLoader', () => {
  it('refuses a cell path that escapes the index directory', async () => {
    const loader = peakCellFileLoader('/tmp/does-not-exist/index.json');
    await expect(
      loader({ name: 'N45E007', peaks: 0, file: '../../../etc/passwd' }),
    ).rejects.toThrow(/escapes/);
    await expect(loader({ name: 'N45E007', peaks: 0, file: '/etc/passwd' })).rejects.toThrow(
      /absolute path/,
    );
  });

  it('reports a missing cell file as null, not as a crash', async () => {
    const loader = peakCellFileLoader('/tmp/does-not-exist/index.json');
    await expect(loader({ name: 'N45E007', peaks: 0, file: 'cells/N45E007.json' })).resolves.toBe(
      null,
    );
  });
});
