/**
 * The pure half of the Overture importer: row shape → peak record.
 *
 * HOW THE EXPECTATIONS WERE OBTAINED. Not by running this code. The row shapes
 * below are transcribed from rows actually decoded out of Overture release
 * 2026-06-17.0, `theme=base/type=land`, part-00011 — the same rows the
 * committed fixture in `fixtures/parquet/` holds — and the summit values they
 * carry (Matterhorn 4478 m at 45.9764…, 7.6586…) are the values this repository
 * already cites in `fixtures/peaks/ground-truth-peaks.json`. The float32
 * arithmetic is derived from IEEE-754, stated in the assertions, not measured.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SUMMIT_CLASSES,
  OVERTURE_ID_PREFIX,
  OVERTURE_LAND_COLUMNS,
  POINT_BBOX_TOLERANCE_DEG,
  boxContains,
  boxesIntersect,
  classifyOvertureRow,
  importOvertureRows,
  pointFromBbox,
  readOvertureLandRow,
} from './overture-peaks.js';

/** The Matterhorn exactly as Overture returns it (transcribed from the live read). */
const MATTERHORN_ROW = {
  id: '85f3513e-4153-3a34-8c12-acf0afccf08d',
  names: {
    primary: 'Matterhorn',
    common: { de: 'Matterhorn', fr: 'Cervin', it: 'Cervino' },
    rules: [{ variant: 'alternate', language: null, value: 'Cervino', side: null }],
  },
  subtype: 'physical',
  class: 'peak',
  elevation: 4478,
  bbox: {
    xmin: 7.658602237701416,
    xmax: 7.658603191375732,
    ymin: 45.97642517089844,
    ymax: 45.97643280029297,
  },
};

const SOURCE_ID = 'overture-2026-06-17.0-base-land';

describe('the columns the importer asks for', () => {
  it('names the six that carry a summit, and never geometry', () => {
    expect([...OVERTURE_LAND_COLUMNS]).toEqual([
      'id',
      'names',
      'subtype',
      'class',
      'elevation',
      'bbox',
    ]);
    // `geometry` is ~96% of a row group's bytes. Asking for it would undo the
    // entire point of the design, so its absence is an assertion, not an omission.
    expect(OVERTURE_LAND_COLUMNS).not.toContain('geometry');
  });

  it('imports volcanoes as well as peaks', () => {
    // Mount Rainier, Baker, Hood and Lassen are natural=volcano in OSM and are
    // gated on by the acceptance suite; importing only `peak` loses all four.
    expect([...DEFAULT_SUMMIT_CLASSES]).toEqual(['peak', 'volcano']);
  });
});

describe('readOvertureLandRow', () => {
  it('flattens the nested names struct down to names.primary', () => {
    const feature = readOvertureLandRow(MATTERHORN_ROW);
    expect(feature?.namePrimary).toBe('Matterhorn');
    expect(feature?.featureClass).toBe('peak');
    expect(feature?.subtype).toBe('physical');
    expect(feature?.elevationM).toBe(4478);
    expect(feature?.id).toBe('85f3513e-4153-3a34-8c12-acf0afccf08d');
  });

  it('reads an unnamed feature as name null rather than inventing one', () => {
    expect(readOvertureLandRow({ ...MATTERHORN_ROW, names: null })?.namePrimary).toBeNull();
    expect(readOvertureLandRow({ ...MATTERHORN_ROW, names: {} })?.namePrimary).toBeNull();
    expect(readOvertureLandRow({ ...MATTERHORN_ROW, names: { primary: '   ' } })?.namePrimary)
      .toBeNull();
  });

  it('reads a missing elevation as null rather than zero', () => {
    // Zero metres is a real elevation. Coercing "absent" to it would put a
    // Himalayan glacier label at sea level.
    expect(readOvertureLandRow({ ...MATTERHORN_ROW, elevation: null })?.elevationM).toBeNull();
    expect(readOvertureLandRow({ ...MATTERHORN_ROW, elevation: 0 })?.elevationM).toBe(0);
  });

  it('refuses a row with no usable bbox', () => {
    expect(readOvertureLandRow({ ...MATTERHORN_ROW, bbox: undefined })).toBeNull();
    expect(readOvertureLandRow({ ...MATTERHORN_ROW, bbox: { xmin: 1, xmax: 2, ymin: 3 } })).toBeNull();
    expect(readOvertureLandRow(null)).toBeNull();
    expect(readOvertureLandRow([MATTERHORN_ROW])).toBeNull();
  });
});

describe('pointFromBbox', () => {
  it('recovers the Matterhorn summit to within a metre of the cited coordinate', () => {
    const point = pointFromBbox(MATTERHORN_ROW.bbox);
    expect(point).not.toBeNull();
    if (point === null) throw new Error('unreachable');

    // ground-truth-peaks.json cites 45.976389, 7.658611 for the Matterhorn.
    // One degree of latitude is 111.32 km; one degree of longitude at 46°N is
    // 111.32·cos 46° = 77.34 km. So a 1e-4° tolerance is ~11 m and 8 m.
    expect(point.lat).toBeCloseTo(45.976389, 4);
    expect(point.lon).toBeCloseTo(7.658611, 4);

    // Tighter: the bbox is Overture's outward float32 rounding of one point,
    // so the true coordinate lies inside it by construction.
    expect(point.lat).toBeGreaterThan(MATTERHORN_ROW.bbox.ymin);
    expect(point.lat).toBeLessThan(MATTERHORN_ROW.bbox.ymax);
  });

  it('confirms Overture writes bbox as exact float32 values', () => {
    // Math.fround is the IEEE-754 round-to-float32. Every corner surviving it
    // unchanged is what makes the span bound in POINT_BBOX_TOLERANCE_DEG valid.
    for (const value of Object.values(MATTERHORN_ROW.bbox)) {
      expect(Math.fround(value)).toBe(value);
    }
    // …and the corners bracket rather than coincide: the rounding is outward.
    expect(MATTERHORN_ROW.bbox.xmax).toBeGreaterThan(MATTERHORN_ROW.bbox.xmin);
    expect(MATTERHORN_ROW.bbox.xmax - MATTERHORN_ROW.bbox.xmin).toBeLessThan(
      POINT_BBOX_TOLERANCE_DEG,
    );
  });

  it('refuses an extended feature instead of returning its bbox centre', () => {
    // A glacier polygon: the centre of its bounding box is not a summit.
    expect(
      pointFromBbox({ xmin: 7.6446, xmax: 7.6749, ymin: 45.9805, ymax: 45.992 }),
    ).toBeNull();
    // Exactly on the tolerance is still a point; a hair over is not.
    expect(pointFromBbox({ xmin: 0, xmax: POINT_BBOX_TOLERANCE_DEG, ymin: 0, ymax: 0 })).toEqual({
      lat: 0,
      lon: POINT_BBOX_TOLERANCE_DEG / 2,
    });
    expect(
      pointFromBbox({ xmin: 0, xmax: POINT_BBOX_TOLERANCE_DEG * 1.01, ymin: 0, ymax: 0 }),
    ).toBeNull();
  });

  it('refuses an inverted or out-of-range bbox', () => {
    expect(pointFromBbox({ xmin: 2, xmax: 1, ymin: 0, ymax: 0 })).toBeNull();
    expect(pointFromBbox({ xmin: 0, xmax: 0, ymin: 91, ymax: 91 })).toBeNull();
  });
});

describe('boxesIntersect / boxContains', () => {
  const alps = { south: 45.6, west: 7.2, north: 46.4, east: 8.2 };

  it('treats shared edges as touching, so a summit on a boundary is never lost', () => {
    expect(boxesIntersect(alps, { south: 46.4, west: 8.2, north: 47, east: 9 })).toBe(true);
    expect(boxContains(alps, 45.6, 7.2)).toBe(true);
    expect(boxContains(alps, 46.4, 8.2)).toBe(true);
  });

  it('separates boxes that miss in either axis', () => {
    expect(boxesIntersect(alps, { south: 46.5, west: 7.2, north: 47, east: 8.2 })).toBe(false);
    expect(boxesIntersect(alps, { south: 45.6, west: 8.3, north: 46.4, east: 9 })).toBe(false);
    // The Southern Alps of New Zealand: nothing in common with the Valais.
    expect(boxesIntersect(alps, { south: -44, west: 169, north: -43, east: 171 })).toBe(false);
  });
});

describe('classifyOvertureRow', () => {
  const options = { sourceId: SOURCE_ID };

  it('turns the Matterhorn row into a peak record with an OSM-sourced height', () => {
    const outcome = classifyOvertureRow(MATTERHORN_ROW, options);
    expect(outcome.kind).toBe('peak');
    if (outcome.kind !== 'peak') throw new Error('unreachable');
    expect(outcome.record.name).toBe('Matterhorn');
    expect(outcome.record.elevationM).toBe(4478);
    // The height is the OSM `ele` tag carried through Overture unchanged
    // (verified against the same row's source_tags), so 'osm' is the honest
    // label — and it must never be 'srtm', which would mean a DEM sample.
    expect(outcome.record.elevationSourceKind).toBe('osm');
    expect(outcome.record.id).toBe(`${OVERTURE_ID_PREFIX}${MATTERHORN_ROW.id}`);
    expect(outcome.record.positionSourceId).toBe(SOURCE_ID);
    expect(outcome.record.elevationSourceId).toBe(SOURCE_ID);
    expect(outcome.record.usedBy).toEqual([]);
  });

  it('drops a summit with no height rather than letting the DEM fill it in', () => {
    const outcome = classifyOvertureRow({ ...MATTERHORN_ROW, elevation: null }, options);
    expect(outcome).toEqual({ kind: 'rejected', reason: 'no-elevation' });
  });

  it('drops the landform classes that are not summits', () => {
    for (const [featureClass, reason] of [
      ['saddle', 'not-a-summit-class'],
      ['ridge', 'not-a-summit-class'],
      ['valley', 'not-a-summit-class'],
      ['cliff', 'not-a-summit-class'],
      ['glacier', 'not-a-summit-class'],
    ] as const) {
      expect(classifyOvertureRow({ ...MATTERHORN_ROW, class: featureClass }, options)).toEqual({
        kind: 'rejected',
        reason,
      });
    }
    // A tree is `subtype: 'tree'` and is rejected one step earlier.
    expect(
      classifyOvertureRow({ ...MATTERHORN_ROW, subtype: 'tree', class: 'tree' }, options),
    ).toEqual({ kind: 'rejected', reason: 'not-a-landform' });
  });

  it('keeps a volcano', () => {
    const outcome = classifyOvertureRow(
      { ...MATTERHORN_ROW, class: 'volcano', names: { primary: 'Mount Rainier' } },
      options,
    );
    expect(outcome.kind).toBe('peak');
  });

  it('drops an unnamed summit, because a flag with no name says nothing', () => {
    expect(classifyOvertureRow({ ...MATTERHORN_ROW, names: null }, options)).toEqual({
      kind: 'rejected',
      reason: 'unnamed',
    });
  });

  it('applies the requested area, so a row group overhang does not leak in', () => {
    const area = { south: 46.5, west: 7.2, north: 47, east: 8.2 };
    expect(classifyOvertureRow(MATTERHORN_ROW, { ...options, area })).toEqual({
      kind: 'rejected',
      reason: 'outside-area',
    });
  });
});

describe('importOvertureRows', () => {
  it('counts every reason a row was dropped', () => {
    const rows = [
      MATTERHORN_ROW,
      { ...MATTERHORN_ROW, id: 'a', class: 'saddle' },
      { ...MATTERHORN_ROW, id: 'b', names: null },
      { ...MATTERHORN_ROW, id: 'c', elevation: null },
      { ...MATTERHORN_ROW, id: 'd', subtype: 'glacier', class: 'glacier' },
      { ...MATTERHORN_ROW, id: 'e', bbox: { xmin: 7, xmax: 7.5, ymin: 45, ymax: 45.5 } },
      'not a row',
    ];
    const result = importOvertureRows(rows, { sourceId: SOURCE_ID });
    expect(result.peaks).toHaveLength(1);
    expect(result.rejected).toEqual({
      'unreadable-row': 1,
      'not-a-landform': 1,
      'not-a-summit-class': 1,
      unnamed: 1,
      'no-elevation': 1,
      'not-a-point': 1,
      'outside-area': 0,
    });
  });

  it('keeps one record per id, so a summit is never labelled twice', () => {
    const result = importOvertureRows([MATTERHORN_ROW, { ...MATTERHORN_ROW }], {
      sourceId: SOURCE_ID,
    });
    expect(result.peaks).toHaveLength(1);
    expect(result.duplicates).toBe(1);
  });
});
