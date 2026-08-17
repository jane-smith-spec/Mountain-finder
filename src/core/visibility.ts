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

import { COINCIDENT_DISTANCE_TOLERANCE, interpolateNearerTerrainOccluder } from './horizon';
import { altitudeAngleDeg } from './sightline';
import type { RaySample, SightlineOptions } from './sightline';
import type { HorizonProfile, PeakSighting, PeakVisibility, VisiblePeak } from './types';

/**
 * The angle reported as `occludingAltitudeDeg` when no terrain at all lies nearer
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
  const nearerTerrain = interpolateNearerTerrainOccluder(
    profile,
    sighting.bearingDeg,
    sighting.distanceKm,
  );
  const occludingAltitudeDeg = nearerTerrain?.altitudeDeg ?? NO_NEARER_TERRAIN_ALTITUDE_DEG;
  return {
    ...sighting,
    occludingAltitudeDeg,
    clearanceDeg: sighting.altitudeDeg - occludingAltitudeDeg,
    ...(nearerTerrain === undefined
      ? {}
      : { occluderDistanceKm: nearerTerrain.occluderDistanceKm }),
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

/* ══════════════════════════════════════════════════════════════════════════
 * The near field: verdicts measured against ground the DEM cannot resolve
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * What the caller knows about the unresolvable ground around the camera —
 * the two numbers the marginal test (P1.6, docs/NEAR-FIELD.md) runs on.
 *
 * Core does not compute these: they depend on the DEM's posting, the camera's
 * position uncertainty and the terrain actually sampled nearby, all of which
 * live with the caller. The pipeline derives them from its own sweep; a test
 * states them outright.
 */
export interface NearFieldUncertainty {
  /**
   * Ground distance below which an occluder is unresolvable, metres. A few DEM
   * postings (~30 m each for SRTM1) widened by the camera's own position
   * uncertainty is the honest floor.
   */
  readonly radiusM: number;
  /**
   * Half-band on the height of near ground relative to the eye, metres — how
   * far up or down the ground beside the camera might really be. The local
   * relief the DEM itself reports within `radiusM` is the measurable lower
   * bound: at Railroad Ridge adjacent cells within 90 m disagree by metres,
   * and that disagreement IS the uncertainty of any occluder built from them.
   */
  readonly elevationBandM: number;
}

/**
 * Half-width of the uncertainty band on a peak's `clearanceDeg`, degrees.
 *
 * Zero — a fully trusted comparison — unless the occluding terrain sits inside
 * the near field, in which case the band is the angle the elevation band
 * subtends at the occluder's distance: atan(elevationBandM / distance). The
 * flat-earth arithmetic is deliberate; at ≤ a few hundred metres the curvature
 * drop is sub-millimetre and this is an uncertainty estimate, not a survey.
 *
 * `occluderDistanceKm === undefined` (no nearer terrain at all) is 0: nothing
 * occludes the peak, so there is no comparison to distrust.
 */
export function clearanceBandDeg(
  occluderDistanceKm: number | undefined,
  nearField: NearFieldUncertainty | undefined,
): number {
  if (nearField === undefined || occluderDistanceKm === undefined) return 0;
  if (!(nearField.radiusM > 0) || !(nearField.elevationBandM > 0)) return 0;
  const occluderDistanceM = occluderDistanceKm * 1000;
  if (!(occluderDistanceM > 0) || occluderDistanceM >= nearField.radiusM) return 0;
  return (Math.atan(nearField.elevationBandM / occluderDistanceM) * 180) / Math.PI;
}

/**
 * Whether the visible/occluded verdict FLIPS somewhere inside the band — the
 * definition of `'marginal'`.
 *
 * The occluding angle is uncertain by ±`bandDeg`, so `clearanceDeg` spans
 * [clearance − band, clearance + band]. If the verdict is the same at both
 * ends it is stable under the uncertainty and stands, in whichever direction;
 * if the ends disagree, the data cannot decide and the only honest state is
 * `'marginal'`. Both directions are covered on purpose: a summit 0.05° SHORT
 * of a 1.9° phantom wall is exactly as undecided as one 0.05° over it, and
 * declaring the first `foreground-occluded` would silently erase a mountain
 * that may well be in the photograph.
 *
 * A band of 0 can never be marginal, so callers with no near-field input get
 * the unchanged three-way verdict.
 */
export function isMarginalVisibility(
  clearanceDeg: number,
  bandDeg: number,
  toleranceDeg = 0,
): boolean {
  if (bandDeg < 0) {
    throw new RangeError(`bandDeg must be >= 0, received ${bandDeg}`);
  }
  if (toleranceDeg < 0) {
    throw new RangeError(`toleranceDeg must be >= 0, received ${toleranceDeg}`);
  }
  const visibleAtHigh = clearanceDeg + bandDeg >= -toleranceDeg;
  const visibleAtLow = clearanceDeg - bandDeg >= -toleranceDeg;
  return visibleAtHigh !== visibleAtLow;
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

/* ══════════════════════════════════════════════════════════════════════════
 * Classifying an occlusion: whose shoulder is in the way?
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Why a hidden summit was placed in the bucket it was placed in.
 *
 * Every classification names one of these. There is no "probably" branch and
 * no unexplained default: a peak that is not labelled can always be told what
 * it lost to, and a peak that IS labelled had to earn it with terrain evidence.
 *
 *   `'unbroken-rise-to-summit'`
 *     Self-occlusion. From the crest the viewer actually sees — the highest
 *     ground in front of the summit — out to the summit's own range, no
 *     sampled terrain drops below that crest: one continuous mass, no col, one
 *     landform.
 *
 *   `'col-between-occluder-and-summit'`
 *     Foreground occlusion, proven. The ground between the two descends below
 *     the blocking crest and climbs again — a saddle, which is exactly what
 *     separates one landform from the next. The far summit is a different hill.
 *
 *   `'unsampled-gap-between-occluder-and-summit'`
 *     Foreground occlusion, for want of evidence. The record has a hole in it
 *     (a void, an unfetched tile, water with no data) wide enough to hide a
 *     col. An unbroken rise cannot be read off terrain that was never sampled,
 *     and treating "no col recorded" as "no col" is how a missing tile would
 *     end up putting a label on a mountain nobody can see.
 *
 *   `'occluder-not-on-this-ray'`
 *     Foreground occlusion, for want of evidence. The verdict came from a
 *     horizon profile interpolated between two sampled bearings, and the single
 *     ray examined here has nothing tall enough on it. There is no crest to
 *     measure continuity from, so self-occlusion is unproven.
 */
export type OcclusionEvidence =
  | 'unbroken-rise-to-summit'
  | 'col-between-occluder-and-summit'
  | 'unsampled-gap-between-occluder-and-summit'
  | 'occluder-not-on-this-ray';

/** The two states a hidden summit can be in. `'visible'` is not an occlusion. */
export type OccludedVisibility = Exclude<PeakVisibility, 'visible'>;

/**
 * The verdict on ONE hidden summit, with the measurements it rests on.
 *
 * Field names follow src/core/types.ts: heights end in `M`, angles in `Deg`,
 * distances carry their unit. The optional fields are absent exactly when the
 * evidence is `'occluder-not-on-this-ray'` — there was no crest, so there is
 * nothing to report about one, and reporting a zero would be a measurement
 * that was never made.
 */
export interface OcclusionClassification {
  readonly kind: OccludedVisibility;
  readonly evidence: OcclusionEvidence;
  /**
   * Ground distance to the crest: the HIGHEST-ANGLE terrain sample in front of
   * the summit, i.e. the one that forms the skyline at this bearing.
   */
  readonly crestDistanceKm?: number;
  /** Height above sea level of that sample. */
  readonly crestElevationM?: number;
  /** The angle it subtends, which is what beats the summit's own. */
  readonly crestAltitudeDeg?: number;
  /**
   * How far the lowest ground between the crest and the summit falls BELOW the
   * crest, in metres — the depth of the col separating them, and 0 when the
   * ground never drops at all. This is the number the classification turns on.
   */
  readonly colDepthM?: number;
}

/** Everything {@link classifyOcclusion} needs beyond the terrain itself. */
export interface OcclusionOptions {
  /**
   * The spacing the ray was sampled at, metres. REQUIRED, and with no default,
   * because it is the yardstick for "is there a hole in this record": a
   * consecutive pair farther apart than {@link MAX_SAMPLE_GAP_FACTOR} times
   * this is a dropped sample, and a dropped sample can hide a col. A default
   * would silently turn the coverage check off for whoever forgot to pass it.
   */
  readonly sampleSpacingM: number;
  /**
   * The same slack the visibility verdict was taken at, so the crest found here
   * is the terrain that actually beat the summit. Default 0.
   */
  readonly toleranceDeg?: number;
  /**
   * How far the ground may dip below the blocking crest and still count as one
   * unbroken landform, metres. Default **0** — a genuine col, however shallow,
   * separates two landforms, and that is the definition doing the work here.
   *
   * A caller with a noisy DEM may buy slack, and pays for it in the dangerous
   * direction: every metre granted here is a metre of col that may be crossed
   * on the way to putting a label on a peak. Consider what it costs on a low
   * near obstruction — a 5 m river bank in front of a plain hides a 3000 m
   * mountain 50 km away, and only a 5 m allowance is needed to call that the
   * mountain's own shoulder.
   */
  readonly colToleranceM?: number;
  /** Earth radius and refraction, matching the run's own sightline options. */
  readonly sightline?: SightlineOptions;
}

/**
 * Ratio of nominal spacing at which a step between consecutive samples counts
 * as a hole rather than as sampling jitter.
 *
 * 1.5 is the midpoint of the only two outcomes that exist: samples on the
 * nominal grid are 1.0 apart, and a grid with any sample dropped is 2.0 or more
 * apart. Nothing lands between them, so the factor is a separator rather than a
 * threshold, and no plausible refinement of the sweep moves either value.
 */
export const MAX_SAMPLE_GAP_FACTOR = 1.5;

/**
 * Whether a ray records terrain continuously from `fromM` out to `toM`.
 *
 * "Continuously" means no step — including the step from `fromM` to the first
 * sample and from the last sample to `toM` — exceeds
 * {@link MAX_SAMPLE_GAP_FACTOR} times the nominal spacing. It is the one test
 * for "was this stretch of ground actually looked at", and it is deliberately
 * blind to WHY a stretch is missing: a void in the tile, a tile that was never
 * fetched, and a sweep that simply stopped short are the same fact from the
 * verdict's point of view — no terrain was measured there, so nothing measured
 * there can be claimed.
 *
 * The samples need not be sorted; a copy is sorted here rather than trusting
 * the caller, because an out-of-order ray would otherwise report a hole where
 * there is none and vice versa.
 *
 * `false` for an empty range request is deliberate too: `toM <= fromM` asks
 * about no ground at all, and the answer to "is this measured" is then a
 * property of the caller's arithmetic rather than of the terrain, so the
 * caller must not reach here with one.
 *
 * @param sampleSpacingM The spacing the ray was walked at. Must be > 0.
 */
export function rangeIsMeasured(
  samples: readonly RaySample[],
  fromM: number,
  toM: number,
  sampleSpacingM: number,
): boolean {
  if (!(sampleSpacingM > 0)) {
    throw new RangeError(`sampleSpacingM must be > 0, received ${sampleSpacingM}`);
  }
  if (!(toM > fromM)) {
    throw new RangeError(`toM (${toM}) must be greater than fromM (${fromM})`);
  }

  const maxGapM = sampleSpacingM * MAX_SAMPLE_GAP_FACTOR;
  const within = samples
    .filter((sample) => sample.distanceM > fromM && sample.distanceM < toM)
    .sort((a, b) => a.distanceM - b.distanceM);

  let previousM = fromM;
  for (const sample of within) {
    if (sample.distanceM - previousM > maxGapM) return false;
    previousM = sample.distanceM;
  }
  return toM - previousM <= maxGapM;
}

/**
 * Whether a peak in this state may be drawn on the overlay.
 *
 * `'marginal'` is labelled: the summit may genuinely be in the picture, the
 * data simply cannot say, and D9 already makes every label a direction rather
 * than an identification — so drawing it de-emphasised claims exactly what is
 * known. Only `'foreground-occluded'`, the one state that positively asserts
 * the peak is NOT in view behind someone else's landform, is never drawn.
 */
export function isLabelled(visibility: PeakVisibility): boolean {
  return visibility !== 'foreground-occluded';
}

/** The narrow view of a sighting the classifier needs. `PeakSighting` fits. */
export interface OccludedTarget {
  readonly distanceKm: number;
  readonly altitudeDeg: number;
}

/**
 * Decide whether a hidden summit is hidden by its own hill or by somebody
 * else's — the distinction decision D8 rests on.
 *
 * ## The rule, and why it is this one
 *
 * Walk the peak's own bearing outward. Let the **crest** be the terrain sample
 * nearer than the peak that reaches the HIGHEST ANGLE — the one that forms the
 * skyline at this bearing, and therefore the one the viewer can actually see.
 * The summit is **self-occluded** when, from the crest out to the peak's own
 * range, no sampled ground falls below the crest — and **foreground-occluded**
 * when it does.
 *
 * ## Why the highest crest and not the first one (review 2, finding 1)
 *
 * This function used to take the FIRST nearer sample that out-angled the peak,
 * defended in these comments as "a stronger test over a longer span". That
 * reasoning is backwards, and the case that shows it is ordinary terrain: a low
 * bank at 1 km, a foreslope behind it that never dips, a 900 m mountain at
 * 14.5 km, a 400 m col, and the target summit at 20 km. The bank gets in the
 * way first, the foreslope never falls below the bank, so the col reads **0**
 * and a summit across four hundred metres of saddle is called self-occluded —
 * greyed label, planted on the 900 m mountain's face, five kilometres short of
 * the summit it names. That is the exact outcome D8 exists to prevent.
 *
 * The span is longer, but the BAR is lower, and the bar is what the test is:
 * the ground between only has to stay above the crest, so the lower the crest,
 * the easier "no col" is to satisfy, and first-blocker selection therefore
 * MAXIMISES false self-occlusion — the labelling direction, the one that can
 * invent a mountain. The highest crest is also the only choice that matches
 * what the label has to be true of: the greyed label lands on the skyline the
 * viewer sees, so continuity must be proven from THAT crest to the summit, not
 * from some lower shoulder hidden behind it. And it is the same terrain the
 * visibility verdict was taken against — `occludingAltitudeDeg` is the maximum
 * angle over nearer terrain — so the classifier and the filter now name the
 * same piece of ground.
 *
 * Ties keep the nearer sample, which is the conservative half of a tie: a
 * nearer crest of equal angle leaves a longer span of ground to prove
 * continuous.
 *
 * That criterion is the topographic definition of "the same landform", not a
 * proxy for it. Summits are separated by **cols**: the saddle between two hills
 * is precisely what makes them two hills instead of one, and prominence — the
 * standard measure of a summit's independence — is measured from exactly that
 * saddle. So "no col between the blocker and the summit" says, in the terms the
 * subject itself uses, that the ground in the way is a shoulder of the peak;
 * and "a col between them" says it belongs to a different hill.
 *
 * That is what makes the greyed label honest. If the ground runs unbroken from
 * the crest to the summit then every pixel between the visible skyline and the
 * point where the summit would be belongs to that one mass, so a label planted
 * there names what is genuinely under it. Once a col intervenes, the label
 * lands on the near hill's face while the peak is somewhere behind it entirely.
 *
 * ## What it deliberately does NOT use
 *
 * Not a distance ratio between occluder and peak. It reads well on the cases in
 * hand (a shoulder at 0.85 of the summit's range versus a hill at 0.004 of a
 * volcano's) and it is wrong in principle: two ridges 15 km apart at 85 and
 * 100 km share a ratio of 0.85 and a 2 km-deep valley. Ratios have no units,
 * and landforms are separated by cols, not by fractions.
 *
 * Not an angular deficit either. How far the summit sits below the crest scales
 * with how close the observer stands to the hill, not with whether it is the
 * same hill.
 *
 * ## Refusals
 *
 * Two situations produce foreground occlusion for want of evidence rather than
 * because a col was seen: a gap in the sampled record wide enough to hide one,
 * and a ray with no blocker on it at all (the verdict having come from the
 * interpolated pair of neighbouring rays). Both err toward not labelling, which
 * is the only direction that cannot invent a mountain.
 *
 * Pure: terrain in, verdict out. Call it only for peaks already judged occluded
 * — it takes no view on visibility and never contradicts `isPeakVisible`.
 *
 * @param eyeElevationM Observer's eye above sea level, metres.
 * @param target The hidden summit's own range and angle.
 * @param ray Terrain along the peak's bearing, ordered near → far.
 */
export function classifyOcclusion(
  eyeElevationM: number,
  target: OccludedTarget,
  ray: readonly RaySample[],
  options: OcclusionOptions,
): OcclusionClassification {
  const { sampleSpacingM } = options;
  if (!(sampleSpacingM > 0)) {
    throw new RangeError(`sampleSpacingM must be > 0, received ${sampleSpacingM}`);
  }
  const colToleranceM = options.colToleranceM ?? 0;
  if (colToleranceM < 0) {
    throw new RangeError(`colToleranceM must be >= 0, received ${colToleranceM}`);
  }
  const toleranceDeg = options.toleranceDeg ?? 0;
  if (toleranceDeg < 0) {
    throw new RangeError(`toleranceDeg must be >= 0, received ${toleranceDeg}`);
  }

  // The same "a summit is not its own occluder" convention the nearer-terrain
  // query uses, with the same relative slack, so the two cannot disagree about
  // which samples lie in front of the peak.
  const targetDistanceM = target.distanceKm * 1000;
  const nearerLimitM = targetDistanceM * (1 - COINCIDENT_DISTANCE_TOLERANCE);
  const blockingAboveDeg = target.altitudeDeg + toleranceDeg;

  // Pass one: the crest is the highest-angle sample in front of the summit —
  // the skyline at this bearing. Strict `>` keeps the NEARER of two samples at
  // the same angle (see the tie note in the doc comment). The ray is not
  // assumed sorted, so this is a scan rather than a walk with an early exit.
  let crest: { readonly sample: RaySample; readonly altitudeDeg: number } | undefined;
  for (const sample of ray) {
    if (sample.distanceM <= 0 || sample.distanceM >= nearerLimitM) continue;
    const sampleAltitudeDeg = altitudeAngleDeg(
      eyeElevationM,
      sample.elevationM,
      sample.distanceM,
      options.sightline,
    );
    if (crest === undefined || sampleAltitudeDeg > crest.altitudeDeg) {
      crest = { sample, altitudeDeg: sampleAltitudeDeg };
    }
  }

  // Nothing on this ray out-angles the summit: the verdict came from the
  // interpolated pair of neighbouring rays, and there is no crest here to
  // measure continuity from. Since the crest is the MAXIMUM, this one test
  // settles it for the whole ray.
  if (crest === undefined || crest.altitudeDeg <= blockingAboveDeg) {
    return { kind: 'foreground-occluded', evidence: 'occluder-not-on-this-ray' };
  }

  // Pass two: the ground between the crest and the summit — the span whose
  // continuity decides which landform the summit belongs to.
  const beyondCrest: RaySample[] = [];
  for (const sample of ray) {
    if (sample.distanceM <= crest.sample.distanceM || sample.distanceM >= nearerLimitM) continue;
    beyondCrest.push(sample);
  }
  beyondCrest.sort((a, b) => a.distanceM - b.distanceM);

  const found = {
    crestDistanceKm: crest.sample.distanceM / 1000,
    crestElevationM: crest.sample.elevationM,
    crestAltitudeDeg: crest.altitudeDeg,
  };

  // Coverage first: a hole in the record is not evidence of continuous ground.
  // The span checked runs from the crest to the peak's own range, so a ray that
  // simply stops short of the summit is caught by the same test.
  if (!rangeIsMeasured(beyondCrest, crest.sample.distanceM, targetDistanceM, sampleSpacingM)) {
    return {
      ...found,
      kind: 'foreground-occluded',
      evidence: 'unsampled-gap-between-occluder-and-summit',
    };
  }

  let lowestBetweenM = Number.POSITIVE_INFINITY;
  for (const sample of beyondCrest) {
    if (sample.elevationM < lowestBetweenM) lowestBetweenM = sample.elevationM;
  }
  // An empty span (the crest is the sample immediately in front of the summit)
  // has no col by construction: there is no ground between them to drop.
  const colDepthM =
    lowestBetweenM === Number.POSITIVE_INFINITY
      ? 0
      : Math.max(0, crest.sample.elevationM - lowestBetweenM);

  return colDepthM > colToleranceM
    ? { ...found, colDepthM, kind: 'foreground-occluded', evidence: 'col-between-occluder-and-summit' }
    : { ...found, colDepthM, kind: 'self-occluded', evidence: 'unbroken-rise-to-summit' };
}
