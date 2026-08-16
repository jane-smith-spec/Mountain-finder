/**
 * Tests for the offline peak database (BUILD 1).
 *
 * WHERE THE EXPECTATIONS COME FROM. Distances and bearings asserted here were
 * NOT produced by running this code. They are the figures derived by hand in
 * the header of `tests/acceptance/cases/gornergrat.ts` from the cited
 * coordinates — Matterhorn 9.6 km, Dufourspitze 8.4 km, Breithorn 5.4 km from
 * the Gornergrat platform — quoted there to 0.1 km, which is the tolerance used
 * below. Elevations are the published summit heights in the same case files.
 */

import { describe, expect, it } from 'vitest';

import { groundTruthPeakDataset, groundTruthPeakStore } from '../../fixtures/peaks';
import { ProviderError } from './errors';
import { LocalPeakStore, parsePeakDataset, toPeak, type PeakDataset } from './peak-store';

/** The Gornergrat railway platform — observer of the gornergrat ground-truth case. */
const GORNERGRAT = { lat: 45.98333, lon: 7.78222 };

/** A minimal well-formed dataset, mutated field by field in the rejection tests. */
function minimalDataset(): Record<string, unknown> {
  return {
    version: 1,
    description: 'two summits and one citation',
    sources: [
      {
        id: 'src-a',
        title: 'A gazetteer',
        url: 'https://example.invalid/a',
        retrieved: '2026-08-16',
        access: 'derived',
      },
    ],
    peaks: [
      {
        id: 'test/alpha',
        name: 'Alpha',
        lat: 10,
        lon: 20,
        elevationM: 1000,
        positionSourceId: 'src-a',
        elevationSourceId: 'src-a',
        elevationSourceKind: 'unknown',
        usedBy: ['synthetic'],
      },
      {
        id: 'test/beta',
        name: 'Beta',
        lat: 10.1,
        lon: 20,
        elevationM: 2000,
        positionSourceId: 'src-a',
        elevationSourceId: 'src-a',
        elevationSourceKind: 'osm',
        usedBy: ['synthetic'],
      },
    ],
  };
}

/** Deep-clone the literal so a mutation in one test cannot leak into another. */
function mutated(mutate: (dataset: Record<string, unknown>) => void): Record<string, unknown> {
  const dataset = JSON.parse(JSON.stringify(minimalDataset())) as Record<string, unknown>;
  mutate(dataset);
  return dataset;
}

function peaksOf(dataset: Record<string, unknown>): Record<string, unknown>[] {
  return dataset['peaks'] as Record<string, unknown>[];
}

function firstPeak(dataset: Record<string, unknown>): Record<string, unknown> {
  const peak = peaksOf(dataset)[0];
  if (peak === undefined) throw new Error('test dataset lost its first peak');
  return peak;
}

describe('parsePeakDataset — the file is data, so it gets validated like data', () => {
  it('accepts a well-formed dataset and keeps every field', () => {
    const dataset = parsePeakDataset(minimalDataset());
    expect(dataset.version).toBe(1);
    expect(dataset.peaks).toHaveLength(2);
    expect(dataset.peaks[0]?.name).toBe('Alpha');
    expect(dataset.peaks[1]?.elevationSourceKind).toBe('osm');
  });

  it('rejects a peak whose citation resolves to no source', () => {
    const bad = mutated((d) => {
      firstPeak(d)['elevationSourceId'] = 'src-does-not-exist';
    });
    expect(() => parsePeakDataset(bad)).toThrow(ProviderError);
    expect(() => parsePeakDataset(bad)).toThrow(/resolves to no source/);
  });

  it('rejects a missing elevation rather than defaulting it to zero', () => {
    const bad = mutated((d) => {
      delete firstPeak(d)['elevationM'];
    });
    expect(() => parsePeakDataset(bad)).toThrow(/elevationM must be a finite number/);
  });

  it('rejects a latitude outside [-90, 90]', () => {
    const bad = mutated((d) => {
      firstPeak(d)['lat'] = 95;
    });
    expect(() => parsePeakDataset(bad)).toThrow(/lat 95 is outside/);
  });

  it('rejects duplicate peak ids, which would make byId silently ambiguous', () => {
    const bad = mutated((d) => {
      const peaks = peaksOf(d);
      const second = peaks[1];
      if (second !== undefined) second['id'] = 'test/alpha';
    });
    expect(() => parsePeakDataset(bad)).toThrow(/duplicate peak id test\/alpha/);
  });

  it('rejects an elevationSourceKind core does not define', () => {
    const bad = mutated((d) => {
      firstPeak(d)['elevationSourceKind'] = 'wikipedia';
    });
    expect(() => parsePeakDataset(bad)).toThrow(/elevationSourceKind must be one of/);
  });

  it('rejects a non-object payload', () => {
    expect(() => parsePeakDataset('not a dataset')).toThrow(/expected an object/);
    expect(() => parsePeakDataset(null)).toThrow(/expected an object/);
  });
});

describe('LocalPeakStore — radius queries', () => {
  const store = new LocalPeakStore(parsePeakDataset(minimalDataset()));

  it('returns nothing outside the radius', async () => {
    // Alpha and Beta are 0.1 deg of latitude apart = 11.1 km. A 5 km radius
    // around Alpha therefore holds Alpha alone.
    expect(await store.peaksWithin({ lat: 10, lon: 20 }, 5)).toHaveLength(1);
    expect(await store.peaksWithin({ lat: 10, lon: 20 }, 12)).toHaveLength(2);
  });

  it('refuses a negative radius instead of quietly returning nothing', () => {
    expect(() => store.recordsWithin({ lat: 10, lon: 20 }, -1)).toThrow(RangeError);
  });

  /* Wave 3 suspicion — two stores, one contract. `TiledPeakStore` has to
   * re-sort the sightings it collects from several cells and breaks ties on the
   * peak id; `LocalPeakStore` left ties in dataset order. Same query, same
   * peaks, different order, and anything downstream that takes "the first n" or
   * places labels in order gets a different answer depending on which store it
   * was handed. The tie-break is the id, in both. */
  it('breaks a distance tie on the peak id, like the tiled store', () => {
    const tied = mutated((d) => {
      const peaks = peaksOf(d);
      const first = peaks[0];
      const second = peaks[1];
      if (first === undefined || second === undefined) throw new Error('lost a peak');
      // Symmetric about lat 10: both are exactly 0.05° from the query point,
      // and the one listed FIRST sorts SECOND by id.
      first['id'] = 'test/zulu';
      first['lat'] = 10.05;
      second['id'] = 'test/alpha';
      second['lat'] = 9.95;
    });
    const store = new LocalPeakStore(parsePeakDataset(tied));
    const found = store.recordsWithin({ lat: 10, lon: 20 }, 10);
    expect(found.map((sighting) => sighting.record.id)).toEqual(['test/alpha', 'test/zulu']);
  });

  it('reports each record with the range the geometry core will compute', () => {
    const [nearest, next] = store.recordsWithin({ lat: 10, lon: 20 }, 50);
    expect(nearest?.distanceKm).toBeCloseTo(0, 6);
    // 0.1 deg of latitude on a sphere of R = 6 371 008.8 m:
    //   0.1 * pi/180 * 6371008.8 m = 11 119.5 m.
    expect(next?.distanceKm).toBeCloseTo(11.1195, 3);
  });
});

/* Wave 3 finding 2 — one notion of "inside this box".
 *
 * A degree box is a longitude INTERVAL walked eastward from `west`, exactly as
 * `tileNamesForBounds` walks it. Longitudes are periodic, so a box may be
 * written unnormalised (179.33 … 180.47, which `boundingBoxAround` emits near
 * the seam) while the peaks in it are stored in [−180, 180]. Comparing the two
 * raw discards everything west of the meridian.
 *
 * Coordinates below are the Fiji-side reproduction from the review: a box
 * 179.33 … 180.47 E is 1.14° wide, so a summit at 179.6 E sits 0.27° into it
 * and a summit at 179.7 W — the same line as 180.3 E — sits 0.97° into it.
 * Both are inside; a summit at 178.9 W (181.1 E) is 1.77° along and outside.
 */
describe('LocalPeakStore — a box that crosses the antimeridian', () => {
  function seamStore(): LocalPeakStore {
    const dataset = mutated((d) => {
      const peaks = peaksOf(d);
      const east = peaks[0];
      const west = peaks[1];
      if (east === undefined || west === undefined) throw new Error('test dataset lost a peak');
      east['id'] = 'test/east-of-seam';
      east['name'] = 'East of seam';
      east['lat'] = -17.6;
      east['lon'] = 179.6;
      west['id'] = 'test/west-of-seam';
      west['name'] = 'West of seam';
      west['lat'] = -17.6;
      west['lon'] = -179.7;
    });
    return new LocalPeakStore(parsePeakDataset(dataset));
  }

  const box = { south: -18.5, west: 179.33, north: -17.5, east: 180.47 };

  it('keeps the peaks on BOTH sides of the meridian', () => {
    const found = seamStore().recordsInBox(box);
    expect([...found.map((record) => record.id)].sort()).toEqual([
      'test/east-of-seam',
      'test/west-of-seam',
    ]);
  });

  it('still excludes a peak past the box’s east edge', () => {
    const found = seamStore().recordsInBox({ ...box, east: 180.1 });
    expect(found.map((record) => record.id)).toEqual(['test/east-of-seam']);
  });

  it('does not claim an empty area while holding matching peaks', async () => {
    await expect(seamStore().fetchPeaks({ bbox: box })).resolves.toHaveLength(2);
  });
});

describe('LocalPeakStore — the committed ground-truth dataset', () => {
  it('parses at import time with every citation resolving', () => {
    expect(groundTruthPeakDataset.peaks.length).toBeGreaterThanOrEqual(15);
    for (const peak of groundTruthPeakDataset.peaks) {
      expect(groundTruthPeakStore.source(peak.positionSourceId)).toBeDefined();
      expect(groundTruthPeakStore.source(peak.elevationSourceId)).toBeDefined();
      expect(peak.usedBy.length).toBeGreaterThan(0);
    }
  });

  it('finds the three Gornergrat summits within 10 km, nearest first', async () => {
    const peaks = await groundTruthPeakStore.peaksWithin(GORNERGRAT, 10);
    // Order and ranges from the gornergrat case header: Breithorn 5.4 km,
    // Dufourspitze 8.4 km, Matterhorn 9.6 km.
    expect(peaks.map((peak) => peak.name)).toEqual(['Breithorn', 'Dufourspitze', 'Matterhorn']);

    const ranges = groundTruthPeakStore.recordsWithin(GORNERGRAT, 10);
    expect(ranges[0]?.distanceKm).toBeCloseTo(5.4, 1);
    expect(ranges[1]?.distanceKm).toBeCloseTo(8.4, 1);
    expect(ranges[2]?.distanceKm).toBeCloseTo(9.6, 1);
  });

  it('excludes the Matterhorn at a 6 km radius — the filter is a real filter', async () => {
    const peaks = await groundTruthPeakStore.peaksWithin(GORNERGRAT, 6);
    expect(peaks.map((peak) => peak.name)).toEqual(['Breithorn']);
  });

  it('serves summit heights from the database, NOT from the elevation tiles', () => {
    const matterhorn = groundTruthPeakStore.byId('mf/matterhorn');
    expect(matterhorn?.elevationM).toBe(4478);
    // N45E007's highest posting on the Matterhorn massif is 4230 m, 248 m low
    // and ~320 m WSW of the surveyed summit (MISSION.md). If this ever reads
    // 4230 someone has wired the DEM into the peak database.
    expect(matterhorn?.elevationM).not.toBe(4230);
    expect(toPeak(matterhorn ?? missing('mf/matterhorn')).elevationSource).toBe('unknown');
  });

  it('carries every peak the four ground-truth cases name', () => {
    const names = new Set(groundTruthPeakDataset.peaks.map((peak) => peak.name));
    for (const expected of [
      'Matterhorn',
      'Dufourspitze',
      'Breithorn',
      'Mount Hamilton',
      'Mount Saint Helena',
      'Mount Tamalpais East Peak',
      'Lassen Peak',
      'Half Dome',
      'Sentinel Dome',
      'Mount Rainier',
      'Mount Baker',
      'Mount Hood',
      'Ben Nevis',
      'Cow Hill',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('looks peaks up by name and by id', () => {
    expect(groundTruthPeakStore.byName('Ben Nevis')).toHaveLength(1);
    expect(groundTruthPeakStore.byName('Nonexistent Hill')).toHaveLength(0);
    expect(groundTruthPeakStore.byId('mf/cow-hill')?.elevationM).toBe(287);
  });
});

describe('LocalPeakStore — the PeaksProvider seam', () => {
  const store = new LocalPeakStore(parsePeakDataset(minimalDataset()));

  it('answers a bounding-box search', async () => {
    const found = await store.fetchPeaks({
      bbox: { south: 9.9, west: 19.9, north: 10.05, east: 20.1 },
    });
    expect(found.map((peak) => peak.name)).toEqual(['Alpha']);
  });

  it('throws empty-result on an empty area, exactly like the Overpass client', async () => {
    const area = { center: { lat: -40, lon: 0 }, radiusKm: 10 };
    await expect(store.fetchPeaks(area)).rejects.toMatchObject({ code: 'empty-result' });
    await expect(store.fetchPeaks(area, { allowEmpty: true })).resolves.toEqual([]);
  });

  it('honours an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      store.fetchPeaks({ center: { lat: 10, lon: 20 }, radiusKm: 5 }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });

  it('never hands core a candidate without a height', async () => {
    const found = await store.fetchPeaks({ center: { lat: 10, lon: 20 }, radiusKm: 50 });
    for (const candidate of found) {
      expect(candidate.elevationM).not.toBeNull();
    }
  });
});

/** `noUncheckedIndexedAccess`-friendly failure for a lookup that must succeed. */
function missing(id: string): never {
  throw new Error(`expected the dataset to contain ${id}`);
}

/** Type-level guard: the exported dataset really is a PeakDataset. */
const _typecheck: PeakDataset = groundTruthPeakDataset;
void _typecheck;
