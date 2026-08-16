import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_M, destinationPoint, toDegrees } from './geodesy';
import {
  REFRACTION_COEFFICIENT,
  altitudeAngleDeg,
  curvatureRefractionDropM,
  effectiveEarthRadiusM,
  flatTerrainHorizonDipDeg,
  flatTerrainHorizonDistanceM,
  sightPeak,
  sweepRay,
} from './sightline';
import type { RaySample } from './sightline';
import type { Observer, Peak } from './types';

/**
 * Constants restated here so every expectation below is derived from the
 * physics, not from the module under test.
 *
 *   R      = 6 371 008.8 m           IUGG mean radius
 *   k      = 0.13                     standard refraction coefficient
 *   R_eff  = R / (1 − k) = 7 322 998.6207 m
 *
 * Sight-line angle to a target Δh above the eye at ground distance d:
 *
 *   α = atan2( Δh − d²/(2·R_eff) , d )
 */
const R_EFF_M = EARTH_RADIUS_M / (1 - REFRACTION_COEFFICIENT);

/** The closed form, written out independently of the implementation. */
function closedFormAltitudeDeg(riseM: number, distanceM: number): number {
  return toDegrees(Math.atan2(riseM - (distanceM * distanceM) / (2 * R_EFF_M), distanceM));
}

describe('effectiveEarthRadiusM', () => {
  it('inflates the radius to R/(1−k) ≈ 7323 km at k = 0.13', () => {
    expect(effectiveEarthRadiusM()).toBeCloseTo(7_322_998.6207, 3);
    expect(effectiveEarthRadiusM()).toBeCloseTo(EARTH_RADIUS_M / 0.87, 6);
  });

  it('collapses to the true radius in vacuum (k = 0)', () => {
    expect(effectiveEarthRadiusM({ refractionCoefficient: 0 })).toBe(EARTH_RADIUS_M);
  });

  it('rejects k ≥ 1, where the correction would invert or blow up', () => {
    expect(() => effectiveEarthRadiusM({ refractionCoefficient: 1 })).toThrow(RangeError);
    expect(() => effectiveEarthRadiusM({ refractionCoefficient: 1.5 })).toThrow(RangeError);
  });
});

describe('curvatureRefractionDropM', () => {
  it('reproduces the "eight inches per mile squared" rule for pure geometry', () => {
    // Long-standing surveying rule of thumb: with no refraction, the Earth
    // drops ~8 inches over the first statute mile (d²/2R with d = 1609.344 m,
    // R = 6371.0 km, gives 0.20326 m = 8.0025 inches).
    const oneMileM = 1609.344;
    const dropM = curvatureRefractionDropM(oneMileM, { refractionCoefficient: 0 });
    expect(dropM / 0.0254).toBeCloseTo(8.0, 2);
  });

  it('is quadratic in distance', () => {
    // d²/(2R) doubles its argument → quadruples its value, exactly.
    const near = curvatureRefractionDropM(10_000);
    const far = curvatureRefractionDropM(20_000);
    expect(far / near).toBeCloseTo(4, 12);
  });

  it('matches independently computed drops at working distances', () => {
    // d²/(2 · 7 322 998.6207): 5 km → 1.70695 m, 20 km → 27.31122 m,
    // 30 km → 61.45024 m, 50 km → 170.69510 m.
    expect(curvatureRefractionDropM(5_000)).toBeCloseTo(1.70695, 4);
    expect(curvatureRefractionDropM(20_000)).toBeCloseTo(27.31122, 4);
    expect(curvatureRefractionDropM(30_000)).toBeCloseTo(61.45024, 4);
    expect(curvatureRefractionDropM(50_000)).toBeCloseTo(170.6951, 4);
  });

  it('refraction relieves exactly 13 % of the geometric drop', () => {
    const geometric = curvatureRefractionDropM(30_000, { refractionCoefficient: 0 });
    const refracted = curvatureRefractionDropM(30_000);
    expect(refracted / geometric).toBeCloseTo(0.87, 12);
  });
});

describe('altitudeAngleDeg', () => {
  it('is zero for a target level with the eye at zero distance', () => {
    expect(altitudeAngleDeg(1000, 1000, 0)).toBe(0);
  });

  it('is +90° straight up and −90° straight down', () => {
    expect(altitudeAngleDeg(0, 100, 0)).toBeCloseTo(90, 12);
    expect(altitudeAngleDeg(100, 0, 0)).toBeCloseTo(-90, 12);
  });

  it('falls just short of 45° for a 1000 m rise at 1000 m, by the curvature drop', () => {
    // Δh = 1000 m, d = 1000 m, drop = 1000²/(2·7 322 998.62) = 0.06828 m,
    // α = atan2(999.93172, 1000) = 44.998044°.
    expect(altitudeAngleDeg(0, 1000, 1000)).toBeCloseTo(44.998044, 6);
  });

  it('matches the closed form for a ridge and a distant peak', () => {
    // 1000 m summit at 5 km, eye 1.6 m: atan2(1000 − 1.6 − 1.70695, 5000) = 11.273490°
    // 1500 m summit at 20 km, eye 1.6 m: atan2(1500 − 1.6 − 27.31122, 20000) = 4.206783°
    expect(altitudeAngleDeg(1.6, 1000, 5_000)).toBeCloseTo(11.27349, 5);
    expect(altitudeAngleDeg(1.6, 1500, 20_000)).toBeCloseTo(4.206783, 5);
  });

  it('sinks a fixed summit toward the horizon as it is moved further away', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const distanceM of [5_000, 10_000, 20_000, 40_000, 80_000]) {
      const angle = altitudeAngleDeg(1.6, 2000, distanceM);
      expect(angle).toBeLessThan(previous);
      expect(angle).toBeCloseTo(closedFormAltitudeDeg(2000 - 1.6, distanceM), 12);
      previous = angle;
    }
  });

  it('hides a summit that a flat Earth would show', () => {
    // A 200 m summit 100 km away: the curvature+refraction drop there is
    // 100000²/(2·7 322 998.62) = 682.78 m, far more than 200 m, so it must
    // read as *below* horizontal even though it is 200 m above the observer.
    expect(altitudeAngleDeg(0, 200, 100_000)).toBeLessThan(0);
    // With no atmosphere at all it sinks further still.
    expect(altitudeAngleDeg(0, 200, 100_000, { refractionCoefficient: 0 })).toBeLessThan(
      altitudeAngleDeg(0, 200, 100_000),
    );
  });
});

describe('flat-terrain horizon — closed form from calculus', () => {
  /**
   * Over a plane at the observer's own ground level the sight-line angle to
   * distance d is  α(d) = atan( (−h − d²/(2R_eff)) / d ).
   * Maximising the tangent:  d/dd [ −h/d − d/(2R_eff) ] = h/d² − 1/(2R_eff) = 0
   *   ⟹  d★ = √(2·R_eff·h)                (horizon distance)
   *   ⟹  tan α★ = −h/d★ − d★/(2R_eff) = −√(2h/R_eff)   (the two terms are equal)
   * For h = 1.6 m and R_eff = 7 322 998.62 m this gives
   *   d★ = 4840.8259 m and α★ = −0.0378750°.
   */
  const eyeHeightM = 1.6;

  it('places the horizon at √(2·R_eff·h)', () => {
    expect(flatTerrainHorizonDistanceM(eyeHeightM)).toBeCloseTo(4840.8259, 4);
    expect(flatTerrainHorizonDistanceM(eyeHeightM)).toBeCloseTo(
      Math.sqrt(2 * R_EFF_M * eyeHeightM),
      9,
    );
  });

  it('dips it by atan(√(2h/R_eff))', () => {
    expect(flatTerrainHorizonDipDeg(eyeHeightM)).toBeCloseTo(-0.037875, 6);
  });

  it('satisfies the tangent-point identity drop(d★) = h', () => {
    // At the tangent point the curvature drop exactly equals the eye height.
    expect(curvatureRefractionDropM(flatTerrainHorizonDistanceM(eyeHeightM))).toBeCloseTo(
      eyeHeightM,
      9,
    );
  });

  it('is recovered by a numerical sweep of a flat plain', () => {
    // 2000 samples of dead-flat sea level at 10 m spacing out to 20 km.
    const samples: RaySample[] = [];
    for (let distanceM = 10; distanceM <= 20_000; distanceM += 10) {
      samples.push({ distanceM, elevationM: 0 });
    }
    const { horizon } = sweepRay(eyeHeightM, samples);
    expect(horizon).toBeDefined();
    if (horizon === undefined) return;

    expect(horizon.altitudeDeg).toBeCloseTo(-0.037875, 6);
    // The true tangent point falls between two samples, so the winner must be
    // within one 10 m step of d★ = 4840.83 m.
    expect(Math.abs(horizon.distanceM - 4840.8259)).toBeLessThanOrEqual(10);
  });

  it('rejects a negative eye height', () => {
    expect(() => flatTerrainHorizonDipDeg(-1)).toThrow(RangeError);
    expect(() => flatTerrainHorizonDistanceM(-1)).toThrow(RangeError);
  });
});

describe('sweepRay — analytic cone', () => {
  /**
   * A right circular cone standing on a sea-level plain, apex 3000 m high,
   * base radius 10 km, apex centred 30 km along the ray. Terrain height at
   * ground distance s is  e(s) = max(0, 3000·(1 − |s − 30000| / 10000)),
   * i.e. flanks of slope 0.3 rising from 20 km and falling back by 40 km.
   *
   * WHY THE APEX MUST WIN. Along the near flank the height above the eye is
   * A + m·s with m = 0.3 and A = 3000 − 0.3·30000 − 1.6 = −6001.6 m, so
   *
   *     tan α(s) = A/s + m − s/(2·R_eff),
   *     d/ds tan α = −A/s² − 1/(2·R_eff) = 6001.6/s² − 6.8278×10⁻⁸,
   *
   * which is positive for all s < 296 km — hugely beyond the flank — so the
   * angle rises monotonically along the whole near flank and peaks exactly at
   * the apex. Past the apex the terrain falls at 0.3 while the curvature drop
   * keeps growing, so nothing beyond can recover.
   *
   * Closed-form horizon angle:
   *     α = atan2(3000 − 1.6 − 30000²/(2·7 322 998.6207), 30000)
   *       = atan2(2938.5498, 30000) = 5.5913437°
   */
  const APEX_HEIGHT_M = 3000;
  const APEX_DISTANCE_M = 30_000;
  const BASE_RADIUS_M = 10_000;
  const EYE_M = 1.6;
  const EXPECTED_HORIZON_DEG = 5.5913437;

  function coneElevationM(distanceM: number): number {
    return Math.max(
      0,
      APEX_HEIGHT_M * (1 - Math.abs(distanceM - APEX_DISTANCE_M) / BASE_RADIUS_M),
    );
  }

  const samples: RaySample[] = [];
  for (let distanceM = 250; distanceM <= 45_000; distanceM += 250) {
    samples.push({ distanceM, elevationM: coneElevationM(distanceM) });
  }

  it('finds the apex as the skyline, within 0.01° of the closed form', () => {
    const { horizon } = sweepRay(EYE_M, samples);
    expect(horizon).toBeDefined();
    if (horizon === undefined) return;

    expect(horizon.distanceM).toBe(APEX_DISTANCE_M);
    expect(horizon.elevationM).toBe(APEX_HEIGHT_M);
    expect(Math.abs(horizon.altitudeDeg - EXPECTED_HORIZON_DEG)).toBeLessThan(0.01);
    // Same expectation re-derived symbolically rather than as a decimal.
    expect(horizon.altitudeDeg).toBeCloseTo(
      closedFormAltitudeDeg(APEX_HEIGHT_M - EYE_M, APEX_DISTANCE_M),
      12,
    );
  });

  it('puts the whole near flank on the skyline and nothing past the apex', () => {
    const { skyline } = sweepRay(EYE_M, samples);
    const flankHits = skyline.filter((hit) => hit.distanceM >= BASE_RADIUS_M * 2);

    // Every 250 m step from the flank's foot (20 km) to the apex (30 km)
    // out-angles its predecessor, so all 40 of them are skyline.
    expect(flankHits).toHaveLength(40);
    expect(flankHits[0]?.distanceM).toBe(20_250);
    expect(flankHits[flankHits.length - 1]?.distanceM).toBe(APEX_DISTANCE_M);

    // Nothing beyond the apex ever shows.
    expect(skyline.some((hit) => hit.distanceM > APEX_DISTANCE_M)).toBe(false);

    // Angles along the skyline are strictly increasing, by construction.
    for (let i = 1; i < skyline.length; i += 1) {
      const previous = skyline[i - 1];
      const current = skyline[i];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (previous === undefined || current === undefined) return;
      expect(current.altitudeDeg).toBeGreaterThan(previous.altitudeDeg);
    }
  });

  it('agrees with the closed form at an intermediate flank sample too', () => {
    // 25 km along the ray the cone is 1500 m high:
    // atan2(1500 − 1.6 − 42.67378, 25000) = 3.3325157°
    const { skyline } = sweepRay(EYE_M, samples);
    const midFlank = skyline.find((hit) => hit.distanceM === 25_000);
    expect(midFlank?.elevationM).toBe(1500);
    expect(midFlank?.altitudeDeg).toBeCloseTo(3.3325157, 5);
  });
});

describe('sweepRay — two-ridge occlusion', () => {
  /**
   * A near ridge and a taller far ridge on a sea-level plain, eye at 1.6 m:
   *
   *   ridge A: 1000 m at  5 km → atan2(1000 − 1.6 −  1.70695,  5000) = 11.273490°
   *   ridge B: 1500 m at 20 km → atan2(1500 − 1.6 − 27.31122, 20000) =  4.206783°
   *
   * B is 500 m taller and still hidden: 4.21° < 11.27°. This is the whole
   * point of angle-based occlusion — a height comparison would get it wrong.
   * (Equivalently, ridge A's sight line has already climbed to 4016 m above
   * sea level by the time it reaches 20 km — well over B's 1500 m summit.)
   */
  const samples: RaySample[] = [];
  for (let distanceM = 1_000; distanceM <= 30_000; distanceM += 1_000) {
    const elevationM = distanceM === 5_000 ? 1000 : distanceM === 20_000 ? 1500 : 0;
    samples.push({ distanceM, elevationM });
  }

  it('crowns the near ridge and hides the taller far one', () => {
    const { skyline, horizon } = sweepRay(1.6, samples);

    expect(horizon?.distanceM).toBe(5_000);
    expect(horizon?.altitudeDeg).toBeCloseTo(11.27349, 5);

    const farRidge = skyline.find((hit) => hit.distanceM === 20_000);
    expect(farRidge).toBeUndefined();
  });

  it('shows the far ridge once the near one is removed', () => {
    // Control: with ridge A flattened, ridge B becomes the skyline. This proves
    // the exclusion above was occlusion and not a sampling accident.
    const withoutNearRidge = samples.map((sample) =>
      sample.distanceM === 5_000 ? { distanceM: 5_000, elevationM: 0 } : sample,
    );
    const { horizon } = sweepRay(1.6, withoutNearRidge);
    expect(horizon?.distanceM).toBe(20_000);
    expect(horizon?.altitudeDeg).toBeCloseTo(4.206783, 5);
  });
});

describe('sweepRay — bookkeeping', () => {
  it('returns an empty result for an empty ray', () => {
    const { skyline, horizon } = sweepRay(0, []);
    expect(skyline).toEqual([]);
    expect(horizon).toBeUndefined();
  });

  it('always ends the skyline on the horizon', () => {
    const { skyline, horizon } = sweepRay(1.6, [
      { distanceM: 1_000, elevationM: 50 },
      { distanceM: 2_000, elevationM: 300 },
      { distanceM: 3_000, elevationM: 100 },
    ]);
    expect(skyline).toHaveLength(2);
    expect(horizon).toEqual(skyline[skyline.length - 1]);
    expect(horizon?.distanceM).toBe(2_000);
  });

  it('rejects samples that are not ordered near → far', () => {
    expect(() =>
      sweepRay(0, [
        { distanceM: 2_000, elevationM: 0 },
        { distanceM: 1_000, elevationM: 0 },
      ]),
    ).toThrow(RangeError);
  });

  it('breaks ties in favour of the nearer sample', () => {
    // Equal angles are not "exceeding everything closer", so the far twin is
    // dropped — a distant ridge that merely grazes a near one stays hidden.
    const { skyline } = sweepRay(0, [
      { distanceM: 1_000, elevationM: 1_000 },
      { distanceM: 1_000, elevationM: 1_000 },
    ]);
    expect(skyline).toHaveLength(1);
  });
});

describe('sightPeak', () => {
  const observer: Observer = {
    lat: 46.0,
    lon: 8.0,
    groundElevationM: 400,
    eyeHeightM: 1.6,
  };

  it('recovers the bearing and distance a peak was placed at', () => {
    // Construct the peak by walking 20 km on bearing 63.5° from the observer,
    // so the expected bearing and distance are inputs, not outputs.
    const placement = destinationPoint(observer, 63.5, 20_000);
    const peak: Peak = {
      ...placement,
      id: 'node/1',
      name: 'Placed Peak',
      elevationM: 2500,
      elevationSource: 'osm',
    };

    const sighting = sightPeak(observer, peak);
    expect(sighting.bearingDeg).toBeCloseTo(63.5, 6);
    expect(sighting.distanceKm).toBeCloseTo(20, 6);
    // Eye at 400 + 1.6 = 401.6 m; Δh = 2500 − 401.6 = 2098.4 m at 20 km:
    // atan2(2098.4 − 27.31122, 20000) = 5.9121594°
    expect(sighting.altitudeDeg).toBeCloseTo(
      closedFormAltitudeDeg(2500 - 401.6, 20_000),
      9,
    );
    expect(sighting.altitudeDeg).toBeCloseTo(5.9121594, 5);
  });

  it('carries the peak identity through untouched', () => {
    const peak: Peak = {
      lat: 46.1,
      lon: 8.1,
      id: 'node/42',
      name: 'Monte Test',
      elevationM: 1800,
      elevationSource: 'srtm',
    };
    const sighting = sightPeak(observer, peak);
    expect(sighting.id).toBe('node/42');
    expect(sighting.name).toBe('Monte Test');
    expect(sighting.elevationM).toBe(1800);
    expect(sighting.elevationSource).toBe('srtm');
  });
});
