/**
 * SCENE 3 — CONICAL PEAK  (PLAN.md P6.1 "cone", P1.2's named analytic test)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MISSION.md: "A cone-shaped mathematical mountain has an exactly computable
 * horizon angle. If the pipeline can't get the cone right, no real photo will
 * save it." This is that cone.
 *
 * A right circular cone standing on an otherwise featureless plain at sea
 * level:
 *
 *     apex          1 500 m above sea level
 *     apex distance    10 000 m from the observer, on bearing 045°
 *     base radius       3 000 m  ⇒  flank slope 1500/3000 = 0.5 (26.565°)
 *     observer      ground 0 m, eye 2.0 m  ⇒  H_o = 2.0 m
 *
 * Terrain:  E(r) = 1500 · max(0, 1 − r/3000),  r = distance from the cone axis.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * DERIVATION 1 — APEX ALTITUDE ANGLE, BY HAND
 * ───────────────────────────────────────────────────────────────────────────
 * THIS SCENE ASSUMES R = 6 371 008.8 m (IUGG mean radius) and k = 0.13, and
 * scene-geometry.ts derives the effective radius symbolically from them:
 *
 *     R_eff = R/(1 − k) = 6 371 008.8 / 0.87 = 7 322 998.6207 m.
 *
 *     c = d² / (2 R_eff)
 *       = 10 000² / (2 × 7 322 998.6207)
 *       = 100 000 000 / 14 645 997.2414
 *       = 6.82780 m
 *
 *     apparent rise = E − H_o − c
 *                   = 1 500 − 2 − 6.82780
 *                   = 1 491.17220 m
 *
 *     tan α = 1 491.17220 / 10 000 = 0.14911722
 *
 *     α = atan(0.14911722)
 *       = x − x³/3 + x⁵/5 − x⁷/7 + x⁹/9 − …          (x = 0.14911722)
 *       = 0.14911722 − 0.00110526 + 0.00001475 − 0.00000023 + 0.00000000
 *       = 0.14802648 rad
 *       = 0.14802648 × 57.29577951
 *       = 8.481293°
 *
 * The exact sphere model (atan2 form, no small-angle step anywhere) gives
 * 8.479576°. The two disagree by 0.0017°, six times inside PLAN.md's 0.01°
 * tolerance — so this fixture does not force src/core into either convention.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * DERIVATION 2 — WHY THE APEX, AND NOT SOME POINT ON THE FLANK
 * ───────────────────────────────────────────────────────────────────────────
 * Along the ray through the cone axis, α(s) ≈ (E(s) − H_o)/s − s/(2R_eff), so
 * α rises all the way to the apex as long as the flank is steeper than the
 * sightline to it:
 *
 *     flank slope 0.500   >   tan α = 0.149      ✓ by a factor of 3.4
 *
 * Beyond the apex the flank descends and α falls. The apex is therefore the
 * unique maximum on that ray, and — since the cone is the only relief in the
 * scene — the unique maximum of the whole 360° profile.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * DERIVATION 3 — THE SKYLINE AWAY FROM THE CONE
 * ───────────────────────────────────────────────────────────────────────────
 * The cone subtends a half-angle of asin(3000/10000) = 17.458° about bearing
 * 045°, i.e. it occupies roughly 027.5°–062.5°. Everywhere else the skyline is
 * the bare plain, which is Scene 1's problem with h = 2.0 m:
 *
 *     dip = −√(2h/R_eff) = −√(4 / 7 322 998.6207)
 *         = −√(5.462242e-7)
 *         = −7.390697e-4 rad
 *         = −0.042346°
 *
 *     horizon range = √(2 R_eff h) = √(29 291 994.5) = 5 412.21 m
 *
 * Bearing 180° is asserted against that number. It is a second, much smaller
 * curvature test in the same scene: a pipeline that fudges curvature to make
 * the 8.48° apex come out right will not also land 0.042° on the nose.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SAMPLING NOTE
 * ───────────────────────────────────────────────────────────────────────────
 * 250 m range steps divide 10 000 m exactly, so bearing 045° has a sample
 * sitting precisely on the apex — the expectation is not softened by grid
 * interpolation. The plain-horizon expectation at 180° is stationary in range
 * (Scene 1's second-order argument), so its 162 m worst-case grid offset costs
 * under 2e-5°.
 */

import type { ElevationSample, LatLng, Observer, Peak } from '../../src/core/types';
import {
  apparentAltitudeDeg,
  apparentAltitudeDegPlaneDrop,
  destinationPoint,
  greatCircleDistanceM,
  horizonArcDistanceM,
  horizonDipDeg,
  horizonDistanceSmallAngleM,
} from './scene-geometry';
import {
  eyeElevationM,
  generateRadialSamples,
  type ExpectedPeakVerdict,
  type ExpectedSkylinePoint,
  type SceneSampling,
  type SyntheticScene,
} from './scene';

/** Elevation of the plain the cone stands on. */
export const PLAIN_ELEVATION_M = 0;
/** Height of the cone's apex above sea level. */
export const APEX_ELEVATION_M = 1_500;
/** Ground distance from observer to the cone's axis. */
export const APEX_DISTANCE_M = 10_000;
/** Bearing from observer to the cone's axis. */
export const APEX_BEARING_DEG = 45;
/** Radius of the cone's base; flank slope = APEX_ELEVATION_M / this. */
export const BASE_RADIUS_M = 3_000;

/** Bearing used for the bare-plain expectation, well clear of the cone. */
export const PLAIN_BEARING_DEG = 180;

const OBSERVER: Observer = {
  lat: 47,
  lon: 11,
  groundElevationM: PLAIN_ELEVATION_M,
  eyeHeightM: 2,
};

const EYE_ELEVATION_M = eyeElevationM(OBSERVER); // 2.0 m

const SAMPLING: SceneSampling = {
  bearingStepDeg: 1,
  rangeStepM: 250,
  maxRangeM: 30_000,
};

const OBSERVER_POINT: LatLng = { lat: OBSERVER.lat, lon: OBSERVER.lon };

/** Coordinate of the cone's apex. */
export const APEX_POINT: LatLng = destinationPoint(
  OBSERVER_POINT,
  APEX_BEARING_DEG,
  APEX_DISTANCE_M,
);

/** Flank slope, rise over run. Must exceed tan(apex altitude) — see header. */
export const FLANK_SLOPE = APEX_ELEVATION_M / BASE_RADIUS_M;

function elevationAtM(point: LatLng): number {
  const radialM = greatCircleDistanceM(APEX_POINT, point);
  if (radialM >= BASE_RADIUS_M) return PLAIN_ELEVATION_M;
  return APEX_ELEVATION_M * (1 - radialM / BASE_RADIUS_M);
}

/** Closed-form apex altitude, exact sphere model. */
export const EXPECTED_APEX_ALTITUDE_DEG = apparentAltitudeDeg(
  EYE_ELEVATION_M,
  APEX_ELEVATION_M,
  APEX_DISTANCE_M,
);

/** Closed-form apex altitude via the independent curvature-drop model. */
export const EXPECTED_APEX_ALTITUDE_PLANE_DROP_DEG = apparentAltitudeDegPlaneDrop(
  EYE_ELEVATION_M,
  APEX_ELEVATION_M,
  APEX_DISTANCE_M,
);

/** Closed-form dip of the bare plain, for an eye 2.0 m above it. */
export const EXPECTED_PLAIN_DIP_DEG = horizonDipDeg(OBSERVER.eyeHeightM);

/** Ground distance to that plain horizon. */
export const EXPECTED_PLAIN_HORIZON_DISTANCE_M = horizonArcDistanceM(
  OBSERVER.eyeHeightM,
);

/** Half-angle the cone subtends about APEX_BEARING_DEG: asin(r_base/d). */
export const CONE_ANGULAR_HALF_WIDTH_DEG =
  (Math.asin(BASE_RADIUS_M / APEX_DISTANCE_M) * 180) / Math.PI;

const APEX_PEAK_ID = 'conical-peak/apex';

const peaks: readonly Peak[] = [
  {
    id: APEX_PEAK_ID,
    name: 'Cone Apex',
    lat: APEX_POINT.lat,
    lon: APEX_POINT.lon,
    elevationM: APEX_ELEVATION_M,
    elevationSource: 'srtm',
  },
];

const expectedSkyline: readonly ExpectedSkylinePoint[] = [
  {
    bearingDeg: APEX_BEARING_DEG,
    altitudeDeg: EXPECTED_APEX_ALTITUDE_DEG,
    altitudeDegPlaneDrop: EXPECTED_APEX_ALTITUDE_PLANE_DROP_DEG,
    distanceM: APEX_DISTANCE_M,
    elevationM: APEX_ELEVATION_M,
    note:
      'Cone apex. Flank slope 0.5 exceeds tan(alpha) = 0.149, so the apex is ' +
      'the unique maximum along this ray.',
  },
  {
    bearingDeg: PLAIN_BEARING_DEG,
    altitudeDeg: EXPECTED_PLAIN_DIP_DEG,
    altitudeDegPlaneDrop: apparentAltitudeDegPlaneDrop(
      EYE_ELEVATION_M,
      PLAIN_ELEVATION_M,
      horizonDistanceSmallAngleM(OBSERVER.eyeHeightM),
    ),
    distanceM: EXPECTED_PLAIN_HORIZON_DISTANCE_M,
    elevationM: PLAIN_ELEVATION_M,
    note:
      'Bare plain, 135 deg away from the cone: the small-eye-height horizon ' +
      'dip, a second and much finer curvature test in the same scene.',
  },
];

const expectedPeakVerdicts: readonly ExpectedPeakVerdict[] = [
  {
    peakId: APEX_PEAK_ID,
    visible: true,
    peakAltitudeDeg: EXPECTED_APEX_ALTITUDE_DEG,
    skylineAltitudeDeg: EXPECTED_APEX_ALTITUDE_DEG,
    clearanceDeg: 0,
    reason:
      'The apex IS the skyline on its bearing; nothing in the scene can occlude ' +
      'it. A pipeline that reports it hidden has an inverted comparison.',
  },
];

export const conicalPeakScene: SyntheticScene = {
  id: 'conical-peak',
  title: 'Single 1500 m cone at 10 km on a sea-level plain',
  derivation:
    'Apex altitude = atan((1500 - 2 - 10000^2/(2 R_eff)) / 10000) = 8.481293 deg ' +
    'by the curvature-drop model, 8.479576 deg by the exact sphere model. Away ' +
    'from the cone the skyline is the plain horizon at -0.042346 deg, 5412 m out.',
  observer: OBSERVER,
  sampling: SAMPLING,
  elevationAtM,
  generateSamples(): ElevationSample[] {
    return generateRadialSamples(OBSERVER, SAMPLING, elevationAtM);
  },
  expectedSkyline,
  peaks,
  expectedPeakVerdicts,
  toleranceDeg: 0.01,
  distanceToleranceM: SAMPLING.rangeStepM,
};

/**
 * Brute-force maximum altitude along one sampling ray, using the exact model
 * and the scene's own analytic terrain — no pipeline code. A third route to
 * the apex angle, and the check that no flank point beats the apex.
 */
export function bruteForceRayMaximum(bearingDeg: number): {
  altitudeDeg: number;
  distanceM: number;
  elevationM: number;
} {
  let bestAltitudeDeg = Number.NEGATIVE_INFINITY;
  let bestDistanceM = 0;
  let bestElevationM = PLAIN_ELEVATION_M;

  for (
    let distanceM = SAMPLING.rangeStepM;
    distanceM <= SAMPLING.maxRangeM;
    distanceM += SAMPLING.rangeStepM
  ) {
    const point = destinationPoint(OBSERVER_POINT, bearingDeg, distanceM);
    const elevationM = elevationAtM(point);
    const altitudeDeg = apparentAltitudeDeg(EYE_ELEVATION_M, elevationM, distanceM);
    if (altitudeDeg > bestAltitudeDeg) {
      bestAltitudeDeg = altitudeDeg;
      bestDistanceM = distanceM;
      bestElevationM = elevationM;
    }
  }

  return {
    altitudeDeg: bestAltitudeDeg,
    distanceM: bestDistanceM,
    elevationM: bestElevationM,
  };
}
