/**
 * Horizon profiles: the observer's skyline as a function of compass bearing.
 *
 * A profile is a list of {@link HorizonPoint}s sorted ascending by bearing,
 * each recording the angle the terrain reaches at that bearing and which
 * terrain is responsible. Between samples the skyline is treated as linear in
 * bearing — the same assumption a renderer makes when it draws the horizon as
 * a polyline, so the visibility test and the drawn line agree by construction.
 *
 * The awkward part is that bearing is circular. A profile sampled every 1°
 * from 0° has no sample between 359° and 360°, yet a peak at 359.5° must still
 * get an answer, interpolated across the seam between the last sample and the
 * first. Every function here treats the profile as a closed loop.
 */

import { normaliseBearingDeg } from './geodesy';
import { sweepRay } from './sightline';
import type { RaySample, SightlineOptions } from './sightline';
import type { HorizonPoint, HorizonProfile } from './types';

/** Terrain samples taken along one compass bearing, ordered near → far. */
export interface BearingRay {
  bearingDeg: number;
  samples: readonly RaySample[];
}

/**
 * Bounds-checked element access.
 *
 * `noUncheckedIndexedAccess` is on, so indexing yields `T | undefined`. Rather
 * than assert the undefined away, every access goes through here: if an index
 * is ever out of range that is a logic error and should say so loudly.
 */
function pointAt(profile: HorizonProfile, index: number): HorizonPoint {
  const point = profile[index];
  if (point === undefined) {
    throw new RangeError(
      `horizon profile index ${index} out of range (profile has ${profile.length} points)`,
    );
  }
  return point;
}

/**
 * Put arbitrary horizon points into canonical profile form: bearings folded
 * onto [0, 360), sorted ascending, and duplicates collapsed.
 *
 * Two rays can land on the same bearing (e.g. a caller sampling both 0° and
 * 360°). Keeping the higher of the two is the physically correct merge: the
 * skyline at a bearing is the highest thing seen in that direction.
 */
export function normaliseHorizonProfile(points: readonly HorizonPoint[]): HorizonProfile {
  const sorted = points
    .map((point) => ({ ...point, bearingDeg: normaliseBearingDeg(point.bearingDeg) }))
    .sort((a, b) => a.bearingDeg - b.bearingDeg);

  const merged: HorizonPoint[] = [];
  for (const point of sorted) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && previous.bearingDeg === point.bearingDeg) {
      if (point.altitudeDeg > previous.altitudeDeg) {
        merged[merged.length - 1] = point;
      }
      continue;
    }
    merged.push(point);
  }
  return merged;
}

/**
 * Build a horizon profile by sweeping each bearing ray outward and taking the
 * terrain that wins the occlusion contest on that ray.
 *
 * Rays with no samples contribute nothing — a gap in the profile is honest,
 * and interpolation will bridge it linearly from the neighbours rather than
 * inventing a zero-altitude horizon that would let hidden peaks through.
 *
 * @param eyeElevationM Observer's eye height above sea level, metres.
 */
export function buildHorizonProfile(
  eyeElevationM: number,
  rays: readonly BearingRay[],
  options?: SightlineOptions,
): HorizonProfile {
  const points: HorizonPoint[] = [];

  for (const ray of rays) {
    const { horizon } = sweepRay(eyeElevationM, ray.samples, options);
    if (horizon === undefined) continue;
    points.push({
      bearingDeg: ray.bearingDeg,
      altitudeDeg: horizon.altitudeDeg,
      distanceKm: horizon.distanceM / 1000,
      elevationM: horizon.elevationM,
    });
  }

  return normaliseHorizonProfile(points);
}

/**
 * Index of the last profile point at or before `targetDeg`, or -1 if the
 * target sits before the first sample. Binary search — profiles are sorted and
 * a 0.5°-resolution 360° sweep has 720 points that get queried once per peak.
 */
function lastIndexAtOrBefore(profile: HorizonProfile, targetDeg: number): number {
  let low = -1;
  let high = profile.length;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (pointAt(profile, mid).bearingDeg <= targetDeg) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * Skyline altitude at an arbitrary bearing, linearly interpolated between the
 * bracketing samples and wrapping correctly across the 359°→0° seam.
 *
 * At a bearing that coincides exactly with a sample the sample's own altitude
 * is returned unchanged (the interpolation weight is exactly zero), so a
 * profile never disagrees with itself.
 *
 * @throws RangeError if the profile is empty — there is no defensible answer,
 *   and silently returning 0° would declare every peak visible.
 */
export function interpolateHorizonAltitudeDeg(
  profile: HorizonProfile,
  bearingDeg: number,
): number {
  if (profile.length === 0) {
    throw new RangeError('cannot interpolate an empty horizon profile');
  }
  const first = pointAt(profile, 0);
  if (profile.length === 1) return first.altitudeDeg;

  const target = normaliseBearingDeg(bearingDeg);
  const lastIndex = profile.length - 1;
  const beforeIndex = lastIndexAtOrBefore(profile, target);

  // Three cases: inside the profile, or off either end — where the bracketing
  // pair is (last, first) with one of them unwrapped by a full turn so the
  // interpolation parameter still runs 0→1 across the seam.
  let before: HorizonPoint;
  let after: HorizonPoint;
  let beforeBearing: number;
  let afterBearing: number;

  if (beforeIndex === -1) {
    before = pointAt(profile, lastIndex);
    after = first;
    beforeBearing = before.bearingDeg - 360;
    afterBearing = after.bearingDeg;
  } else if (beforeIndex === lastIndex) {
    before = pointAt(profile, lastIndex);
    after = first;
    beforeBearing = before.bearingDeg;
    afterBearing = after.bearingDeg + 360;
  } else {
    before = pointAt(profile, beforeIndex);
    after = pointAt(profile, beforeIndex + 1);
    beforeBearing = before.bearingDeg;
    afterBearing = after.bearingDeg;
  }

  const span = afterBearing - beforeBearing;
  if (span <= 0) return before.altitudeDeg;

  const weight = (target - beforeBearing) / span;
  return before.altitudeDeg + weight * (after.altitudeDeg - before.altitudeDeg);
}
