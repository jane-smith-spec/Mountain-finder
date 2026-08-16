/**
 * Visibility: deciding which sighted peaks actually show above the terrain
 * skyline and which are buried behind a nearer ridge.
 *
 * The test is a single comparison of angles, not of heights. A peak is visible
 * exactly when its own vertical angle exceeds the horizon profile's angle at
 * the same bearing — the horizon profile has already absorbed curvature,
 * refraction and near-far occlusion when it was swept.
 *
 * The tolerance parameter exists because both sides of that comparison carry
 * real error: SRTM heights are good to roughly ±10 m, terrain rays are sampled
 * at finite spacing so a narrow notch between two ridges can be missed, and a
 * peak's own quoted height may come from OSM rather than the same DEM. A small
 * positive tolerance keeps marginal summits — the ones poking a few hundredths
 * of a degree below a modelled ridge line — rather than dropping them silently.
 * It is supplied by the caller, never guessed here.
 */

import { interpolateHorizonAltitudeDeg } from './horizon';
import type { HorizonProfile, PeakSighting, VisiblePeak } from './types';

/** Options for the visibility filter. */
export interface VisibilityOptions {
  /**
   * Degrees of slack granted to a peak that falls below the modelled skyline.
   * 0 means a peak must strictly reach the horizon line. Must not be negative
   * — demanding extra clearance is a different question and would need its own
   * parameter name.
   */
  toleranceDeg?: number;
}

/**
 * Attach horizon context to a sighting: the skyline angle at its bearing and
 * the clearance between the two.
 *
 * This runs for every peak, visible or not — `clearanceDeg` is negative for
 * occluded ones, and its magnitude is exactly "how much taller would this have
 * to appear to be seen", which is the number worth showing when debugging a
 * missing label.
 */
export function resolveAgainstHorizon(
  sighting: PeakSighting,
  profile: HorizonProfile,
): VisiblePeak {
  const horizonAltitudeDeg = interpolateHorizonAltitudeDeg(profile, sighting.bearingDeg);
  return {
    ...sighting,
    horizonAltitudeDeg,
    clearanceDeg: sighting.altitudeDeg - horizonAltitudeDeg,
  };
}

/**
 * Whether a horizon-resolved peak counts as visible at the given tolerance.
 *
 * Visible ⟺ clearance ≥ −tolerance, i.e. the peak clears the skyline or falls
 * short of it by no more than the caller's error budget.
 */
export function isPeakVisible(peak: VisiblePeak, toleranceDeg = 0): boolean {
  if (toleranceDeg < 0) {
    throw new RangeError(`toleranceDeg must be >= 0, received ${toleranceDeg}`);
  }
  return peak.clearanceDeg >= -toleranceDeg;
}

/**
 * Keep only the sightings that clear the skyline, each annotated with the
 * horizon angle it was measured against.
 *
 * Input order is preserved: callers that sorted by distance or prominence keep
 * that ordering for label layout.
 */
export function filterVisiblePeaks(
  sightings: readonly PeakSighting[],
  profile: HorizonProfile,
  options?: VisibilityOptions,
): VisiblePeak[] {
  const toleranceDeg = options?.toleranceDeg ?? 0;
  if (toleranceDeg < 0) {
    throw new RangeError(`toleranceDeg must be >= 0, received ${toleranceDeg}`);
  }

  const visible: VisiblePeak[] = [];
  for (const sighting of sightings) {
    const resolved = resolveAgainstHorizon(sighting, profile);
    if (isPeakVisible(resolved, toleranceDeg)) {
      visible.push(resolved);
    }
  }
  return visible;
}
