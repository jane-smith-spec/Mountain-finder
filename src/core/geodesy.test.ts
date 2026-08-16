import { describe, expect, it } from 'vitest';

import {
  EARTH_RADIUS_M,
  angularDifferenceDeg,
  destinationPoint,
  haversineDistanceM,
  initialBearingDeg,
  normaliseBearingDeg,
  normaliseLongitudeDeg,
  toDegrees,
  toRadians,
} from './geodesy';
import type { LatLng } from './types';

/**
 * Closed-form arc lengths on a sphere of radius EARTH_RADIUS_M. These are the
 * expectations for every "clean" geodesy case below, derived here from
 * s = R·θ rather than from anything the implementation computes.
 *
 *   1° of arc      R · π/180  = 111 195.080 m
 *   quarter circle R · π/2    = 10 007 557.221 m
 *   half circle    R · π      = 20 015 114.442 m
 */
const ONE_DEGREE_ARC_M = EARTH_RADIUS_M * (Math.PI / 180);
const QUARTER_CIRCLE_M = EARTH_RADIUS_M * (Math.PI / 2);
const HALF_CIRCLE_M = EARTH_RADIUS_M * Math.PI;

describe('angle conversion', () => {
  it('round-trips degrees through radians', () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI, 12);
    expect(toDegrees(Math.PI / 2)).toBeCloseTo(90, 12);
    expect(toDegrees(toRadians(37.25))).toBeCloseTo(37.25, 12);
  });
});

describe('normaliseBearingDeg', () => {
  // Expectations are the definition of "fold onto [0, 360)"; no computation.
  it.each([
    [0, 0],
    [-0, 0],
    [359.9, 359.9],
    [360, 0],
    [720, 0],
    [-1, 359],
    [-10, 350],
    [-370, 350],
    [365, 5],
    [1080.5, 0.5],
  ])('normalises %p to %p', (input, expected) => {
    expect(normaliseBearingDeg(input)).toBe(expected);
  });

  it('never returns negative zero', () => {
    expect(Object.is(normaliseBearingDeg(-0), 0)).toBe(true);
    expect(Object.is(normaliseBearingDeg(-360), 0)).toBe(true);
  });
});

describe('normaliseLongitudeDeg', () => {
  // Convention: (-180, +180], so the antimeridian is reported as +180.
  it.each([
    [0, 0],
    [179.9, 179.9],
    [180, 180],
    [180.5, -179.5],
    [181, -179],
    [-179.5, -179.5],
    [-180.5, 179.5],
    [360, 0],
    [540, 180],
  ])('normalises %p to %p', (input, expected) => {
    expect(normaliseLongitudeDeg(input)).toBeCloseTo(expected, 10);
  });
});

describe('angularDifferenceDeg', () => {
  // Signed short way round; the half-turn is reported as +180 by convention.
  it.each([
    [0, 0, 0],
    [0, 90, 90],
    [90, 0, -90],
    [350, 10, 20],
    [10, 350, -20],
    [0, 180, 180],
    [0, -180, 180],
    [359, 1, 2],
    [1, 359, -2],
    [-10, 10, 20],
  ])('difference from %p to %p is %p', (from, to, expected) => {
    expect(angularDifferenceDeg(from, to)).toBeCloseTo(expected, 10);
  });

  it('is antisymmetric except at the half-turn', () => {
    for (const [from, to] of [
      [12, 47],
      [300, 5],
      [-88, 91],
    ] as const) {
      expect(angularDifferenceDeg(from, to)).toBeCloseTo(-angularDifferenceDeg(to, from), 10);
    }
  });
});

describe('haversineDistanceM — closed-form arcs', () => {
  it('measures one degree along a meridian', () => {
    expect(haversineDistanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(
      ONE_DEGREE_ARC_M,
      6,
    );
  });

  it('measures one degree along the equator', () => {
    expect(haversineDistanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(
      ONE_DEGREE_ARC_M,
      6,
    );
  });

  it('measures equator to pole as a quarter circumference', () => {
    expect(haversineDistanceM({ lat: 0, lon: 0 }, { lat: 90, lon: 0 })).toBeCloseTo(
      QUARTER_CIRCLE_M,
      6,
    );
  });

  it('measures antipodes as half a circumference', () => {
    expect(haversineDistanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(
      HALF_CIRCLE_M,
      3,
    );
    expect(haversineDistanceM({ lat: -90, lon: 0 }, { lat: 90, lon: 0 })).toBeCloseTo(
      HALF_CIRCLE_M,
      3,
    );
  });

  it('is zero for coincident points and symmetric otherwise', () => {
    expect(haversineDistanceM({ lat: 46.5, lon: 8.1 }, { lat: 46.5, lon: 8.1 })).toBe(0);
    const a: LatLng = { lat: 46.5372, lon: 7.9628 };
    const b: LatLng = { lat: 45.9766, lon: 7.6585 };
    expect(haversineDistanceM(a, b)).toBeCloseTo(haversineDistanceM(b, a), 9);
  });

  it('crosses the antimeridian by the short route', () => {
    // 179.5°E to 179.5°W is one degree of longitude on the equator, not 359°.
    expect(haversineDistanceM({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 })).toBeCloseTo(
      ONE_DEGREE_ARC_M,
      6,
    );
  });

  it('shrinks longitude arcs by cos(latitude)', () => {
    // A degree of longitude at latitude φ subtends R·(π/180)·cos φ.
    for (const lat of [30, 60, 80]) {
      const expected = ONE_DEGREE_ARC_M * Math.cos(toRadians(lat));
      expect(haversineDistanceM({ lat, lon: 0 }, { lat, lon: 1 })).toBeCloseTo(expected, -1);
    }
  });
});

describe('haversineDistanceM / initialBearingDeg — published reference', () => {
  /**
   * Worked example published by Chris Veness, "Calculate distance, bearing and
   * more between Latitude/Longitude points" (Movable Type Scripts):
   * Land's End 50°03′59″N 005°42′53″W → John o' Groats 58°38′38″N 003°04′12″W,
   * quoted as distance 968.9 km and initial bearing 009°07′11″ (= 9.11972°).
   * https://www.movable-type.co.uk/scripts/latlong.html
   */
  const landsEnd: LatLng = { lat: 50 + 3 / 60 + 59 / 3600, lon: -(5 + 42 / 60 + 53 / 3600) };
  const johnOGroats: LatLng = { lat: 58 + 38 / 60 + 38 / 3600, lon: -(3 + 4 / 60 + 12 / 3600) };
  const publishedDistanceM = 968_900;
  const publishedBearingDeg = 9 + 7 / 60 + 11 / 3600;

  it('matches the published distance to better than 0.1 %', () => {
    const distanceM = haversineDistanceM(landsEnd, johnOGroats);
    const relativeError = Math.abs(distanceM - publishedDistanceM) / publishedDistanceM;
    expect(relativeError).toBeLessThan(0.001);
  });

  it('matches the published initial bearing to better than 0.01°', () => {
    expect(initialBearingDeg(landsEnd, johnOGroats)).toBeCloseTo(publishedBearingDeg, 2);
  });
});

describe('initialBearingDeg — cardinal directions', () => {
  // Taken on the equator, where the parallel *is* a great circle, so east and
  // west are exactly 90° and 270°. (Away from the equator they are not — see
  // the convergence test below; that is a property of great circles, not a bug.)
  const origin: LatLng = { lat: 0, lon: 20 };
  const cases: readonly { label: string; target: LatLng; expectedDeg: number }[] = [
    { label: 'due north', target: { lat: 1, lon: 20 }, expectedDeg: 0 },
    { label: 'due east', target: { lat: 0, lon: 21 }, expectedDeg: 90 },
    { label: 'due south', target: { lat: -1, lon: 20 }, expectedDeg: 180 },
    { label: 'due west', target: { lat: 0, lon: 19 }, expectedDeg: 270 },
  ];

  for (const { label, target, expectedDeg } of cases) {
    it(`reports ${label}`, () => {
      expect(initialBearingDeg(origin, target)).toBeCloseTo(expectedDeg, 9);
    });
  }

  it('shows meridian convergence away from the equator', () => {
    // Between two points on the same parallel the great circle bows poleward,
    // so it leaves *north* of due east by half the meridian convergence:
    //     θ ≈ 90° − (Δλ/2)·sin φ        (exact to O(Δλ³))
    // Getting 90° here instead would mean rhumb lines had been implemented by
    // mistake, which would misplace distant peaks by tenths of a degree.
    for (const [lat, deltaLon] of [
      [10, 1],
      [45, 1],
      [60, 0.5],
    ] as const) {
      const expected = 90 - (deltaLon / 2) * Math.sin(toRadians(lat));
      expect(initialBearingDeg({ lat, lon: 20 }, { lat, lon: 20 + deltaLon })).toBeCloseTo(
        expected,
        4,
      );
    }
  });

  it('reports 45° for the north-east diagonal at the equator', () => {
    // At the equator the two axes are locally isotropic, so equal steps in
    // latitude and longitude give exactly 45° in the limit; 0.001° is small
    // enough for the spherical correction to stay below a millidegree.
    expect(initialBearingDeg({ lat: 0, lon: 0 }, { lat: 0.001, lon: 0.001 })).toBeCloseTo(45, 3);
  });

  it('points east across the antimeridian, not west', () => {
    expect(initialBearingDeg({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 })).toBeCloseTo(90, 9);
    expect(initialBearingDeg({ lat: 0, lon: -179.5 }, { lat: 0, lon: 179.5 })).toBeCloseTo(270, 9);
  });
});

describe('destinationPoint — closed-form targets', () => {
  it('walks one degree east along the equator', () => {
    const result = destinationPoint({ lat: 0, lon: 0 }, 90, ONE_DEGREE_ARC_M);
    expect(result.lat).toBeCloseTo(0, 9);
    expect(result.lon).toBeCloseTo(1, 9);
  });

  it('walks one degree north along a meridian', () => {
    const result = destinationPoint({ lat: 40, lon: -70 }, 0, ONE_DEGREE_ARC_M);
    expect(result.lat).toBeCloseTo(41, 9);
    expect(result.lon).toBeCloseTo(-70, 9);
  });

  it('reaches the north pole from the equator', () => {
    const result = destinationPoint({ lat: 0, lon: 33 }, 0, QUARTER_CIRCLE_M);
    expect(result.lat).toBeCloseTo(90, 8);
  });

  it('wraps the antimeridian into (-180, 180]', () => {
    // 179.5°E + 1° east = 180.5°E, which must be reported as 179.5°W.
    const result = destinationPoint({ lat: 0, lon: 179.5 }, 90, ONE_DEGREE_ARC_M);
    expect(result.lat).toBeCloseTo(0, 9);
    expect(result.lon).toBeCloseTo(-179.5, 8);
  });

  it('crosses the north pole and flips longitude by 180°', () => {
    // Leaving 89°N due north and travelling 2° of arc overshoots the pole by
    // 1°, coming down the far side: 91°N is 89°N on the opposite meridian.
    const result = destinationPoint({ lat: 89, lon: 0 }, 0, 2 * ONE_DEGREE_ARC_M);
    expect(result.lat).toBeCloseTo(89, 8);
    expect(Math.abs(result.lon)).toBeCloseTo(180, 8);
  });
});

describe('destination → haversine round trip', () => {
  const origins: readonly LatLng[] = [
    { lat: 0, lon: 0 },
    { lat: 46.5372, lon: 7.9628 },
    { lat: -33.8688, lon: 151.2093 },
    { lat: 78.2232, lon: 15.6469 },
    { lat: 0.5, lon: 179.9 },
  ];
  const bearings = [0, 37.5, 90, 144.25, 180, 271.75, 359.5];
  const distances = [100, 5_000, 42_345, 250_000];

  it('recovers the distance it was given', () => {
    for (const origin of origins) {
      for (const bearingDeg of bearings) {
        for (const distanceM of distances) {
          const target = destinationPoint(origin, bearingDeg, distanceM);
          const measured = haversineDistanceM(origin, target);
          expect(Math.abs(measured - distanceM)).toBeLessThan(1e-6 * distanceM + 1e-6);
        }
      }
    }
  });

  it('recovers the bearing it was given', () => {
    // The great circle leaving on bearing θ has initial bearing θ by
    // definition, so this must hold exactly (to floating-point noise) for
    // every non-degenerate case. Polar origins are excluded: at a pole every
    // direction is south and the bearing is undefined.
    for (const origin of origins) {
      for (const bearingDeg of bearings) {
        const target = destinationPoint(origin, bearingDeg, 42_345);
        const recovered = initialBearingDeg(origin, target);
        expect(Math.abs(angularDifferenceDeg(bearingDeg, recovered))).toBeLessThan(1e-6);
      }
    }
  });

  it('returns to the origin when walked out and back along the reverse bearing', () => {
    const origin: LatLng = { lat: 46.5372, lon: 7.9628 };
    const out = destinationPoint(origin, 123.4, 80_000);
    const backBearing = normaliseBearingDeg(initialBearingDeg(out, origin));
    const home = destinationPoint(out, backBearing, 80_000);
    expect(haversineDistanceM(origin, home)).toBeLessThan(0.01);
  });
});
