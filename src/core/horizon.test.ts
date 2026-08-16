import { describe, expect, it } from 'vitest';

import {
  buildHorizonProfile,
  interpolateHorizonAltitudeDeg,
  normaliseHorizonProfile,
} from './horizon';
import type { BearingRay } from './horizon';
import type { HorizonPoint, HorizonProfile } from './types';

/** Terse constructor — distance/elevation are irrelevant to interpolation. */
function point(bearingDeg: number, altitudeDeg: number): HorizonPoint {
  return { bearingDeg, altitudeDeg, distanceKm: 1, elevationM: 0 };
}

/**
 * Reference profile used throughout. Four samples a quarter-turn apart, with
 * deliberately uneven altitudes so a linear interpolation cannot be mistaken
 * for a constant:
 *
 *   bearing:   0°    90°   180°   270°  (→ back to 0°)
 *   altitude: +10°  +20°    0°    −5°
 *
 * Every expectation below is straight-line interpolation on that table, worked
 * out by hand in the comment next to it.
 */
const QUARTERS: HorizonProfile = normaliseHorizonProfile([
  point(0, 10),
  point(90, 20),
  point(180, 0),
  point(270, -5),
]);

describe('normaliseHorizonProfile', () => {
  it('sorts by bearing regardless of input order', () => {
    const profile = normaliseHorizonProfile([point(270, 1), point(0, 2), point(180, 3)]);
    expect(profile.map((p) => p.bearingDeg)).toEqual([0, 180, 270]);
  });

  it('folds bearings onto [0, 360)', () => {
    const profile = normaliseHorizonProfile([point(-90, 1), point(450, 2)]);
    expect(profile.map((p) => p.bearingDeg)).toEqual([90, 270]);
  });

  it('merges duplicate bearings by keeping the higher skyline', () => {
    // 0° and 360° are the same direction; the skyline there is the higher of
    // the two, because the higher terrain is what actually blocks the view.
    const profile = normaliseHorizonProfile([point(0, 3), point(360, 7), point(0, 5)]);
    expect(profile).toHaveLength(1);
    expect(profile[0]?.altitudeDeg).toBe(7);
  });

  it('returns an empty profile unchanged', () => {
    expect(normaliseHorizonProfile([])).toEqual([]);
  });
});

describe('interpolateHorizonAltitudeDeg — exact at samples', () => {
  it('returns each sample altitude unchanged at its own bearing', () => {
    expect(interpolateHorizonAltitudeDeg(QUARTERS, 0)).toBe(10);
    expect(interpolateHorizonAltitudeDeg(QUARTERS, 90)).toBe(20);
    expect(interpolateHorizonAltitudeDeg(QUARTERS, 180)).toBe(0);
    expect(interpolateHorizonAltitudeDeg(QUARTERS, 270)).toBe(-5);
  });

  it('treats 360° as 0°', () => {
    expect(interpolateHorizonAltitudeDeg(QUARTERS, 360)).toBe(10);
    expect(interpolateHorizonAltitudeDeg(QUARTERS, 720)).toBe(10);
  });

  it('accepts negative bearings', () => {
    // −90° ≡ 270°, an exact sample.
    expect(interpolateHorizonAltitudeDeg(QUARTERS, -90)).toBe(-5);
    // −45° ≡ 315°, halfway from −5° to +10° → +2.5°.
    expect(interpolateHorizonAltitudeDeg(QUARTERS, -45)).toBeCloseTo(2.5, 12);
  });
});

describe('interpolateHorizonAltitudeDeg — linear between samples', () => {
  it('halves the gap at midpoints', () => {
    // 45° is midway 0°→90°:   (10 + 20)/2  = 15
    // 135° is midway 90°→180°:(20 +  0)/2  = 10
    // 225° is midway 180°→270°:(0 + −5)/2  = −2.5
    expect(interpolateHorizonAltitudeDeg(QUARTERS, 45)).toBeCloseTo(15, 12);
    expect(interpolateHorizonAltitudeDeg(QUARTERS, 135)).toBeCloseTo(10, 12);
    expect(interpolateHorizonAltitudeDeg(QUARTERS, 225)).toBeCloseTo(-2.5, 12);
  });

  it('interpolates at arbitrary fractions', () => {
    // 30° is one third of 0°→90°: 10 + (1/3)(20 − 10) = 13.3333…
    expect(interpolateHorizonAltitudeDeg(QUARTERS, 30)).toBeCloseTo(10 + 10 / 3, 12);
    // 150° is two thirds of 90°→180°: 20 + (2/3)(0 − 20) = 6.6666…
    expect(interpolateHorizonAltitudeDeg(QUARTERS, 150)).toBeCloseTo(20 - 40 / 3, 12);
  });

  it('handles unevenly spaced samples', () => {
    // Samples at 10°(+1), 100°(+10), 200°(+4).
    const profile = normaliseHorizonProfile([point(10, 1), point(100, 10), point(200, 4)]);
    // 55° is halfway 10°→100°: (1 + 10)/2 = 5.5
    expect(interpolateHorizonAltitudeDeg(profile, 55)).toBeCloseTo(5.5, 12);
    // 150° is halfway 100°→200°: (10 + 4)/2 = 7
    expect(interpolateHorizonAltitudeDeg(profile, 150)).toBeCloseTo(7, 12);
    // 350° sits on the wrap segment 200°→370°, 150/170 of the way:
    // 4 + (150/170)(1 − 4) = 4 − 450/170 = 1.352941…
    expect(interpolateHorizonAltitudeDeg(profile, 350)).toBeCloseTo(4 - 450 / 170, 12);
    // 5° is on the same segment, one turn on: 365° − 200° = 165 of the 170.
    expect(interpolateHorizonAltitudeDeg(profile, 5)).toBeCloseTo(4 - (165 / 170) * 3, 12);
  });
});

describe('interpolateHorizonAltitudeDeg — the 359°→0° seam', () => {
  it('interpolates across the seam using the wrapped gap', () => {
    // The last sample is 270°(−5), the first is 0°(+10), and the gap between
    // them going clockwise is 90°. 359.5° is 89.5/90 of the way across:
    //   −5 + (89.5/90)(10 − (−5)) = −5 + 14.916666… = 9.916666…
    expect(interpolateHorizonAltitudeDeg(QUARTERS, 359.5)).toBeCloseTo(-5 + (89.5 / 90) * 15, 12);
    // 315° is exactly halfway: (−5 + 10)/2 = 2.5
    expect(interpolateHorizonAltitudeDeg(QUARTERS, 315)).toBeCloseTo(2.5, 12);
  });

  it('is continuous through north', () => {
    const justBefore = interpolateHorizonAltitudeDeg(QUARTERS, 359.999);
    const atNorth = interpolateHorizonAltitudeDeg(QUARTERS, 0);
    const justAfter = interpolateHorizonAltitudeDeg(QUARTERS, 0.001);
    expect(Math.abs(justBefore - atNorth)).toBeLessThan(1e-3);
    expect(Math.abs(justAfter - atNorth)).toBeLessThan(1e-3);
    // And the slopes on either side are the ones the table implies:
    // approaching north the profile climbs at 15°/90° = 1/6 per degree,
    // leaving north it climbs at 10°/90° = 1/9 per degree.
    expect((atNorth - justBefore) / 0.001).toBeCloseTo(15 / 90, 6);
    expect((justAfter - atNorth) / 0.001).toBeCloseTo(10 / 90, 6);
  });

  it('sweeps the whole circle without a discontinuity', () => {
    // Every 0.25° step must change the altitude by less than the largest
    // per-step change the table allows (20°/90° per degree × 0.25° = 0.0556°).
    const maxStep = (20 / 90) * 0.25 + 1e-9;
    let previous = interpolateHorizonAltitudeDeg(QUARTERS, 0);
    for (let bearing = 0.25; bearing <= 360; bearing += 0.25) {
      const current = interpolateHorizonAltitudeDeg(QUARTERS, bearing);
      expect(Math.abs(current - previous)).toBeLessThanOrEqual(maxStep);
      previous = current;
    }
  });
});

describe('interpolateHorizonAltitudeDeg — degenerate profiles', () => {
  it('throws on an empty profile rather than inventing a flat horizon', () => {
    expect(() => interpolateHorizonAltitudeDeg([], 0)).toThrow(RangeError);
  });

  it('returns the single sample everywhere for a one-point profile', () => {
    const profile = normaliseHorizonProfile([point(123, 4.5)]);
    for (const bearing of [0, 123, 200, 359.9]) {
      expect(interpolateHorizonAltitudeDeg(profile, bearing)).toBe(4.5);
    }
  });
});

describe('buildHorizonProfile', () => {
  /**
   * Two rays over a sea-level plain with an eye at 1.6 m:
   *
   *   bearing   0°: a 1000 m ridge at 5 km and a 1500 m one at 20 km.
   *                 The near ridge wins: atan2(1000 − 1.6 − 1.70695, 5000)
   *                 = 11.273490°, at 5 km, 1000 m.
   *   bearing 180°: only the 1500 m ridge at 20 km:
   *                 atan2(1500 − 1.6 − 27.31122, 20000) = 4.206783°.
   */
  const EYE_M = 1.6;
  const rays: readonly BearingRay[] = [
    {
      bearingDeg: 180,
      samples: [{ distanceM: 20_000, elevationM: 1500 }],
    },
    {
      bearingDeg: 0,
      samples: [
        { distanceM: 5_000, elevationM: 1000 },
        { distanceM: 20_000, elevationM: 1500 },
      ],
    },
  ];

  it('emits one point per ray, sorted by bearing, carrying the winning terrain', () => {
    const profile = buildHorizonProfile(EYE_M, rays);
    expect(profile).toHaveLength(2);

    const north = profile[0];
    const south = profile[1];
    expect(north?.bearingDeg).toBe(0);
    expect(north?.altitudeDeg).toBeCloseTo(11.27349, 5);
    expect(north?.distanceKm).toBe(5);
    expect(north?.elevationM).toBe(1000);

    expect(south?.bearingDeg).toBe(180);
    expect(south?.altitudeDeg).toBeCloseTo(4.206783, 5);
    expect(south?.distanceKm).toBe(20);
    expect(south?.elevationM).toBe(1500);
  });

  it('interpolates between the two rays at the quarter bearings', () => {
    const profile = buildHorizonProfile(EYE_M, rays);
    const expectedMidpoint = (11.273490471 + 4.206783253) / 2;
    expect(interpolateHorizonAltitudeDeg(profile, 90)).toBeCloseTo(expectedMidpoint, 6);
    expect(interpolateHorizonAltitudeDeg(profile, 270)).toBeCloseTo(expectedMidpoint, 6);
  });

  it('skips rays with no samples instead of inventing a horizon', () => {
    const profile = buildHorizonProfile(EYE_M, [
      { bearingDeg: 0, samples: [{ distanceM: 5_000, elevationM: 1000 }] },
      { bearingDeg: 90, samples: [] },
    ]);
    expect(profile).toHaveLength(1);
    expect(profile[0]?.bearingDeg).toBe(0);
  });

  it('produces an empty profile from no rays at all', () => {
    expect(buildHorizonProfile(EYE_M, [])).toEqual([]);
  });

  it('honours the refraction option end to end', () => {
    // Turning refraction off increases the curvature drop by 1/0.87, which
    // must lower every skyline angle.
    const withRefraction = buildHorizonProfile(EYE_M, rays);
    const withoutRefraction = buildHorizonProfile(EYE_M, rays, { refractionCoefficient: 0 });
    for (let i = 0; i < withRefraction.length; i += 1) {
      const a = withRefraction[i];
      const b = withoutRefraction[i];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a === undefined || b === undefined) return;
      expect(b.altitudeDeg).toBeLessThan(a.altitudeDeg);
    }
  });
});
