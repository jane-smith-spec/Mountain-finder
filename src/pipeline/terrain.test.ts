/**
 * Sweep geometry and the terrain walk.
 *
 * EXPECTATIONS ARE DERIVED, NOT RECORDED. Ray counts and step distances come
 * from the sweep definition; the one geodetic number below (111 194.93 m per
 * degree of longitude at the equator) is R·π/180 with the IUGG mean radius,
 * written out in the comment where it is used.
 */

import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_M } from '../core/geodesy';
import {
  DEFAULT_SWEEP,
  buildTerrainRays,
  rayPoints,
  resolveSweep,
  sweepBearingsDeg,
  sweepRangesM,
} from './terrain';
import { FunctionElevationSource } from './testing/elevation-sources';

/** Metres per degree along the equator: R·π/180 = 111 194.9266 m. */
const METRES_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;

describe('resolveSweep', () => {
  it('fills the documented defaults', () => {
    expect(resolveSweep()).toEqual(DEFAULT_SWEEP);
    expect(resolveSweep({ maxRangeKm: 5 }).bearingStepDeg).toBe(DEFAULT_SWEEP.bearingStepDeg);
    expect(resolveSweep({ maxRangeKm: 5 }).maxRangeKm).toBe(5);
  });

  it('refuses a sweep that cannot be walked', () => {
    expect(() => resolveSweep({ bearingStepDeg: 0 })).toThrow(RangeError);
    expect(() => resolveSweep({ rangeStepM: -30 })).toThrow(RangeError);
    expect(() => resolveSweep({ spanDeg: 400 })).toThrow(RangeError);
    // 100 m of range with a 250 m step would produce rays with no samples at
    // all, and an empty profile silently declares every peak visible.
    expect(() => resolveSweep({ maxRangeKm: 0.1, rangeStepM: 250 })).toThrow(/shorter than one/);
  });
});

describe('sweepBearingsDeg', () => {
  it('walks a full circle without repeating the seam', () => {
    const bearings = sweepBearingsDeg(resolveSweep({ bearingStepDeg: 1 }));
    expect(bearings).toHaveLength(360);
    expect(bearings[0]).toBe(0);
    expect(bearings[359]).toBe(359);
    expect(bearings).not.toContain(360);
  });

  it('walks a sector when one is asked for', () => {
    const bearings = sweepBearingsDeg(
      resolveSweep({ startBearingDeg: 90, spanDeg: 30, bearingStepDeg: 10 }),
    );
    expect(bearings).toEqual([90, 100, 110]);
  });

  it('halves the step to double the ray count', () => {
    expect(sweepBearingsDeg(resolveSweep({ bearingStepDeg: 0.5 }))).toHaveLength(720);
  });
});

describe('sweepRangesM', () => {
  it('starts one step out, never at the observer', () => {
    const ranges = sweepRangesM(resolveSweep({ rangeStepM: 250, maxRangeKm: 1 }));
    expect(ranges).toEqual([250, 500, 750, 1000]);
    // Range 0 is the observer's own coordinate: it subtends no angle (the
    // altitude formula divides by the distance) and is not terrain they see.
    expect(ranges).not.toContain(0);
  });

  it('stops at the last whole step inside the range', () => {
    expect(sweepRangesM(resolveSweep({ rangeStepM: 300, maxRangeKm: 1 }))).toEqual([300, 600, 900]);
  });
});

describe('rayPoints', () => {
  it('places a due-east ray along the equator at the right longitudes', () => {
    // From (0, 0) due east, one degree of longitude is R·π/180 = 111 194.93 m.
    const points = rayPoints({ lat: 0, lon: 0 }, 90, [METRES_PER_DEG, 2 * METRES_PER_DEG]);
    expect(points[0]?.lat).toBeCloseTo(0, 12);
    expect(points[0]?.lon).toBeCloseTo(1, 9);
    expect(points[1]?.lon).toBeCloseTo(2, 9);
  });

  it('places a due-north ray along the meridian', () => {
    const points = rayPoints({ lat: 0, lon: 11 }, 0, [METRES_PER_DEG]);
    expect(points[0]?.lat).toBeCloseTo(1, 9);
    expect(points[0]?.lon).toBeCloseTo(11, 9);
  });
});

describe('buildTerrainRays', () => {
  const sweep = resolveSweep({ bearingStepDeg: 90, rangeStepM: 1000, maxRangeKm: 3 });

  it('samples every ray at every range', async () => {
    const source = new FunctionElevationSource(() => 500);
    const { rays, report } = await buildTerrainRays(source, { lat: 0, lon: 0 }, sweep);

    expect(rays.map((ray) => ray.bearingDeg)).toEqual([0, 90, 180, 270]);
    expect(rays[0]?.samples.map((sample) => sample.distanceM)).toEqual([1000, 2000, 3000]);
    expect(report).toEqual({
      raysRequested: 4,
      raysWithTerrain: 4,
      samplesRequested: 12,
      samplesWithElevation: 12,
      gaps: [],
    });
  });

  it('drops no-data points instead of calling them sea level', async () => {
    // No data beyond 1.5 km: the far samples must vanish from the ray, not
    // arrive as 0 m, which would plant a fake sea-level plain on the skyline.
    const source = new FunctionElevationSource(
      (point) => (Math.abs(point.lon) > 0.0135 || Math.abs(point.lat) > 0.0135 ? null : 500),
      'patchy',
    );
    const { rays, report } = await buildTerrainRays(source, { lat: 0, lon: 0 }, sweep);

    for (const ray of rays) {
      expect(ray.samples.map((sample) => sample.distanceM)).toEqual([1000]);
      expect(ray.samples.every((sample) => sample.elevationM === 500)).toBe(true);
    }
    expect(report.samplesRequested).toBe(12);
    expect(report.samplesWithElevation).toBe(4);
    expect(report.gaps).toEqual(['patchy']);
  });

  it('returns no rays at all when nothing has data', async () => {
    const source = new FunctionElevationSource(() => null, 'local-tiles(missing)');
    const { rays, report } = await buildTerrainRays(source, { lat: 0, lon: 0 }, sweep);
    expect(rays).toEqual([]);
    expect(report.raysWithTerrain).toBe(0);
    expect(report.gaps).toEqual(['local-tiles(missing)']);
  });

  it('stops on an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const source = new FunctionElevationSource(() => 500);
    await expect(
      buildTerrainRays(source, { lat: 0, lon: 0 }, sweep, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(source.pointsRequested).toBe(0);
  });
});
