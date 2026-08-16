/**
 * Sight lines: how high above the observer's horizontal plane a piece of
 * terrain appears, and which pieces of terrain along a ray actually make it
 * into the skyline.
 *
 * ## The geometry
 *
 * An observer whose eye sits at height `h₀` above sea level looks at terrain
 * of height `h₁` at ground distance `d`. On a flat, non-refracting Earth the
 * vertical angle would simply be `atan((h₁ − h₀) / d)`.
 *
 * Two corrections matter over tens of kilometres:
 *
 * 1. **Curvature.** The Earth's surface falls away from the observer's
 *    horizontal plane. To second order in `d/R` that drop is `d² / (2R)` —
 *    about 78 m at 30 km, which is the difference between seeing a 100 m hill
 *    and not seeing it at all.
 *
 * 2. **Refraction.** The atmosphere's density falls with height, so light rays
 *    bend gently downward (concave toward the Earth) and distant terrain
 *    appears *higher* than pure geometry predicts. The standard geodetic
 *    treatment absorbs this into an **effective radius**
 *
 *        R_eff = R / (1 − k)
 *
 *    with refraction coefficient `k ≈ 0.13` for temperate daytime conditions
 *    (the value used in ordinary geodetic levelling). Straight rays over a
 *    larger sphere reproduce curved rays over the real one. With
 *    R = 6371.0 km this gives R_eff ≈ 7323 km, i.e. the apparent drop is
 *    reduced to 87 % of the purely geometric value.
 *
 * `k` is genuinely weather-dependent (it can exceed 0.2 over cold water and go
 * negative over hot ground), which is why it is exposed as an option rather
 * than baked in — but 0.13 is the default everywhere in this codebase.
 *
 * ## The sweep
 *
 * The skyline along one compass bearing is *not* the highest terrain along
 * that bearing; it is the terrain with the highest **angle**. Walking outward
 * from the observer and keeping a running maximum of the angle, a sample joins
 * the skyline only if it out-angles everything closer. Anything that fails
 * that test is, by construction, hidden behind nearer ground.
 */

import { haversineDistanceM, initialBearingDeg, toDegrees, EARTH_RADIUS_M } from './geodesy';
import type { Observer, Peak, PeakSighting } from './types';

/**
 * Standard atmospheric refraction coefficient for terrestrial sight lines.
 * 0.13 is the conventional temperate-daytime value used in geodetic levelling.
 */
export const REFRACTION_COEFFICIENT = 0.13;

/** Tuning knobs shared by every sight-line computation. */
export interface SightlineOptions {
  /** Atmospheric refraction coefficient k. Defaults to {@link REFRACTION_COEFFICIENT}. */
  refractionCoefficient?: number;
  /** Sphere radius in metres. Defaults to {@link EARTH_RADIUS_M}. */
  earthRadiusM?: number;
}

/**
 * The effective (refraction-corrected) Earth radius R/(1−k), in metres.
 *
 * Rays through a refracting atmosphere curve downward; replacing them with
 * straight rays over a sphere this much larger reproduces the same apparent
 * heights. `k = 0` returns the true radius (vacuum geometry).
 */
export function effectiveEarthRadiusM(options?: SightlineOptions): number {
  const k = options?.refractionCoefficient ?? REFRACTION_COEFFICIENT;
  const radiusM = options?.earthRadiusM ?? EARTH_RADIUS_M;
  if (k >= 1) {
    throw new RangeError(`refractionCoefficient must be < 1, received ${k}`);
  }
  return radiusM / (1 - k);
}

/**
 * How far terrain at ground distance `d` sits below the observer's horizontal
 * plane purely because the planet curves away, after refraction relief:
 *
 *     drop = d² / (2 · R_eff)
 *
 * This is the standard second-order approximation, exact enough to well under
 * a centimetre at the distances this project uses (the next term is
 * O(d⁴/R³) ≈ 0.1 mm at 100 km).
 */
export function curvatureRefractionDropM(distanceM: number, options?: SightlineOptions): number {
  return (distanceM * distanceM) / (2 * effectiveEarthRadiusM(options));
}

/**
 * Vertical angle from an observer's eye to a target, in degrees above the
 * observer's local horizontal (+ up, − down).
 *
 *     altitude = atan2( Δh − d²/(2·R_eff) , d )
 *
 * where Δh is the target's height above the eye. A target directly overhead
 * (d = 0) returns +90°, directly below returns −90°.
 */
export function altitudeAngleDeg(
  eyeElevationM: number,
  targetElevationM: number,
  distanceM: number,
  options?: SightlineOptions,
): number {
  const rise = targetElevationM - eyeElevationM - curvatureRefractionDropM(distanceM, options);
  return toDegrees(Math.atan2(rise, distanceM));
}

/**
 * Ground distance to the horizon over a flat plane at the observer's own
 * ground elevation, for an eye `eyeHeightM` above that plane.
 *
 * Maximising `altitudeAngleDeg` over d with Δh = −eyeHeight gives
 * `d = √(2 · R_eff · h)` — the classic horizon-distance formula, with the
 * refraction-inflated radius in place of the true one.
 */
export function flatTerrainHorizonDistanceM(
  eyeHeightM: number,
  options?: SightlineOptions,
): number {
  if (eyeHeightM < 0) {
    throw new RangeError(`eyeHeightM must be >= 0, received ${eyeHeightM}`);
  }
  return Math.sqrt(2 * effectiveEarthRadiusM(options) * eyeHeightM);
}

/**
 * Dip of the horizon below horizontal over a flat plane, in degrees (negative).
 *
 * Substituting `d = √(2·R_eff·h)` back into the sight-line angle collapses to
 * `atan(−√(2h / R_eff))`: the two halves of the expression (height deficit and
 * curvature drop) contribute equally at the tangent point. For a 1.6 m eye
 * height this is about −0.038°, i.e. ~2.3 arc-minutes.
 */
export function flatTerrainHorizonDipDeg(eyeHeightM: number, options?: SightlineOptions): number {
  if (eyeHeightM < 0) {
    throw new RangeError(`eyeHeightM must be >= 0, received ${eyeHeightM}`);
  }
  return toDegrees(Math.atan(-Math.sqrt((2 * eyeHeightM) / effectiveEarthRadiusM(options))));
}

/** One terrain height sampled along a bearing ray, at a ground distance from the observer. */
export interface RaySample {
  /** Ground distance from the observer, metres. */
  distanceM: number;
  /** Terrain height above sea level at that point, metres. */
  elevationM: number;
}

/** A ray sample that reached the skyline, with the angle it subtends. */
export interface SightlineHit extends RaySample {
  altitudeDeg: number;
}

/** Result of walking one bearing ray from the observer outward. */
export interface RaySweepResult {
  /**
   * Samples that out-angled everything closer to the observer, in near→far
   * order. Altitudes are strictly increasing along this list, so its last
   * element is always the ray's horizon.
   */
  skyline: readonly SightlineHit[];
  /**
   * The highest sight line on this ray — the terrain that forms the skyline.
   * `undefined` only when the ray had no samples at all.
   */
  horizon: SightlineHit | undefined;
}

/**
 * Walk a bearing ray from near to far, keeping the running maximum sight-line
 * angle, and report which samples ever set a new maximum.
 *
 * This is the whole occlusion test: terrain is hidden exactly when something
 * closer subtends a larger angle, regardless of how tall the far terrain is in
 * metres. A 1500 m ridge at 20 km loses to a 1000 m ridge at 5 km (4.2° vs
 * 11.3°) and never appears on the skyline.
 *
 * @param eyeElevationM Observer's eye height above sea level.
 * @param samples Terrain samples along the ray, ordered near → far. Distances
 *   must be non-decreasing; anything else means the caller's ray walk is buggy
 *   and would silently corrupt the occlusion result, so it throws.
 */
export function sweepRay(
  eyeElevationM: number,
  samples: readonly RaySample[],
  options?: SightlineOptions,
): RaySweepResult {
  const skyline: SightlineHit[] = [];
  let highestSoFarDeg = Number.NEGATIVE_INFINITY;
  let previousDistanceM = Number.NEGATIVE_INFINITY;

  for (const sample of samples) {
    if (sample.distanceM < previousDistanceM) {
      throw new RangeError(
        `ray samples must be ordered near→far; ${sample.distanceM} m follows ${previousDistanceM} m`,
      );
    }
    previousDistanceM = sample.distanceM;

    const altitudeDeg = altitudeAngleDeg(
      eyeElevationM,
      sample.elevationM,
      sample.distanceM,
      options,
    );
    if (altitudeDeg > highestSoFarDeg) {
      highestSoFarDeg = altitudeDeg;
      skyline.push({ distanceM: sample.distanceM, elevationM: sample.elevationM, altitudeDeg });
    }
  }

  return { skyline, horizon: skyline.length === 0 ? undefined : skyline[skyline.length - 1] };
}

/**
 * Resolve a named peak into observer-relative geometry: which way to look,
 * how far it is, and how high it rides above horizontal.
 *
 * Note the peak's own height is used as-is; whether that height is trustworthy
 * is recorded on `Peak.elevationSource`, not decided here.
 */
export function sightPeak(observer: Observer, peak: Peak, options?: SightlineOptions): PeakSighting {
  const distanceM = haversineDistanceM(observer, peak, options?.earthRadiusM ?? EARTH_RADIUS_M);
  const eyeElevationM = observer.groundElevationM + observer.eyeHeightM;

  return {
    ...peak,
    bearingDeg: initialBearingDeg(observer, peak),
    distanceKm: distanceM / 1000,
    altitudeDeg: altitudeAngleDeg(eyeElevationM, peak.elevationM, distanceM, options),
  };
}
