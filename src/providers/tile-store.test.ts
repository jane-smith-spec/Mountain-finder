/**
 * Tile naming and lookup.
 *
 * The naming rule is `floor`, not truncation, and the difference only shows up
 * in the southern and western hemispheres — where the wrong answer is still a
 * well-formed tile name for a real square of the Earth 111 km away. So every
 * hemisphere combination is tested with the expected name written out by hand.
 */

import { describe, expect, it } from 'vitest';

import {
  MemoryTileStore,
  normaliseLon,
  parseNamedTile,
  parseTileName,
  tileCornerFor,
  tileNameFor,
  tileNameForCorner,
  tileNamesForBounds,
} from './tile-store.js';
import { bilinearTerrain, buildSyntheticHgtBytes, buildSyntheticTile } from './synthetic-tile.js';
import { normaliseLongitudeDeg } from '../core/geodesy.js';

describe('tileNameFor', () => {
  const cases: readonly (readonly [number, number, string, string])[] = [
    [45.9763, 7.6586, 'N45E007', 'Matterhorn — both positive'],
    [46.0207, 7.7491, 'N46E007', 'Zermatt is NORTH of 46°, so a different tile from the Matterhorn'],
    [45.0, 7.0, 'N45E007', 'exact integers name the tile they OPEN'],
    [45.999999, 7.999999, 'N45E007', 'just inside the north-east corner'],
    [0, 0, 'N00E000', 'the null island tile'],
    [-0.5, -0.5, 'S01W001', 'floor(−0.5) = −1 in both axes'],
    [-0.000001, -0.000001, 'S01W001', 'a hair south/west of the origin is already the next tile'],
    [-33.9249, 18.4241, 'S34E018', 'Cape Town — trunc would say S33, 111 km wrong'],
    [-22.9519, -43.2105, 'S23W044', 'Rio — trunc would say S22 W043, wrong in both axes'],
    [-45, -70, 'S45W070', 'exact negative integers name themselves (floor is a no-op)'],
    [61.2181, -149.9003, 'N61W150', 'Anchorage — floor(−149.9) = −150'],
    [27.9881, 86.925, 'N27E086', 'Everest'],
    [-90, 0, 'S90E000', 'south pole'],
    [90, 0, 'N89E000', 'the north pole belongs to the tile below it — N90 does not exist'],
    [45.5, 180, 'N45W180', 'lon 180 wraps to −180'],
    [45.5, -180, 'N45W180', 'lon −180 is the same meridian'],
    [45.5, 179.5, 'N45E179', 'last tile east'],
    [45.5, -179.5, 'N45W180', 'first tile west'],
    [45.5, -0.5, 'N45W001', 'just west of Greenwich'],
    [45.5, 0, 'N45E000', 'exactly Greenwich'],
  ];

  for (const [lat, lon, expected, why] of cases) {
    it(`${lat}, ${lon} → ${expected} (${why})`, () => {
      expect(tileNameFor(lat, lon)).toBe(expected);
    });
  }

  it('is not truncation — the southern/western cases would differ', () => {
    // Written as an explicit contrast so a future "simplification" to Math.trunc
    // fails loudly instead of quietly loading the neighbouring square.
    const truncName = (lat: number, lon: number): string =>
      tileNameForCorner({ southLat: Math.trunc(lat), westLon: Math.trunc(lon) });
    expect(truncName(-33.9249, 18.4241)).toBe('S33E018');
    expect(tileNameFor(-33.9249, 18.4241)).toBe('S34E018');
    expect(truncName(-22.9519, -43.2105)).toBe('S22W043');
    expect(tileNameFor(-22.9519, -43.2105)).toBe('S23W044');
  });

  it('zero-pads to two digits of latitude and three of longitude', () => {
    expect(tileNameFor(5.5, 5.5)).toBe('N05E005');
    expect(tileNameFor(5.5, 95.5)).toBe('N05E095');
    expect(tileNameFor(-5.5, -95.5)).toBe('S06W096');
  });

  it('rejects impossible coordinates instead of naming a tile that cannot exist', () => {
    expect(() => tileNameFor(91, 0)).toThrow(/outside/);
    expect(() => tileNameFor(Number.NaN, 0)).toThrow();
    expect(() => tileNameFor(0, Number.POSITIVE_INFINITY)).toThrow();
  });

  it('gives the south-west corner the name encodes', () => {
    expect(tileCornerFor(45.9763, 7.6586)).toEqual({ southLat: 45, westLon: 7 });
    expect(tileCornerFor(-33.9249, -43.2105)).toEqual({ southLat: -34, westLon: -44 });
  });
});

describe('normaliseLon', () => {
  it('wraps into [−180, 180)', () => {
    expect(normaliseLon(0)).toBe(0);
    expect(normaliseLon(179.9)).toBeCloseTo(179.9, 10);
    expect(normaliseLon(180)).toBe(-180);
    expect(normaliseLon(-180)).toBe(-180);
    expect(normaliseLon(190)).toBeCloseTo(-170, 10);
    expect(normaliseLon(-190)).toBeCloseTo(170, 10);
    expect(normaliseLon(360)).toBe(0);
    expect(normaliseLon(-0)).toBe(0);
  });
});

describe('parseTileName', () => {
  it('round-trips every hemisphere', () => {
    for (const name of ['N45E007', 'S34E018', 'S23W044', 'N00E000', 'S90W180']) {
      const corner = parseTileName(name);
      expect(corner).not.toBeNull();
      if (corner !== null) expect(tileNameForCorner(corner)).toBe(name);
    }
  });

  it('reads the sign from the hemisphere letter', () => {
    expect(parseTileName('N45E007')).toEqual({ southLat: 45, westLon: 7 });
    expect(parseTileName('S01W001')).toEqual({ southLat: -1, westLon: -1 });
    expect(parseTileName('s01w001')).toEqual({ southLat: -1, westLon: -1 });
    expect(parseTileName(' N45E007 ')).toEqual({ southLat: 45, westLon: 7 });
  });

  it('rejects anything that is not a tile name', () => {
    for (const bad of ['N45E7', 'N45', 'X45E007', '', 'N45E007.hgt', 'N91E007', 'N45E181']) {
      expect(parseTileName(bad)).toBeNull();
    }
  });

  it('refuses to parse tile bytes under a name that is not a tile name', () => {
    expect(() => parseNamedTile('nonsense', new Uint8Array(8))).toThrow(/not an SRTM tile name/);
  });
});

describe('tileNamesForBounds', () => {
  it('covers a box that straddles a degree line', () => {
    expect(tileNamesForBounds({ south: 45.9, west: 7.6, north: 46.1, east: 7.9 })).toEqual([
      'N45E007',
      'N46E007',
    ]);
  });

  it('returns a single tile for a box inside one degree square', () => {
    expect(tileNamesForBounds({ south: 45.1, west: 7.1, north: 45.2, east: 7.2 })).toEqual([
      'N45E007',
    ]);
  });

  it('covers a 2 × 2 block', () => {
    expect(tileNamesForBounds({ south: 45.5, west: 7.5, north: 46.5, east: 8.5 })).toEqual([
      'N45E007',
      'N45E008',
      'N46E007',
      'N46E008',
    ]);
  });

  it('handles southern and western boxes', () => {
    expect(tileNamesForBounds({ south: -34.2, west: -43.5, north: -33.8, east: -43.2 })).toEqual([
      'S35W044',
      'S34W044',
    ]);
  });

  it('walks the short way round the antimeridian', () => {
    // west 179.5 → east −179.5 is one degree wide, not 359.
    expect(tileNamesForBounds({ south: 0.5, west: 179.5, north: 0.6, east: -179.5 })).toEqual([
      'N00E179',
      'N00W180',
    ]);
  });

  it('rejects an inverted box', () => {
    expect(() => tileNamesForBounds({ south: 46, west: 7, north: 45, east: 8 })).toThrow(
      /below south/,
    );
  });

  /* Wave 3 finding 1 — a 360°-wide box must not collapse onto one meridian.
   * −180 and +180 name the same line, so normalising both ends first makes a
   * whole-world box indistinguishable from a zero-width one. The expectation is
   * arithmetic, not observation: a full turn of longitude walked in whole
   * degrees is 360 columns, one per integer meridian, W180 … E179. */
  it('covers all 360 meridians for a box spanning the whole world', () => {
    const names = tileNamesForBounds({ south: 89, north: 90, west: -180, east: 180 });
    expect(names).toHaveLength(360);
    expect(new Set(names).size).toBe(360);
    // The pole belongs to the 89° band, so this is one latitude band of 360.
    expect(names).toContain('N89W180');
    expect(names).toContain('N89W001');
    expect(names).toContain('N89E000');
    expect(names).toContain('N89E010'); // the square under an observer at 89 N, 10 E
    expect(names).toContain('N89E179');
  });

  it('covers all 360 meridians for the unnormalised ±180 box a polar circle makes', () => {
    // `boundsAround` in scripts/fetch-tiles.ts caps dLon at 180 and emits
    // centre.lon ± 180 without normalising: 10 − 180 = −170 … 10 + 180 = 190.
    // Both ends normalise to −170, which is a full turn, not a point.
    const names = tileNamesForBounds({ south: 88.2, north: 90, west: -170, east: 190 });
    expect(new Set(names).size).toBe(2 * 360); // bands N88 and N89
    expect(names).toContain('N89E010');
    expect(names).toContain('N88E010');
  });

  it('clamps a box wider than the world to one turn rather than repeating tiles', () => {
    const names = tileNamesForBounds({ south: 0.2, north: 0.3, west: -200, east: 200 });
    expect(names).toHaveLength(360);
    expect(new Set(names).size).toBe(360);
  });

  it('still walks the short way for a box that merely touches the seam', () => {
    // Regression guard for the fix above: only a FULL turn is special.
    expect(tileNamesForBounds({ south: 0.5, west: 179.33, north: 0.6, east: 180.47 })).toEqual([
      'N00E179',
      'N00W180',
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * Adjacent tiles share their boundary line
 * ------------------------------------------------------------------ */

/** h = 500 + 300·lat + 200·lon + 400·lat·lon — see hgt-tile.test.ts. */
const SURFACE = bilinearTerrain({
  originLat: 0,
  originLon: 0,
  baseM: 500,
  perLatDegM: 300,
  perLonDegM: 200,
  crossM: 400,
});

describe('adjacent tiles overlap on their shared edge', () => {
  const south = buildSyntheticTile({ name: 'N00E000', gridSize: 21, terrain: SURFACE });
  const north = buildSyntheticTile({ name: 'N01E000', gridSize: 21, terrain: SURFACE });

  it('duplicates the lat = 1 line: N00E000 row 0 is N01E000 row 20', () => {
    for (let col = 0; col <= 20; col += 1) {
      expect(south.sampleAt(0, col)).toBe(north.sampleAt(20, col));
    }
    // Spot value, computed by hand: h(1, 0.35) = 500 + 300 + 70 + 140 = 1010.
    expect(south.sampleAt(0, 7)).toBe(1010);
    expect(north.sampleAt(20, 7)).toBe(1010);
  });

  it('gives the same elevation from either tile on the shared line', () => {
    // h(1, 0.375) = 500 + 300 + 75 + 150 = 1025.
    expect(south.bilinear(1, 0.375).elevationM).toBeCloseTo(1025, 10);
    expect(north.bilinear(1, 0.375).elevationM).toBeCloseTo(1025, 10);
  });

  it('sends a point exactly on the line to the NORTHERN tile', async () => {
    const store = new MemoryTileStore([
      ['N00E000', south],
      ['N01E000', north],
    ]);
    expect(tileNameFor(1, 0.375)).toBe('N01E000');
    const tile = await store.tileFor(1, 0.375);
    expect(tile?.name).toBe('N01E000');
    // A hair below the line falls to the southern tile, and both agree there
    // to within the 0.05° sampling — continuity across the seam.
    const below = await store.tileFor(0.999999, 0.375);
    expect(below?.name).toBe('N00E000');
  });
});

describe('MemoryTileStore', () => {
  const tile = buildSyntheticTile({ name: 'N00E000', gridSize: 21, terrain: SURFACE });

  it('finds tiles by coordinate and by name, case-insensitively', async () => {
    const store = new MemoryTileStore().set('N00E000', tile);
    expect((await store.tileFor(0.5, 0.5))?.name).toBe('N00E000');
    expect((await store.tileByName('n00e000'))?.name).toBe('N00E000');
    expect(store.names).toEqual(['N00E000']);
  });

  it('returns null for a tile it does not hold — "no data" is not an error', async () => {
    const store = new MemoryTileStore().set('N00E000', tile);
    expect(await store.tileFor(45.9, 7.6)).toBeNull();
    expect(await store.tileByName('N45E007')).toBeNull();
  });
});

describe('parseNamedTile', () => {
  it('derives geometry from the name for a southern/western tile', () => {
    const bytes = buildSyntheticHgtBytes({
      name: 'S01W001',
      gridSize: 11,
      terrain: () => 1234,
    });
    const tile = parseNamedTile('s01w001', bytes);
    expect(tile.name).toBe('S01W001');
    expect(tile.geometry.northLat).toBe(0);
    expect(tile.southLat).toBe(-1);
    expect(tile.geometry.westLon).toBe(-1);
    expect(tile.eastLon).toBe(0);
    expect(tile.geometry.rows).toBe(11);
    expect(tile.sampleAt(0, 0)).toBe(1234);
    expect(tile.sampleAt(10, 10)).toBe(1234);
    expect(tile.nearest(-0.5, -0.5)).toEqual({ status: 'ok', elevationM: 1234, method: 'nearest' });
  });
});

/**
 * THE SEAM, END TO END — naming and reading have to agree at ±180.
 *
 * `normaliseLon` here folds onto [−180, 180) and `src/core/geodesy`'s
 * `normaliseLongitudeDeg` folds onto (−180, +180]. Both are deliberate and both
 * are documented (tile-store.ts's header explains why they must differ), which
 * makes the JOIN between them the thing that needs a test: a coordinate
 * produced by core's convention must be readable through the store's.
 */
describe('the antimeridian, from coordinate to elevation', () => {
  const tile = buildSyntheticTile({
    name: 'N45W180',
    gridSize: 11,
    // 100 m per degree east of −180: the seam itself is exactly 0 m.
    terrain: bilinearTerrain({
      originLat: 45,
      originLon: -180,
      baseM: 0,
      perLatDegM: 0,
      perLonDegM: 100,
    }),
  });

  it('names, loads and reads the same tile from both signs of 180', () => {
    const store = new MemoryTileStore().set('N45W180', tile);

    expect(tileNameFor(45.5, 180)).toBe('N45W180');
    expect(tileNameFor(45.5, -180)).toBe('N45W180');
    expect(normaliseLon(180)).toBe(-180);
    // core's opposite convention: normaliseLongitudeDeg(-180) === 180, so a
    // destinationPoint stepping east across the seam hands us exactly +180.
    expect(normaliseLongitudeDeg(-180)).toBe(180);

    return Promise.all([store.tileFor(45.5, 180), store.tileFor(45.5, -180)]).then(
      ([east, west]) => {
        expect(east).not.toBeNull();
        expect(west).toBe(east);
        // The bug this covers: the store used to hand back the tile and the
        // tile used to refuse the coordinate, so the answer was an honest but
        // wrong "no data" over bytes we were holding.
        expect(east?.read(45.5, 180)).toEqual({
          status: 'ok',
          elevationM: 0,
          method: 'bilinear',
        });
        expect(east?.read(45.5, -179.25).elevationM).toBe(75);
      },
    );
  });
});
