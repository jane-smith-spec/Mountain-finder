/**
 * Naming the terrain that hides a peak.
 *
 * `filterVisiblePeaks` answers *whether* a peak clears the ground in front of
 * it, and `VisiblePeak.horizonAltitudeDeg` says what angle it lost to. Neither
 * says WHICH ridge won, and that is the first thing anyone asks when a label
 * they expected is missing — "Ben Nevis is hidden" is an assertion, "Ben Nevis
 * is hidden by 250 m of ground 1.2 km away on bearing 112°" is a diagnosis
 * somebody can go and check against a map.
 *
 * This is a reporting layer over the same staircase the filter used, not a
 * second visibility rule. It never changes a verdict.
 */

import { angularDifferenceDeg } from '../core/geodesy.js';
import { skylineStepsOf } from '../core/horizon.js';
import type { HorizonPoint, HorizonProfile, PeakSighting } from '../core/types.js';

import type { OccluderNote } from './types.js';

/** The profile sample whose bearing is closest to `bearingDeg`, seam included. */
export function nearestProfilePoint(
  profile: HorizonProfile,
  bearingDeg: number,
): HorizonPoint | undefined {
  let best: HorizonPoint | undefined;
  let bestSeparationDeg = Number.POSITIVE_INFINITY;
  for (const point of profile) {
    const separationDeg = Math.abs(angularDifferenceDeg(point.bearingDeg, bearingDeg));
    if (separationDeg < bestSeparationDeg) {
      bestSeparationDeg = separationDeg;
      best = point;
    }
  }
  return best;
}

/**
 * The nearest step on the peak's own ray that reaches the peak's altitude
 * angle, i.e. the first thing along the sightline tall enough to be in the way.
 *
 * Read off the single nearest ray rather than the interpolated pair, because a
 * blocker is a real piece of ground at a real range: interpolating "1.1 km at
 * 240 m" between two rays would invent terrain that is on neither of them. The
 * verdict itself still comes from the interpolated filter, so on rare occasions
 * a peak is judged hidden by the pair while the nearest ray alone has nothing
 * tall enough. That case reports the highest nearer step on the ray and is
 * flagged by an altitude below the peak's own — the honest reading of "the
 * blocker is between the sampled rays".
 */
export function describeOccluder(
  profile: HorizonProfile,
  sighting: PeakSighting,
): OccluderNote | undefined {
  const point = nearestProfilePoint(profile, sighting.bearingDeg);
  if (point === undefined) return undefined;

  let tallestNearer: OccluderNote | undefined;
  for (const step of skylineStepsOf(point)) {
    if (step.distanceKm >= sighting.distanceKm) continue;
    const note: OccluderNote = {
      distanceKm: step.distanceKm,
      elevationM: step.elevationM,
      altitudeDeg: step.maxAltitudeDeg,
      rayBearingDeg: point.bearingDeg,
    };
    if (step.maxAltitudeDeg >= sighting.altitudeDeg) return note;
    if (tallestNearer === undefined || step.maxAltitudeDeg > tallestNearer.altitudeDeg) {
      tallestNearer = note;
    }
  }
  return tallestNearer;
}
