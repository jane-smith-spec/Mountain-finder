/**
 * The near field — terrain a DEM cannot resolve — as a reported fact.
 *
 * Expectations are computed by hand from the geometry. The scenario mirrors the
 * one measured at Railroad Ridge and written up in docs/NEAR-FIELD.md, using
 * round numbers so every angle here can be checked with a calculator.
 */

import { describe, expect, it } from 'vitest';

import { buildHorizonProfile, nearFieldHorizons } from './horizon';
import type { BearingRay } from './horizon';
import type { HorizonProfile } from './types';

/**
 * A ray with one sample at a chosen range and height.
 *
 * Curvature and refraction are left on — this is the real `buildHorizonProfile`
 * — and the drop is INCLUDED in the arithmetic below rather than waved away. It
 * is worth being exact about: at 90 m the drop is 0.55 mm, which sounds
 * negligible and moves the angle by 0.00035°, which is more than a 4-decimal
 * tolerance allows. A first draft of this file called it negligible and failed.
 * Small is not the same as below the tolerance you happened to pick.
 */
function ray(bearingDeg: number, distanceM: number, elevationM: number): BearingRay {
  return { bearingDeg, samples: [{ distanceM, elevationM }] };
}

describe('nearFieldHorizons', () => {
  /**
   * The Railroad Ridge shape, in round numbers: an eye at 3170 m, a phantom
   * wall 90 m away whose cell reads 3173 m, and a real summit 11 km out.
   *
   * With R_eff = 6371008.8 / (1 − 0.13) = 7 322 999 m, the drop is d²/2R:
   *
   *   wall    d = 90 m       drop 0.000553 m   atan(2.999447 / 90)  = 1.90880°
   *   summit  d = 11 000 m   drop 8.262 m      atan(421.74 / 11000) = 2.19556°
   *
   * The summit clears the wall by about a third of a degree — the same shape
   * as the real case, where it cleared by 0.065°.
   */
  const EYE_M = 3170;
  const profile: HorizonProfile = buildHorizonProfile(EYE_M, [
    ray(0, 90, 3173),
    ray(1, 90, 3173),
    ray(2, 90, 3173),
    ray(3, 11000, 3600),
    ray(4, 4000, 3200),
  ]);

  it('names every bearing whose horizon rests inside the radius', () => {
    const report = nearFieldHorizons(profile, 200);
    expect(report.bearings.map((entry) => entry.bearingDeg)).toEqual([0, 1, 2]);
    // Three of the five bearings in the profile.
    expect(report.fraction01).toBeCloseTo(0.6, 10);
    expect(report.radiusM).toBe(200);
  });

  it('reports how high the phantom wall reaches, which is the number that decides verdicts', () => {
    const report = nearFieldHorizons(profile, 200);
    // atan((3 − 0.000553) / 90) = 1.908801°. Without the drop it would be
    // 1.909152°, and the difference is what broke this test's first draft.
    expect(report.maxAltitudeDeg).toBeCloseTo(1.908801, 5);
  });

  it('leaves the real horizon alone — an 11 km summit is not a near-field artefact', () => {
    const report = nearFieldHorizons(profile, 200);
    expect(report.bearings.some((entry) => entry.bearingDeg === 3)).toBe(false);
    expect(report.bearings.some((entry) => entry.bearingDeg === 4)).toBe(false);
  });

  it('finds nothing when the radius is smaller than the nearest horizon', () => {
    const report = nearFieldHorizons(profile, 50);
    expect(report.bearings).toEqual([]);
    expect(report.fraction01).toBe(0);
    // Not −Infinity from an empty maximum: a caller formatting this into a
    // sentence must never be handed a sentinel.
    expect(report.maxAltitudeDeg).toBe(0);
  });

  it('treats a zero or negative radius as "report nothing", not as "everything"', () => {
    // The default is 0 — see SweepConfig.minRangeM — so this is the path every
    // existing caller takes, and it must be inert.
    for (const radius of [0, -1, Number.NaN]) {
      const report = nearFieldHorizons(profile, radius);
      expect(report.bearings).toEqual([]);
      expect(report.fraction01).toBe(0);
      expect(report.maxAltitudeDeg).toBe(0);
    }
    expect(nearFieldHorizons(profile, -1).radiusM).toBe(0);
  });

  it('survives an empty profile', () => {
    const report = nearFieldHorizons([], 200);
    expect(report.bearings).toEqual([]);
    expect(report.fraction01).toBe(0);
  });

  it('carries the distance and height, so a report can say WHY it is unresolvable', () => {
    const [first] = nearFieldHorizons(profile, 200).bearings;
    expect(first?.distanceKm).toBeCloseTo(0.09, 10);
    expect(first?.elevationM).toBe(3173);
    // 3 m above an eye at 3170 m: the artefact is a three-metre disagreement
    // between two DEM cells, and it hides an 11 km mountain range.
    expect((first?.elevationM ?? 0) - EYE_M).toBe(3);
  });

  it('is the shape that nearly hid a visible summit', () => {
    // The finding, as an executable statement. The wall and the summit are
    // within a third of a degree of each other, and NOTHING about the numbers
    // themselves says which one is real terrain and which is the sampling grid.
    const report = nearFieldHorizons(profile, 200);
    const summit = profile.find((point) => point.bearingDeg === 3);
    expect(summit).toBeDefined();
    const clearance = (summit?.altitudeDeg ?? 0) - report.maxAltitudeDeg;
    expect(clearance).toBeGreaterThan(0);
    expect(clearance).toBeLessThan(0.5);
  });
});
