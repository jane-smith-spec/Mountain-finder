/**
 * Tests against the COMMITTED fixtures in `fixtures/tiles/` — real SRTM bytes
 * plus synthetic tiles — through the filesystem path (`tile-directory.ts`).
 *
 * Offline by construction: everything read here is in git. Nothing depends on
 * `data/tiles/`, which is gitignored and empty on a fresh clone.
 *
 * HOW THE EXPECTATIONS WERE OBTAINED. Not by running this reader. Each real
 * value below was read straight out of the fixture bytes with
 * `Buffer.readInt16BE(offset)` at a hand-computed offset, and the offset
 * arithmetic is written next to it: for a window of `cols` columns,
 *
 *     byteOffset(row, col) = (row × cols + col) × 2
 *
 * The same values were also cross-checked against the ORIGINAL 25 MB tile at
 * `data/tiles/N45E007.hgt` at `(row0 + row, col0 + col)`, which is what proves
 * the window was cut where the sidecar says it was.
 */

import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DirectoryTileStore, loadTileWindow, parseTileWindowMeta } from './tile-directory.js';
import { TileElevationProvider } from './tile-elevation.js';
import { VOID_SAMPLE } from './hgt-tile.js';
import { buildSyntheticHgtBytes } from './synthetic-tile.js';

const FIXTURE_DIR = fileURLToPath(new URL('../../fixtures/tiles', import.meta.url));

/* ------------------------------------------------------------------ *
 * Real data: a window of N45E007 around the Matterhorn
 * ------------------------------------------------------------------ */

/** 1 arc-second, the SRTM1 posting interval. */
const ARC_SECOND = 1 / 3600;

describe('real SRTM window: matterhorn-window (N45E007)', () => {
  it('has the geometry its provenance implies', async () => {
    const { tile, meta } = await loadTileWindow(join(FIXTURE_DIR, 'matterhorn-window.json'));

    // Cut at source row 64, col 2240 of a 3601² tile whose north edge is lat 46
    // and west edge lon 7:  north = 46 − 64/3600 = 45.982222…
    //                       west  =  7 + 2240/3600 = 7.622222…
    expect(meta.source.tile).toBe('N45E007');
    expect(meta.source.extractedFromRow).toBe(64);
    expect(meta.source.extractedFromCol).toBe(2240);
    expect(meta.source.url).toBe(
      'https://s3.amazonaws.com/elevation-tiles-prod/skadi/N45/N45E007.hgt.gz',
    );

    expect(tile.geometry.rows).toBe(256);
    expect(tile.geometry.cols).toBe(256);
    expect(tile.geometry.latStepDeg).toBeCloseTo(ARC_SECOND, 15);
    expect(tile.geometry.northLat).toBeCloseTo(46 - 64 / 3600, 12);
    expect(tile.geometry.westLon).toBeCloseTo(7 + 2240 / 3600, 12);
    // 255 steps of one arc-second from the north-west corner.
    expect(tile.southLat).toBeCloseTo(46 - (64 + 255) / 3600, 12);
    expect(tile.eastLon).toBeCloseTo(7 + (2240 + 255) / 3600, 12);
  });

  it('is exactly rows × cols × 2 bytes', async () => {
    const bytes = await readFile(join(FIXTURE_DIR, 'matterhorn-window.i16be'));
    expect(bytes.length).toBe(256 * 256 * 2);
    expect(bytes.length).toBe(131_072);
  });

  it('reads the four corner samples', async () => {
    const { tile } = await loadTileWindow(join(FIXTURE_DIR, 'matterhorn-window.json'));
    // offsets 0, 510, 130560 and 131070; source (64,2240), (64,2495),
    // (319,2240), (319,2495) → 2775, 2765, 2021, 2822 m.
    expect(tile.sampleAt(0, 0)).toBe(2775);
    expect(tile.sampleAt(0, 255)).toBe(2765);
    expect(tile.sampleAt(255, 0)).toBe(2021);
    expect(tile.sampleAt(255, 255)).toBe(2822);
  });

  it('reads the first sample from the first two bytes, big-endian', async () => {
    const bytes = await readFile(join(FIXTURE_DIR, 'matterhorn-window.i16be'));
    // 0x0A 0xD7 → 10 × 256 + 215 = 2775 m. Byte-swapped it would be −10486.
    expect(bytes[0]).toBe(0x0a);
    expect(bytes[1]).toBe(0xd7);
    expect(0x0a * 256 + 0xd7).toBe(2775);
  });

  it('holds the Matterhorn massif, under-read and displaced as SRTM always is', async () => {
    const { tile } = await loadTileWindow(join(FIXTURE_DIR, 'matterhorn-window.json'));

    // Highest posting in the window: (24, 117), byte offset (24×256+117)×2 = 12522.
    // Source tile (88, 2357) → lat 46 − 88/3600 = 45.975556, lon 7 + 2357/3600 = 7.654722.
    expect(tile.sampleAt(24, 117)).toBe(4230);
    expect(tile.latForRow(24)).toBeCloseTo(46 - 88 / 3600, 12);
    expect(tile.lonForCol(117)).toBeCloseTo(7 + 2357 / 3600, 12);

    // The SURVEYED summit (45.97639 N, 7.65861 E) is source (85, 2371) =
    // window (21, 131), offset (21×256+131)×2 = 11014, and reads 3567 m —
    // already down the east side. This is the documented reason peak heights
    // must come from the peak database, not from SRTM.
    expect(tile.sampleAt(21, 131)).toBe(3567);
    const surveyedSummit = tile.nearest(45.97639, 7.65861);
    expect(surveyedSummit).toEqual({ status: 'ok', elevationM: 3567, method: 'nearest' });
    expect(4478 - 4230).toBe(248); // the under-read the module docs quote
  });

  it('interpolates real data between four real samples', async () => {
    const { tile } = await loadTileWindow(join(FIXTURE_DIR, 'matterhorn-window.json'));
    // Cell (10,20)–(11,21), read at offsets 5160, 5162, 5672, 5674:
    //   (10,20) = 2880   (10,21) = 2883
    //   (11,20) = 2881   (11,21) = 2886
    // Dead centre of the cell → (2880 + 2883 + 2881 + 2886)/4 = 11530/4 = 2882.5
    expect(tile.sampleAt(10, 20)).toBe(2880);
    expect(tile.sampleAt(10, 21)).toBe(2883);
    expect(tile.sampleAt(11, 20)).toBe(2881);
    expect(tile.sampleAt(11, 21)).toBe(2886);

    const lat = tile.geometry.northLat - 10.5 * tile.geometry.latStepDeg;
    const lon = tile.geometry.westLon + 20.5 * tile.geometry.lonStepDeg;
    const reading = tile.bilinear(lat, lon);
    expect(reading.status).toBe('ok');
    expect(reading.elevationM).toBeCloseTo(2882.5, 9);
  });

  it('has no voids, because this mirror is void-filled', async () => {
    const { tile } = await loadTileWindow(join(FIXTURE_DIR, 'matterhorn-window.json'));
    expect(tile.countVoids()).toBe(0);
    // Every sample is a plausible Alpine elevation, and none is the marker.
    expect(tile.sampleAt(128, 128)).toBe(2571);
    expect(tile.sampleAt(128, 128)).not.toBe(VOID_SAMPLE);
  });

  it('reports coordinates outside the window rather than extrapolating', async () => {
    const { tile } = await loadTileWindow(join(FIXTURE_DIR, 'matterhorn-window.json'));
    // Zermatt village is 5 km north-east of this window — and in another tile.
    expect(tile.bilinear(46.0207, 7.7491)).toEqual({ status: 'outside', elevationM: null });
  });
});

/* ------------------------------------------------------------------ *
 * Real data: Zermatt village, from the tile ABOVE the Matterhorn's
 * ------------------------------------------------------------------ */

describe('real SRTM window: zermatt-window (N46E007)', () => {
  it('comes from N46E007, because 46.0207 N is north of the 46° line', async () => {
    const { tile, meta } = await loadTileWindow(join(FIXTURE_DIR, 'zermatt-window.json'));
    expect(meta.source.tile).toBe('N46E007');
    // Cut at source row 3494, col 2665 of N46E007 (north edge lat 47, west lon 7):
    //   north = 47 − 3494/3600 = 46.029444…   west = 7 + 2665/3600 = 7.740278…
    expect(tile.geometry.northLat).toBeCloseTo(47 - 3494 / 3600, 12);
    expect(tile.geometry.westLon).toBeCloseTo(7 + 2665 / 3600, 12);
    expect(tile.geometry.rows).toBe(64);
    expect(tile.geometry.cols).toBe(64);
  });

  it('reads a real elevation at the Zermatt valley floor — NOT a void', async () => {
    const { tile } = await loadTileWindow(join(FIXTURE_DIR, 'zermatt-window.json'));
    // 46.0207 N, 7.7491 E → source (row 3525, col 2697) → window (31, 32),
    // byte offset (31×64+32)×2 = 4032, which reads 1608 m — Zermatt's real
    // village elevation (~1605 m). The mirror is void-filled, so the valley
    // floor here is data, not −32768.
    expect(tile.sampleAt(31, 32)).toBe(1608);
    const reading = tile.nearest(46.0207, 7.7491);
    expect(reading.status).toBe('ok');
    expect(reading.elevationM).toBe(1608);
    expect(tile.countVoids()).toBe(0);
  });

  it('has the valley floor below the flanking slopes, so the terrain is the right way up', async () => {
    const { tile } = await loadTileWindow(join(FIXTURE_DIR, 'zermatt-window.json'));
    // North-west corner (0,0) offset 0 = 2284 m, on the slope above the village;
    // the valley floor sample is 1608 m; south-west corner (63,0) offset 8064 = 1631 m.
    expect(tile.sampleAt(0, 0)).toBe(2284);
    expect(tile.sampleAt(63, 0)).toBe(1631);
    const floor = tile.sampleAt(31, 32);
    expect(floor).not.toBeNull();
    if (floor !== null) expect(floor).toBeLessThan(2284);
  });
});

/* ------------------------------------------------------------------ *
 * Sidecar validation
 * ------------------------------------------------------------------ */

describe('window sidecar', () => {
  it('rejects a sidecar in an unknown format', () => {
    expect(() => parseTileWindowMeta({ format: 'float32' }, 'x.json')).toThrow(
      /unsupported window format/,
    );
  });

  it('rejects a sidecar with no geometry or provenance', () => {
    const format = 'int16-be-row-major-north-first';
    expect(() => parseTileWindowMeta({ format }, 'x.json')).toThrow(/no geometry/);
    expect(() => parseTileWindowMeta({ format, geometry: { northLat: 1 } }, 'x.json')).toThrow(
      /no source provenance/,
    );
    expect(() =>
      parseTileWindowMeta({ format, geometry: {}, source: {}, name: 'x', data: 'x.i16be' }, 'x.json'),
    ).toThrow(/geometry.northLat must be a finite number/);
  });

  /* Wave 3 suspicion — a sidecar step is a DIVISOR. `HgtTile.indexFor` divides
   * by `latStepDeg`/`lonStepDeg`; a zero step yields NaN indices and a negative
   * one silently mirrors the grid, reading the wrong row for every query.
   * `parseTerrainManifest` already refuses both for a served grid; the file on
   * disk got no such check. */
  it('rejects a spacing that is not positive, which would divide by zero', () => {
    const format = 'int16-be-row-major-north-first';
    const good = {
      format,
      name: 'w',
      data: 'w.i16be',
      geometry: { northLat: 46, westLon: 7, rows: 3, cols: 3, latStepDeg: 0.5, lonStepDeg: 0.5 },
      source: { tile: 'N45E007', url: 'x', dataset: 'srtm1', extractedFromRow: 0, extractedFromCol: 0 },
    };
    expect(() => parseTileWindowMeta(good, 'w.json')).not.toThrow();
    for (const geometry of [
      { ...good.geometry, latStepDeg: 0 },
      { ...good.geometry, lonStepDeg: 0 },
      { ...good.geometry, latStepDeg: -1 / 3600 },
    ]) {
      expect(() => parseTileWindowMeta({ ...good, geometry }, 'w.json')).toThrow(
        /spacing must be positive/,
      );
    }
  });

  it('rejects a row/column count that cannot address a grid', () => {
    const format = 'int16-be-row-major-north-first';
    const good = {
      format,
      name: 'w',
      data: 'w.i16be',
      geometry: { northLat: 46, westLon: 7, rows: 3, cols: 3, latStepDeg: 0.5, lonStepDeg: 0.5 },
      source: { tile: 'N45E007', url: 'x', dataset: 'srtm1', extractedFromRow: 0, extractedFromCol: 0 },
    };
    for (const geometry of [
      { ...good.geometry, rows: 1 },
      { ...good.geometry, cols: 2.5 },
    ]) {
      expect(() => parseTileWindowMeta({ ...good, geometry }, 'w.json')).toThrow(
        /must be an integer >= 2/,
      );
    }
  });
});

/* ------------------------------------------------------------------ *
 * Whole synthetic tiles, loaded from disk by name
 * ------------------------------------------------------------------ */

describe('DirectoryTileStore over fixtures/tiles', () => {
  it('loads a tile by coordinate and derives its grid from the file length', async () => {
    const store = new DirectoryTileStore(FIXTURE_DIR);
    const tile = await store.tileFor(0.5, 0.5);
    expect(tile).not.toBeNull();
    if (tile === null) return;
    // N00E000.hgt is 882 bytes = 441 samples = 21², so spacing is 1/20.
    expect(tile.name).toBe('N00E000');
    expect(tile.geometry.rows).toBe(21);
    expect(tile.geometry.latStepDeg).toBe(1 / 20);
    // h = 500 + 300·lat + 200·lon + 400·lat·lon → h(1,0) = 800, h(0,1) = 700.
    expect(tile.sampleAt(0, 0)).toBe(800);
    expect(tile.sampleAt(20, 20)).toBe(700);
  });

  it('loads a southern + western tile under its own name', async () => {
    const store = new DirectoryTileStore(FIXTURE_DIR);
    const tile = await store.tileFor(-0.5, -0.5);
    expect(tile?.name).toBe('S01W001');
    expect(tile?.sampleAt(5, 5)).toBe(1234);
    expect(tile?.geometry.northLat).toBe(0);
    expect(tile?.southLat).toBe(-1);
  });

  it('transparently gunzips a .hgt.gz tile', async () => {
    const store = new DirectoryTileStore(FIXTURE_DIR);
    const tile = await store.tileFor(-1.5, -1.5);
    expect(tile?.name).toBe('S02W002');
    expect(tile?.sampleAt(0, 0)).toBe(777);
    expect(tile?.sampleAt(10, 10)).toBe(777);
  });

  it('returns null for a tile the directory does not have', async () => {
    const store = new DirectoryTileStore(FIXTURE_DIR);
    expect(await store.tileFor(45.9763, 7.6586)).toBeNull();
    expect(await store.tileByName('N45E007')).toBeNull();
  });

  it('caches parsed tiles and evicts the least recently used', async () => {
    const store = new DirectoryTileStore(FIXTURE_DIR, { maxCachedTiles: 2 });
    const first = await store.tileByName('N00E000');
    const again = await store.tileByName('N00E000');
    expect(again).toBe(first); // same object: parsed once
    expect(store.cachedNames).toEqual(['N00E000']);

    await store.tileByName('N01E000');
    expect(store.cachedNames).toEqual(['N00E000', 'N01E000']);

    await store.tileByName('S01W001');
    expect(store.cachedNames).toEqual(['N01E000', 'S01W001']);

    // Reloading the evicted tile parses it afresh.
    const reloaded = await store.tileByName('N00E000');
    expect(reloaded).not.toBe(first);
    expect(reloaded?.sampleAt(0, 0)).toBe(800);
  });

  it('keeps the two neighbouring tiles agreeing on their shared edge', async () => {
    const store = new DirectoryTileStore(FIXTURE_DIR);
    const south = await store.tileByName('N00E000');
    const north = await store.tileByName('N01E000');
    expect(south).not.toBeNull();
    expect(north).not.toBeNull();
    if (south === null || north === null) return;
    for (let col = 0; col <= 20; col += 1) {
      expect(north.sampleAt(20, col)).toBe(south.sampleAt(0, col));
    }
    // h(1, 0.35) = 500 + 300 + 70 + 140 = 1010.
    expect(north.sampleAt(20, 7)).toBe(1010);
  });

  it('reads voids out of a file as no-data', async () => {
    const store = new DirectoryTileStore(FIXTURE_DIR);
    const cone = await store.tileByName('N10W010');
    expect(cone).not.toBeNull();
    if (cone === null) return;
    // The generator writes rows 8…10 × cols 8…10 as voids: 3 × 3 = 9 samples.
    expect(cone.countVoids()).toBe(9);
    expect(cone.rawAt(9, 9)).toBe(VOID_SAMPLE);
    expect(cone.sampleAt(9, 9)).toBeNull();
    // The cone apex is the centre sample of a 41² grid: row 20, col 20 →
    // lat 11 − 20·0.025 = 10.5, lon −10 + 0.5 = −9.5, h = 3000 m exactly.
    expect(cone.sampleAt(20, 20)).toBe(3000);
    // Sample (11,11): Δ = (0.225, −0.225), r = 0.225√2 = 0.3181981°,
    // h = 3000 − 6000 r = 1090.81 → stored as 1091.
    expect(cone.sampleAt(11, 11)).toBe(1091);
    // Far from the apex the cone is clamped to the 500 m plain.
    expect(cone.sampleAt(0, 40)).toBe(500);
  });
});

describe('end to end: elevation provider over the fixture directory', () => {
  it('answers from files on disk, with voids preserved as null', async () => {
    const provider = new TileElevationProvider(new DirectoryTileStore(FIXTURE_DIR), {
      interpolation: 'nearest',
    });
    const results = await provider.fetchElevations([
      { lat: 1, lon: 0 }, // N00E000 north-west corner → 800 m
      { lat: -0.5, lon: -0.5 }, // S01W001 constant tile → 1234 m
      { lat: 10.775, lon: -9.775 }, // N10W010, dead centre of the void block
      { lat: 45.9763, lon: 7.6586 }, // no such tile here
    ]);
    expect(results.map((r) => r.elevationM)).toEqual([800, 1234, null, null]);
    expect(results.map((r) => r.dataset)).toEqual([
      'hgt-21',
      'hgt-11',
      'hgt-41',
      'local-tiles(missing)',
    ]);
  });
});

describe('DirectoryTileStore failure handling', () => {
  it('rejects a corrupt tile file and does not keep the failure cached', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mf-tiles-'));
    const target = join(dir, 'N45E007.hgt');
    // 10 bytes = 5 samples, and 5 is not a square: exactly what a truncated
    // download looks like.
    await writeFile(target, new Uint8Array(10));

    const store = new DirectoryTileStore(dir);
    await expect(store.tileByName('N45E007')).rejects.toThrow(/not a square grid/);
    expect(store.cachedNames).not.toContain('N45E007');

    // Replace it with a good tile: the store must not be stuck on the old failure.
    await writeFile(target, buildSyntheticHgtBytes({
      name: 'N45E007',
      gridSize: 11,
      terrain: () => 2000,
    }));
    const tile = await store.tileByName('N45E007');
    expect(tile?.sampleAt(0, 0)).toBe(2000);
  });
});
