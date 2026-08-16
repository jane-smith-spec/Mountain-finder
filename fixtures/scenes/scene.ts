/**
 * The shape every synthetic analytic scene in this directory conforms to.
 *
 * A scene is two halves that must never talk to each other through pipeline
 * code (MISSION.md "synthetic ground truth before real ground truth"):
 *
 *   (a) a GENERATOR — turns an analytic terrain function into the
 *       `ElevationSample[]` the pipeline will be fed, and
 *   (b) EXPECTATIONS — the skyline that terrain must produce, obtained in
 *       closed form with the arithmetic written out in the scene module.
 *
 * Nothing in this file imports src/core beyond the frozen type contract.
 */

import type { ElevationSample, LatLng, Observer, Peak } from '../../src/core/types';
import { destinationPoint } from './scene-geometry';

/** How the analytic terrain is turned into discrete samples. */
export interface SceneSampling {
  /** Angular spacing of the sampling rays, degrees. */
  bearingStepDeg: number;
  /** Spacing of samples along each ray, metres of ground distance. */
  rangeStepM: number;
  /** Longest ground distance sampled, metres. */
  maxRangeM: number;
}

/** One closed-form skyline expectation at a specific bearing. */
export interface ExpectedSkylinePoint {
  bearingDeg: number;
  /**
   * Canonical expected skyline angle, from the EXACT effective-radius sphere
   * model (`apparentAltitudeDeg`).
   */
  altitudeDeg: number;
  /**
   * The same angle from the independent "curvature drop" derivation
   * (`apparentAltitudeDegPlaneDrop`). Exported so a reviewer can see how much
   * of the answer depends on the choice of model: across these scenes, under
   * 0.002°.
   */
  altitudeDegPlaneDrop: number;
  /** Ground distance to the terrain that forms the skyline here, metres. */
  distanceM: number;
  /** Height above sea level of that terrain, metres. */
  elevationM: number;
  /** What makes this the answer, in one line. */
  note: string;
}

/** Expected outcome of the visibility filter for one named peak in a scene. */
export interface ExpectedPeakVerdict {
  peakId: string;
  visible: boolean;
  /** The closed-form angle of the peak itself (exact sphere model). */
  peakAltitudeDeg: number;
  /**
   * The closed-form OCCLUDING angle for this peak: the highest angle reached
   * by terrain at the peak's bearing that lies STRICTLY NEARER to the observer
   * than the peak. That — not the skyline — is what decides visibility under
   * the corrected P1.5 rule, because terrain behind a peak is backdrop and
   * cannot hide it.
   *
   * It equals the skyline angle only when the peak is farther out than
   * everything that forms the skyline at its bearing. When something taller
   * stands BEHIND the peak (twin-ridges variant A's near crest) or the peak IS
   * the skyline (the cone's apex, occluded only by its own flank) the two
   * differ, and using the skyline there is the pre-P1.5 bug: it makes a summit
   * its own occluder and reports a clearance of exactly zero.
   *
   * The name is the pre-P1.5 one and is scheduled to become
   * `occludingAltitudeDeg`; the meaning is as described here, and both
   * twin-ridges.ts and conical-peak.ts populate it accordingly.
   */
  skylineAltitudeDeg: number;
  /** peakAltitudeDeg − skylineAltitudeDeg. Sign decides `visible`. */
  clearanceDeg: number;
  reason: string;
}

export interface SyntheticScene {
  readonly id: string;
  readonly title: string;
  /** One-paragraph plain-English statement of what is being proven. */
  readonly derivation: string;
  readonly observer: Observer;
  readonly sampling: SceneSampling;
  /** Analytic terrain height at any coordinate. The scene's ground truth. */
  elevationAtM(point: LatLng): number;
  /** (a) The generator: analytic terrain → the pipeline's input data. */
  generateSamples(): ElevationSample[];
  /** (b) The expectations, derived in closed form inside the scene module. */
  readonly expectedSkyline: readonly ExpectedSkylinePoint[];
  readonly peaks: readonly Peak[];
  readonly expectedPeakVerdicts: readonly ExpectedPeakVerdict[];
  /**
   * Angular tolerance the pipeline is allowed against `expectedSkyline`.
   * Set by PLAN.md P1.2 (0.01°) unless a scene documents a reason to differ.
   */
  readonly toleranceDeg: number;
  /**
   * Positional tolerance for `distanceM`. Sampling is discrete, so the
   * pipeline can only ever name a sample point; one range step is the floor.
   */
  readonly distanceToleranceM: number;
}

/** Eye height above sea level = ground + eye. Used by every closed form here. */
export function eyeElevationM(observer: Observer): number {
  return observer.groundElevationM + observer.eyeHeightM;
}

/**
 * Radial sampling grid: rays every `bearingStepDeg`, samples every
 * `rangeStepM` out to `maxRangeM`, plus the observer's own coordinate at
 * range 0.
 *
 * A radial grid (rather than a lat/lon raster) is used so that every sampling
 * ray passes exactly through the features whose angles are computed in closed
 * form — the crest of a ridge at 5000 m really is sampled AT 5000 m, so the
 * expectations are not blurred by grid interpolation. Range steps are chosen in
 * each scene to divide the key distances exactly.
 */
export function generateRadialSamples(
  observer: Observer,
  sampling: SceneSampling,
  elevationAtM: (point: LatLng) => number,
): ElevationSample[] {
  const { bearingStepDeg, rangeStepM, maxRangeM } = sampling;
  const origin: LatLng = { lat: observer.lat, lon: observer.lon };

  const samples: ElevationSample[] = [
    { lat: origin.lat, lon: origin.lon, elevationM: elevationAtM(origin) },
  ];

  const rayCount = Math.round(360 / bearingStepDeg);
  const stepCount = Math.round(maxRangeM / rangeStepM);

  for (let rayIndex = 0; rayIndex < rayCount; rayIndex += 1) {
    const bearingDeg = rayIndex * bearingStepDeg;
    for (let stepIndex = 1; stepIndex <= stepCount; stepIndex += 1) {
      const point = destinationPoint(origin, bearingDeg, stepIndex * rangeStepM);
      samples.push({
        lat: point.lat,
        lon: point.lon,
        elevationM: elevationAtM(point),
      });
    }
  }

  return samples;
}
