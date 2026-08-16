/**
 * Visibility: deciding which sighted peaks actually show, and which are buried
 * behind a nearer ridge.
 *
 * The test is a comparison of angles, not of heights. But it is emphatically
 * NOT a comparison against the skyline, and getting that wrong is the bug this
 * module was rewritten to fix.
 *
 * ## Only NEARER terrain occludes
 *
 * The skyline at a bearing is a maximum over every distance along it. Terrain
 * that stands BEHIND a peak contributes to that maximum yet cannot possibly
 * hide the peak — it is the backdrop, not the obstruction. A 900 m summit 5 km
 * away in front of a 2400 m ridge 20 km away is in plain sight; it simply has
 * something taller behind it. Comparing it against the skyline (5.35°) instead
 * of against what lies in front of it (3.59°) declared it hidden, which is
 * wrong in the world and wrong on any photograph of it.
 *
 * So the rule is:
 *
 *   peak P at distance d_P and bearing b is VISIBLE
 *   ⟺ no terrain sample at bearing b with distance < d_P reaches an altitude
 *     angle ≥ P's own altitude angle (less the caller's tolerance).
 *
 * Equivalently: compare P against `interpolateNearerTerrainAltitudeDeg` at its
 * own range. For a peak farther out than everything that forms the skyline at
 * its bearing the two questions have the same answer, so nothing that was
 * correct before changes.
 *
 * ## Tolerance
 *
 * The tolerance parameter exists because both sides of that comparison carry
 * real error: SRTM heights are good to roughly ±10 m, terrain rays are sampled
 * at finite spacing so a narrow notch between two ridges can be missed, and a
 * peak's own quoted height may come from OSM rather than the same DEM. A small
 * positive tolerance keeps marginal summits — the ones poking a few hundredths
 * of a degree below a modelled ridge line — rather than dropping them silently.
 * It is supplied by the caller, never guessed here.
 */

import { interpolateNearerTerrainAltitudeDeg } from './horizon';
import type { HorizonProfile, PeakSighting, VisiblePeak } from './types';

/**
 * The angle reported as `horizonAltitudeDeg` when no terrain at all lies nearer
 * than the peak, so nothing can occlude it.
 *
 * −90° is the nadir: the floor of the altitude scale, which every real sighting
 * strictly exceeds, so a peak with no nearer terrain is visible at any
 * tolerance. A sentinel of −Infinity would give an infinite `clearanceDeg` and
 * poison any downstream arithmetic that sorts or scales by clearance; 0° would
 * be plain wrong, hiding every peak that sits below the observer's horizontal
 * with clear air in front of it.
 */
export const NO_NEARER_TERRAIN_ALTITUDE_DEG = -90;

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
 * Attach occlusion context to a sighting: the angle of the terrain that can
 * actually block it — everything at its bearing NEARER than the peak — and the
 * clearance between the two.
 *
 * This runs for every peak, visible or not — `clearanceDeg` is negative for
 * occluded ones, and its magnitude is exactly "how much taller would this have
 * to appear to be seen", which is the number worth showing when debugging a
 * missing label.
 *
 * The peak's own `distanceKm` is the cutoff, and the comparison against it is
 * strict, so terrain at exactly the peak's range does not occlude it. That is
 * the common case rather than an exotic one: a summit usually IS the terrain
 * sample at its own distance, and counting it would make every peak hide
 * itself.
 */
export function resolveAgainstHorizon(
  sighting: PeakSighting,
  profile: HorizonProfile,
): VisiblePeak {
  const nearerTerrainDeg = interpolateNearerTerrainAltitudeDeg(
    profile,
    sighting.bearingDeg,
    sighting.distanceKm,
  );
  const horizonAltitudeDeg = nearerTerrainDeg ?? NO_NEARER_TERRAIN_ALTITUDE_DEG;
  return {
    ...sighting,
    horizonAltitudeDeg,
    clearanceDeg: sighting.altitudeDeg - horizonAltitudeDeg,
  };
}

/**
 * Whether a resolved peak counts as visible at the given tolerance.
 *
 * Visible ⟺ clearance ≥ −tolerance, i.e. the peak clears the terrain in front
 * of it or falls short of it by no more than the caller's error budget.
 */
export function isPeakVisible(peak: VisiblePeak, toleranceDeg = 0): boolean {
  if (toleranceDeg < 0) {
    throw new RangeError(`toleranceDeg must be >= 0, received ${toleranceDeg}`);
  }
  return peak.clearanceDeg >= -toleranceDeg;
}

/**
 * Keep only the sightings that clear the terrain standing in front of them,
 * each annotated with the occluding angle it was measured against.
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
