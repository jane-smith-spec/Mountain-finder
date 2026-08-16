import { describe, expect, it } from 'vitest';

import {
  buildHorizonProfile,
  interpolateHorizonAltitudeDeg,
  interpolateNearerTerrainAltitudeDeg,
  maxAltitudeNearerThanDeg,
  normaliseHorizonProfile,
  skylineStepsOf,
} from './horizon';
import type { BearingRay } from './horizon';
import type { HorizonPoint, HorizonProfile, SkylineStep } from './types';

/** Terse constructor — distance/elevation are irrelevant to interpolation. */
function point(bearingDeg: number, altitudeDeg: number): HorizonPoint {
  return { bearingDeg, altitudeDeg, distanceKm: 1, elevationM: 0 };
}

/** A profile point carrying an explicit staircase, for the nearer-terrain queries. */
function steppedPoint(
  bearingDeg: number,
  steps: readonly (readonly [distanceKm: number, maxAltitudeDeg: number])[],
): HorizonPoint {
  const skylineSteps: SkylineStep[] = steps.map(([distanceKm, maxAltitudeDeg]) => ({
    distanceKm,
    maxAltitudeDeg,
    elevationM: 0,
  }));
  const last = skylineSteps[skylineSteps.length - 1];
  if (last === undefined) throw new RangeError('a staircase needs at least one step');
  return {
    bearingDeg,
    altitudeDeg: last.maxAltitudeDeg,
    distanceKm: last.distanceKm,
    elevationM: last.elevationM,
    skylineSteps,
  };
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

/**
 * MERGING TWO POINTS ON ONE BEARING KEEPS THE UNION OF THEIR STAIRCASES.
 *
 * Keeping the higher `altitudeDeg` answers "what does the horizon look like
 * here?" and is right for drawing. It is NOT enough for occlusion, which asks
 * "what stands in front of range d?" — and the discarded point's staircase can
 * hold the only occluder at that range. Dropping it turns a peak hidden behind
 * a near wall into a labelled peak, which is the failure mode this project
 * exists to prevent.
 *
 * A staircase is a running maximum over distance, so the union of two is the
 * merge by distance with the running maximum taken: at any range d the answer
 * must be the higher of the two rays' answers at d.
 *
 * Angles here are round numbers rather than terrain-derived ones on purpose —
 * the property under test is the merge algebra, not the geometry.
 */
describe('normaliseHorizonProfile — merged staircases', () => {
  it('keeps the discarded point’s occluder, which the skyline hides', () => {
    // Same bearing, two rays:
    //   near wall  — one step: 1 km reaching +4°
    //   far skyline — one step: 10 km reaching +6°
    // The skyline is +6° (the far one wins on angle), but a peak at 5 km is
    // occluded by the +4° wall at 1 km, which the far ray knows nothing about.
    const merged = normaliseHorizonProfile([
      steppedPoint(0, [[10, 6]]),
      steppedPoint(0, [[1, 4]]),
    ]);

    expect(merged).toHaveLength(1);
    const point = merged[0];
    expect(point).toBeDefined();
    if (point === undefined) return;

    // The skyline is still the higher of the two.
    expect(point.altitudeDeg).toBe(6);
    expect(point.distanceKm).toBe(10);

    // …and the staircase is the union, in distance order, running maximum.
    expect(skylineStepsOf(point).map((step) => [step.distanceKm, step.maxAltitudeDeg])).toEqual([
      [1, 4],
      [10, 6],
    ]);

    // The occlusion question a peak at 5 km asks: +4°, not "nothing nearer".
    expect(maxAltitudeNearerThanDeg(point, 5)).toBe(4);
    expect(interpolateNearerTerrainAltitudeDeg(merged, 0, 5)).toBe(4);
    // A peak at +1° behind that wall is hidden by 3°, not visible.
    expect(1 - (interpolateNearerTerrainAltitudeDeg(merged, 0, 5) ?? -90)).toBe(-3);
  });

  it('interleaves two multi-step staircases by distance', () => {
    //   A: 1 km +1°, 4 km +5°   (skyline +5°)
    //   B: 2 km +3°, 8 km +7°   (skyline +7°, so B is the point kept)
    // Union: every step sets a new running maximum, so all four survive.
    const merged = normaliseHorizonProfile([
      steppedPoint(0, [
        [1, 1],
        [4, 5],
      ]),
      steppedPoint(0, [
        [2, 3],
        [8, 7],
      ]),
    ]);

    const point = merged[0];
    expect(point).toBeDefined();
    if (point === undefined) return;
    expect(point.altitudeDeg).toBe(7);
    expect(skylineStepsOf(point).map((step) => [step.distanceKm, step.maxAltitudeDeg])).toEqual([
      [1, 1],
      [2, 3],
      [4, 5],
      [8, 7],
    ]);

    // Read back at four cutoffs, each answer independently obvious.
    expect(maxAltitudeNearerThanDeg(point, 1.5)).toBe(1);
    expect(maxAltitudeNearerThanDeg(point, 3)).toBe(3);
    expect(maxAltitudeNearerThanDeg(point, 5)).toBe(5);
    expect(maxAltitudeNearerThanDeg(point, 100)).toBe(7);
  });

  it('drops steps the union has already out-climbed, staying a staircase', () => {
    //   A: 1 km +9°            (skyline +9°, the point kept)
    //   B: 2 km +3°, 8 km +7°  — both below +9°, so neither is ever the
    //                            running maximum at their range.
    const merged = normaliseHorizonProfile([
      steppedPoint(0, [[1, 9]]),
      steppedPoint(0, [
        [2, 3],
        [8, 7],
      ]),
    ]);

    const point = merged[0];
    expect(point).toBeDefined();
    if (point === undefined) return;
    expect(point.altitudeDeg).toBe(9);
    expect(skylineStepsOf(point).map((step) => [step.distanceKm, step.maxAltitudeDeg])).toEqual([
      [1, 9],
    ]);
    expect(maxAltitudeNearerThanDeg(point, 9)).toBe(9);
  });

  it('collapses steps at an identical distance to the higher one', () => {
    const merged = normaliseHorizonProfile([
      steppedPoint(0, [[3, 2]]),
      steppedPoint(0, [[3, 5]]),
    ]);

    const point = merged[0];
    expect(point).toBeDefined();
    if (point === undefined) return;
    expect(skylineStepsOf(point).map((step) => [step.distanceKm, step.maxAltitudeDeg])).toEqual([
      [3, 5],
    ]);
  });

  it('gives a staircase-free point its one honest step in the union', () => {
    // `point()` carries no `skylineSteps`; its implicit staircase is the single
    // fact it does carry — at distanceKm 1 the terrain reached altitudeDeg.
    const merged = normaliseHorizonProfile([point(0, 2), steppedPoint(0, [[10, 6]])]);

    const merged0 = merged[0];
    expect(merged0).toBeDefined();
    if (merged0 === undefined) return;
    expect(merged0.altitudeDeg).toBe(6);
    expect(skylineStepsOf(merged0).map((step) => [step.distanceKm, step.maxAltitudeDeg])).toEqual([
      [1, 2],
      [10, 6],
    ]);
    expect(maxAltitudeNearerThanDeg(merged0, 5)).toBe(2);
  });

  it('leaves a lone point’s staircase exactly as it was', () => {
    const [only] = normaliseHorizonProfile([steppedPoint(12, [[1, 1], [2, 2]])]);
    expect(only?.skylineSteps?.map((step) => step.maxAltitudeDeg)).toEqual([1, 2]);
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

  it('records the whole running-maximum staircase, not just the winner', () => {
    /**
     * A single ray due north over a sea-level plain, eye 1.6 m, four samples.
     * Each angle is atan((h − 1.6 − d²/(2·R_eff)) / d) with
     * R_eff = 6 371 008.8 / 0.87 = 7 322 998.6207 m:
     *
     *   d = 2 km,  h =  100 m: c = 0.27311 → atan( 98.12689/2000)  = 2.808876°
     *   d = 5 km,  h =  120 m: c = 1.70695 → atan(116.69305/5000)  = 1.336961°
     *   d = 10 km, h =  400 m: c = 6.82780 → atan(391.57220/10000) = 2.242398°
     *   d = 20 km, h = 1500 m: c = 27.31122 → atan(1471.08878/20000) = 4.206783°
     *
     * The 5 km and 10 km samples are TALLER in metres than the 2 km one and
     * still lose on angle, so the staircase must have exactly two steps —
     * 2 km and 20 km — and the middle two samples must be absent from it.
     */
    const profile = buildHorizonProfile(1.6, [
      {
        bearingDeg: 0,
        samples: [
          { distanceM: 2_000, elevationM: 100 },
          { distanceM: 5_000, elevationM: 120 },
          { distanceM: 10_000, elevationM: 400 },
          { distanceM: 20_000, elevationM: 1500 },
        ],
      },
    ]);

    const north = profile[0];
    expect(north).toBeDefined();
    const steps = north?.skylineSteps;
    expect(steps).toHaveLength(2);
    expect(steps?.[0]?.distanceKm).toBe(2);
    expect(steps?.[0]?.elevationM).toBe(100);
    expect(steps?.[0]?.maxAltitudeDeg).toBeCloseTo(2.808876, 5);
    expect(steps?.[1]?.distanceKm).toBe(20);
    expect(steps?.[1]?.elevationM).toBe(1500);
    expect(steps?.[1]?.maxAltitudeDeg).toBeCloseTo(4.206783, 5);

    // The last step must repeat the winning sample the three flat fields name.
    expect(steps?.[1]?.maxAltitudeDeg).toBe(north?.altitudeDeg);
    expect(steps?.[1]?.distanceKm).toBe(north?.distanceKm);
    expect(steps?.[1]?.elevationM).toBe(north?.elevationM);

    // Monotonic in both coordinates, which is what makes it a staircase.
    expect(steps?.[1]?.maxAltitudeDeg ?? 0).toBeGreaterThan(steps?.[0]?.maxAltitudeDeg ?? 0);
    expect(steps?.[1]?.distanceKm ?? 0).toBeGreaterThan(steps?.[0]?.distanceKm ?? 0);
  });

  it('is not walled off by the ground under the observer’s own feet', () => {
    /**
     * The review's scenario, at profile level. EXIF put the camera at 500 m;
     * the DEM says the ground under it is 510 m — a 10 m disagreement, which
     * is unremarkable for GPS altitude — and the ray walk hands the sample at
     * the observer's own position (range 0) to the sweep as `samples[0]`.
     *
     * Every angle below is atan((h − 500 − d²/(2·R_eff)) / d),
     * R_eff = 6 371 008.8 / 0.87 = 7 322 998.6207 m:
     *
     *   ridge  d = 5 km,  h = 900 m:  c =  1.70695 → atan( 398.29305/5000)
     *                                                = 4.554485°
     *   peak   d = 20 km, h = 2400 m: c = 27.31122 → atan(1872.68878/20000)
     *                                                = 5.349262°
     *
     * so the peak clears the only thing in front of it by 0.794777°. With the
     * range-0 sample admitted, the profile's innermost step is atan2(+10, 0)
     * = +90° and the peak is reported hidden by 84.65°.
     */
    const profile = buildHorizonProfile(500, [
      {
        bearingDeg: 0,
        samples: [
          { distanceM: 0, elevationM: 510 },
          { distanceM: 5_000, elevationM: 900 },
        ],
      },
    ]);

    const north = profile[0];
    expect(north?.altitudeDeg).toBeCloseTo(4.554485, 5);
    expect(north?.distanceKm).toBe(5);
    expect(north?.skylineSteps?.map((step) => step.distanceKm)).toEqual([5]);

    // The occlusion question a 2400 m peak at 20 km asks of this bearing.
    const occluderDeg = interpolateNearerTerrainAltitudeDeg(profile, 0, 20);
    expect(occluderDeg).toBeCloseTo(4.554485, 5);
    expect(5.349262 - (occluderDeg ?? 0)).toBeCloseTo(0.794777, 5);
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

describe('skylineStepsOf — the one-step fallback', () => {
  it('returns the recorded staircase when there is one', () => {
    const withSteps = steppedPoint(0, [
      [1, -2],
      [4, 3],
    ]);
    expect(skylineStepsOf(withSteps)).toEqual([
      { distanceKm: 1, maxAltitudeDeg: -2, elevationM: 0 },
      { distanceKm: 4, maxAltitudeDeg: 3, elevationM: 0 },
    ]);
  });

  it('reads a staircase-free point as exactly the one fact it carries', () => {
    // A hand-built point knows only "at 5 km the terrain reached 6°". Anything
    // more would be invented; anything less would throw away a real occluder.
    const bare: HorizonPoint = {
      bearingDeg: 0,
      altitudeDeg: 6,
      distanceKm: 5,
      elevationM: 900,
    };
    expect(skylineStepsOf(bare)).toEqual([
      { distanceKm: 5, maxAltitudeDeg: 6, elevationM: 900 },
    ]);
  });
});

describe('maxAltitudeNearerThanDeg — the cutoff is strict', () => {
  /**
   * Staircase along one bearing, in round numbers so every comparison below is
   * exact rather than epsilon-fudged:
   *
   *   1 km → +1°,  5 km → +3°,  10 km → +7°
   */
  const staircase = steppedPoint(0, [
    [1, 1],
    [5, 3],
    [10, 7],
  ]);

  it('reports the running maximum over everything strictly nearer', () => {
    expect(maxAltitudeNearerThanDeg(staircase, 20)).toBe(7);
    expect(maxAltitudeNearerThanDeg(staircase, 10.000001)).toBe(7);
    expect(maxAltitudeNearerThanDeg(staircase, 7)).toBe(3);
    expect(maxAltitudeNearerThanDeg(staircase, 2)).toBe(1);
  });

  it('excludes terrain sitting at exactly the cutoff distance', () => {
    // A summit IS the sample at its own range; counting it would have every
    // peak occlude itself.
    expect(maxAltitudeNearerThanDeg(staircase, 10)).toBe(3);
    expect(maxAltitudeNearerThanDeg(staircase, 5)).toBe(1);
  });

  it('reports undefined when nothing is nearer than the cutoff', () => {
    expect(maxAltitudeNearerThanDeg(staircase, 1)).toBeUndefined();
    expect(maxAltitudeNearerThanDeg(staircase, 0.5)).toBeUndefined();
  });

  it('does not assume the steps arrived sorted', () => {
    // Same three steps, shuffled. A scan that stopped at the first far step
    // would report +1 instead of +3 here.
    const shuffled: HorizonPoint = {
      bearingDeg: 0,
      altitudeDeg: 7,
      distanceKm: 10,
      elevationM: 0,
      skylineSteps: [
        { distanceKm: 10, maxAltitudeDeg: 7, elevationM: 0 },
        { distanceKm: 1, maxAltitudeDeg: 1, elevationM: 0 },
        { distanceKm: 5, maxAltitudeDeg: 3, elevationM: 0 },
      ],
    };
    expect(maxAltitudeNearerThanDeg(shuffled, 7)).toBe(3);
  });
});

describe('interpolateNearerTerrainAltitudeDeg', () => {
  /**
   * Two bearings with different terrain in front:
   *
   *   0°:   1 km → +2°,  8 km → +10°
   *   180°: 1 km → +6°,  8 km → +12°
   *
   * A cutoff of 5 km selects the first step on each bearing (+2 and +6); a
   * cutoff of 20 km selects the second (+10 and +12).
   */
  const profile: HorizonProfile = normaliseHorizonProfile([
    steppedPoint(0, [
      [1, 2],
      [8, 10],
    ]),
    steppedPoint(180, [
      [1, 6],
      [8, 12],
    ]),
  ]);

  it('is exact at a sampled bearing', () => {
    expect(interpolateNearerTerrainAltitudeDeg(profile, 0, 5)).toBe(2);
    expect(interpolateNearerTerrainAltitudeDeg(profile, 180, 5)).toBe(6);
    expect(interpolateNearerTerrainAltitudeDeg(profile, 0, 20)).toBe(10);
    expect(interpolateNearerTerrainAltitudeDeg(profile, 180, 20)).toBe(12);
  });

  it('interpolates linearly in bearing, at the cutoff it was asked about', () => {
    // 90° is halfway 0°→180°: (2 + 6)/2 = 4 at a 5 km cutoff,
    //                         (10 + 12)/2 = 11 at a 20 km cutoff.
    expect(interpolateNearerTerrainAltitudeDeg(profile, 90, 5)).toBeCloseTo(4, 12);
    expect(interpolateNearerTerrainAltitudeDeg(profile, 90, 20)).toBeCloseTo(11, 12);
    // 45° is a quarter of the way: 2 + 0.25(6 − 2) = 3.
    expect(interpolateNearerTerrainAltitudeDeg(profile, 45, 5)).toBeCloseTo(3, 12);
  });

  it('wraps across the 359°→0° seam on the same bracketing pair as the skyline', () => {
    // 270° is halfway back from 180°(+6) to 0°(+2): (6 + 2)/2 = 4.
    expect(interpolateNearerTerrainAltitudeDeg(profile, 270, 5)).toBeCloseTo(4, 12);
    // 315° is three quarters of the way: 6 + 0.75(2 − 6) = 3.
    expect(interpolateNearerTerrainAltitudeDeg(profile, 315, 5)).toBeCloseTo(3, 12);
    // 359.5° is 179.5/180 of the way: 6 + (179.5/180)(2 − 6).
    expect(interpolateNearerTerrainAltitudeDeg(profile, 359.5, 5)).toBeCloseTo(
      6 - (179.5 / 180) * 4,
      12,
    );
    expect(interpolateNearerTerrainAltitudeDeg(profile, 360, 5)).toBe(2);
  });

  it('agrees with the skyline query once the cutoff is beyond all the terrain', () => {
    // With nothing excluded, "highest thing nearer than the cutoff" and
    // "highest thing at all" are the same maximum, so the two interpolations
    // must return bit-identical numbers at every bearing.
    for (const bearingDeg of [0, 17.5, 45, 90, 180, 233.75, 315, 359.9]) {
      expect(interpolateNearerTerrainAltitudeDeg(profile, bearingDeg, 1000)).toBe(
        interpolateHorizonAltitudeDeg(profile, bearingDeg),
      );
    }
  });

  it('reports undefined when neither bracketing bearing has anything nearer', () => {
    expect(interpolateNearerTerrainAltitudeDeg(profile, 90, 1)).toBeUndefined();
    expect(interpolateNearerTerrainAltitudeDeg(profile, 0, 0.5)).toBeUndefined();
  });

  it('keeps the one real occluder when only one bracketing bearing has terrain', () => {
    // 0° has a step at 1 km, 180° has nothing nearer than 8 km. At a 5 km
    // cutoff the honest answer at any bearing between them is +2°: halving it
    // against a fictitious open-air value would let a ridge be walked through.
    const lopsided: HorizonProfile = normaliseHorizonProfile([
      steppedPoint(0, [
        [1, 2],
        [8, 10],
      ]),
      steppedPoint(180, [[8, 12]]),
    ]);
    expect(interpolateNearerTerrainAltitudeDeg(lopsided, 90, 5)).toBe(2);
    expect(interpolateNearerTerrainAltitudeDeg(lopsided, 180, 5)).toBe(2);
    expect(interpolateNearerTerrainAltitudeDeg(lopsided, 0, 5)).toBe(2);
  });

  it('returns the sole sample everywhere for a one-point profile', () => {
    const single = normaliseHorizonProfile([steppedPoint(123, [[2, 4.5]])]);
    for (const bearingDeg of [0, 123, 200, 359.9]) {
      expect(interpolateNearerTerrainAltitudeDeg(single, bearingDeg, 10)).toBe(4.5);
      expect(interpolateNearerTerrainAltitudeDeg(single, bearingDeg, 2)).toBeUndefined();
    }
  });

  it('refuses to guess on an empty profile rather than clearing every peak', () => {
    expect(() => interpolateNearerTerrainAltitudeDeg([], 0, 10)).toThrow(RangeError);
  });
});
