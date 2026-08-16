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
 *
 * ## Skyline angle vs occluding angle
 *
 * Each point also carries its whole `skylineSteps` staircase — the running
 * maximum angle as a function of distance along that bearing. Two different
 * questions get asked of a profile and only one of them is the skyline:
 *
 *   - *What does the horizon look like here?* → `interpolateHorizonAltitudeDeg`,
 *     the maximum over ALL distances. This is what a renderer draws.
 *   - *What can hide a peak at range d?* → `interpolateNearerTerrainAltitudeDeg`,
 *     the maximum over distances < d only. Terrain behind a peak is still part
 *     of the skyline, but it cannot occlude the peak, so the visibility filter
 *     must ask this one instead.
 *
 * Both read the same bracketing pair with the same weight, so a peak that is
 * farther out than everything forming its skyline gets an identical answer from
 * either.
 */

import { normaliseBearingDeg } from './geodesy';
import { sweepRay } from './sightline';
import type { RaySample, SightlineOptions } from './sightline';
import type { HorizonPoint, HorizonProfile, SkylineStep } from './types';

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
 * Union of two running-maximum staircases: the answer, at every distance, is
 * the higher of the two rays' answers at that distance.
 *
 * Each input step says "everything out to `distanceKm` reaches at most
 * `maxAltitudeDeg`". Concatenating both lists, sorting by distance and keeping
 * only the steps that set a new running maximum reproduces exactly that: at any
 * range d the running maximum of the merged list is the maximum over all steps
 * with `distanceKm ≤ d`, which is the larger of the two individual running
 * maxima there. Steps that never lead are dropped — they are already implied by
 * a nearer, higher one — so the result stays a staircase: strictly increasing
 * in distance and in angle, which is the invariant `buildHorizonProfile`
 * produces and `maxAltitudeNearerThanDeg` is happiest with.
 */
function unionSkylineSteps(
  a: readonly SkylineStep[],
  b: readonly SkylineStep[],
): SkylineStep[] {
  const combined = [...a, ...b].sort((left, right) => left.distanceKm - right.distanceKm);

  const merged: SkylineStep[] = [];
  let runningMaxDeg = Number.NEGATIVE_INFINITY;
  for (const step of combined) {
    if (step.maxAltitudeDeg <= runningMaxDeg) continue;
    runningMaxDeg = step.maxAltitudeDeg;
    // Two rays can put a step at the very same distance; the lower one carries
    // no information, so it is replaced rather than appended.
    const last = merged[merged.length - 1];
    if (last !== undefined && last.distanceKm === step.distanceKm) {
      merged[merged.length - 1] = step;
    } else {
      merged.push(step);
    }
  }
  return merged;
}

/**
 * Put arbitrary horizon points into canonical profile form: bearings folded
 * onto [0, 360), sorted ascending, and duplicates collapsed.
 *
 * Two rays can land on the same bearing (e.g. a caller sampling both 0° and
 * 360°, or two profiles being stitched together). The merge answers the two
 * questions a profile gets asked separately, because one answer will not do:
 *
 *   - **Skyline** (`altitudeDeg`, `distanceKm`, `elevationM`): the higher of
 *     the two points wins outright. The skyline at a bearing is the highest
 *     thing seen in that direction.
 *   - **Occlusion** (`skylineSteps`): the UNION of both staircases, never just
 *     the winner's. A peak is hidden by whatever stands in front of it, and
 *     that occluder can perfectly well live on the ray whose skyline lost —
 *     a near wall at +4° loses the skyline to a far ridge at +6° and still
 *     hides everything behind it. Discarding it silently labels hidden peaks.
 *
 * For self-consistent points (every staircase's highest step equals its own
 * `altitudeDeg`, which is what {@link buildHorizonProfile} emits) the union's
 * highest step still equals the merged point's `altitudeDeg`, so the two halves
 * of the merge cannot disagree.
 */
export function normaliseHorizonProfile(points: readonly HorizonPoint[]): HorizonProfile {
  const sorted = points
    .map((point) => ({ ...point, bearingDeg: normaliseBearingDeg(point.bearingDeg) }))
    .sort((a, b) => a.bearingDeg - b.bearingDeg);

  const merged: HorizonPoint[] = [];
  for (const point of sorted) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && previous.bearingDeg === point.bearingDeg) {
      const skylineSteps = unionSkylineSteps(skylineStepsOf(previous), skylineStepsOf(point));
      const higher = point.altitudeDeg > previous.altitudeDeg ? point : previous;
      merged[merged.length - 1] = { ...higher, skylineSteps };
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
    const { horizon, skyline } = sweepRay(eyeElevationM, ray.samples, options);
    if (horizon === undefined) continue;
    points.push({
      bearingDeg: ray.bearingDeg,
      altitudeDeg: horizon.altitudeDeg,
      distanceKm: horizon.distanceM / 1000,
      elevationM: horizon.elevationM,
      // `sweepRay` already computed the running maximum; every hit it kept IS a
      // step of the staircase, because it only keeps a sample when that sample
      // beats everything closer. Recording it here is what lets the visibility
      // filter later ask "how high does terrain reach nearer than X?".
      skylineSteps: skyline.map((hit) => ({
        distanceKm: hit.distanceM / 1000,
        maxAltitudeDeg: hit.altitudeDeg,
        elevationM: hit.elevationM,
      })),
    });
  }

  return normaliseHorizonProfile(points);
}

/**
 * The staircase for a profile point, supplying the one-step fallback for
 * points that carry no `skylineSteps`.
 *
 * A hand-built {@link HorizonPoint} knows exactly one thing: at `distanceKm`
 * the terrain reached `altitudeDeg`. Treating that as a single step is the
 * faithful reading — it neither invents nearer terrain that was never recorded
 * nor discards the one occluder that was.
 */
export function skylineStepsOf(point: HorizonPoint): readonly SkylineStep[] {
  return (
    point.skylineSteps ?? [
      {
        distanceKm: point.distanceKm,
        maxAltitudeDeg: point.altitudeDeg,
        elevationM: point.elevationM,
      },
    ]
  );
}

/**
 * How close two distances have to be before they are treated as the same
 * place, as a FRACTION of the distance involved.
 *
 * A peak's range and the range of the terrain sample that represents it are
 * computed by different routes — a haversine against the summit's coordinate
 * versus the step size the ray walk asked for — so when a summit coincides
 * with a sample the two agree only to within a few ULPs, in an arbitrary
 * direction. A bare `<` therefore decides "is this the peak's own sample?" by
 * rounding error: sometimes correctly excluded, sometimes included, and then
 * the peak is measured against ITSELF and its clearance collapses to ~0. The
 * verdict survives (an equal angle still clears), so nothing else complains.
 *
 * 1e-9 of the range is 10 µm at 10 km and 1 mm at 1000 km. That is:
 *   • ~7 orders of magnitude ABOVE the double-precision noise it has to absorb
 *     (relative error ~1e-16, and a few operations of accumulation);
 *   • ~6 orders of magnitude BELOW the finest terrain posting that could ever
 *     be a genuinely distinct occluder (SRTM1 is ~30 m, i.e. 3e-3 of the range
 *     at 10 km).
 * There is a factor of a million of daylight on either side, which is what
 * makes the constant principled rather than tuned: no plausible refinement of
 * the sampling or the geodesy moves either bound anywhere near it.
 *
 * Sizing the slack to the ray's range step instead would be far too coarse —
 * a step is 250 m in the analytic scenes, and the sample one step in front of
 * a summit is very often the real occluder (the cone's own flank, which it
 * clears by 0.5°).
 */
export const COINCIDENT_DISTANCE_TOLERANCE = 1e-9;

/**
 * Highest terrain angle on one bearing among samples nearer than
 * `cutoffDistanceKm`, or `undefined` when no recorded terrain is nearer.
 *
 * Nearer, not "nearer or equal", is deliberate. A summit is normally the very
 * terrain sample that produced the staircase step at its own distance;
 * counting that step would have every peak occlude itself. "Equal" is judged
 * with {@link COINCIDENT_DISTANCE_TOLERANCE} of slack rather than by exact
 * comparison, because the two distances are never bit-identical — see that
 * constant for why the tolerance can be both far above the noise and far below
 * anything real.
 *
 * The scan does not assume the steps are sorted or monotonic — they are, when
 * built by {@link buildHorizonProfile}, but a hand-assembled profile is under
 * no such obligation and a `break` on the first far step would silently drop
 * occluders.
 */
export function maxAltitudeNearerThanDeg(
  point: HorizonPoint,
  cutoffDistanceKm: number,
): number | undefined {
  const slackKm = Math.abs(cutoffDistanceKm) * COINCIDENT_DISTANCE_TOLERANCE;
  let highestDeg: number | undefined;
  for (const step of skylineStepsOf(point)) {
    if (step.distanceKm >= cutoffDistanceKm - slackKm) continue;
    if (highestDeg === undefined || step.maxAltitudeDeg > highestDeg) {
      highestDeg = step.maxAltitudeDeg;
    }
  }
  return highestDeg;
}

/** The two profile points bracketing a bearing, and where between them it sits. */
interface BearingBracket {
  before: HorizonPoint;
  after: HorizonPoint;
  /** 0 at `before`, 1 at `after`. Exactly 0 when the bearing is a sample. */
  weight: number;
}

/**
 * Locate a bearing between two profile samples, wrapping across the 359°→0°
 * seam. Shared by every interpolating query so they cannot drift apart: the
 * skyline angle and the nearer-terrain angle are always read off the same pair
 * of samples with the same weight.
 *
 * @throws RangeError if the profile is empty.
 */
function bracketAtBearing(profile: HorizonProfile, bearingDeg: number): BearingBracket {
  if (profile.length === 0) {
    throw new RangeError('cannot interpolate an empty horizon profile');
  }
  const first = pointAt(profile, 0);
  if (profile.length === 1) return { before: first, after: first, weight: 0 };

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
  if (span <= 0) return { before, after, weight: 0 };
  return { before, after, weight: (target - beforeBearing) / span };
}

/**
 * Highest angle reached by terrain NEARER than `cutoffDistanceKm` at an
 * arbitrary bearing — the occlusion question the visibility filter actually
 * needs to ask. `undefined` means no recorded terrain lies nearer, so nothing
 * at this bearing can hide something at that range.
 *
 * Interpolation across bearings is the same linear-in-bearing rule, on the same
 * bracketing samples, as {@link interpolateHorizonAltitudeDeg}, seam included.
 *
 * When exactly one of the two bracketing bearings has terrain nearer than the
 * cutoff, that one's value is returned rather than interpolated toward an
 * invented floor: a ray with no nearer sample is evidence of nothing having
 * been *sampled* there, not evidence of open air, and halving a real occluder
 * against a fictitious −90° would let peaks through that a ridge plainly hides.
 * With the uniform ray sampling `buildHorizonProfile` is fed this case cannot
 * arise anyway — every ray's first sample sets its first step, so all rays
 * share the same innermost step distance.
 *
 * @throws RangeError if the profile is empty — the same refusal to guess as
 *   {@link interpolateHorizonAltitudeDeg}.
 */
export function interpolateNearerTerrainAltitudeDeg(
  profile: HorizonProfile,
  bearingDeg: number,
  cutoffDistanceKm: number,
): number | undefined {
  const { before, after, weight } = bracketAtBearing(profile, bearingDeg);
  const beforeDeg = maxAltitudeNearerThanDeg(before, cutoffDistanceKm);
  const afterDeg = maxAltitudeNearerThanDeg(after, cutoffDistanceKm);

  if (beforeDeg === undefined) return afterDeg;
  if (afterDeg === undefined) return beforeDeg;
  return beforeDeg + weight * (afterDeg - beforeDeg);
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
  const { before, after, weight } = bracketAtBearing(profile, bearingDeg);
  return before.altitudeDeg + weight * (after.altitudeDeg - before.altitudeDeg);
}
