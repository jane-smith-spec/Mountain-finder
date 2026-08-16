/**
 * Aligning the extracted skyline to the computed terrain profile: recovering
 * the heading and pitch error in the camera pose, or refusing to.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 * `GPSImgDirection` is typically 5–15° wrong (MISSION.md, decision D3).
 * Everything downstream of it in this project is exact — the projection is
 * verified against closed forms to 1e-12 — and none of that matters if the
 * heading it is fed is ten degrees off, because then every label is planted on
 * a different mountain. This module measures that error from the photograph
 * itself.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW HEADING AND PITCH ARE SEARCHED, AND WHY NOT JOINTLY
 * ═══════════════════════════════════════════════════════════════════════════
 * The identity in `rays.ts` gives the two parameters very different characters,
 * and the algorithm is built around that difference rather than ignoring it:
 *
 *   **Heading is a rigid translation in bearing.** Rotating the camera about
 *   the vertical shifts every ray's bearing by exactly Δh and does not touch
 *   its altitude. So matching over heading is a genuine 1-D cross-correlation
 *   of two functions of bearing, exact at every offset, with no trigonometry in
 *   the loop.
 *
 *   **Pitch is very nearly a constant vertical offset.** Rotating about the
 *   horizontal cross-frame axis moves a ray at off-axis bearing β by about
 *   Δp·cos β — constant to within 16 % across a 65° frame.
 *
 * A score that is *invariant to a constant vertical offset* is therefore almost
 * completely blind to pitch, and the natural such score is normalised cross-
 * correlation, which subtracts the mean of each signal before correlating. That
 * is the decision:
 *
 *   Stage 1  scan heading alone, at Δp = 0, scoring with weighted NCC. Because
 *            NCC removes the means, an unknown pitch error contributes only
 *            through the 16 % cosine modulation — second order in Δp — instead
 *            of biasing the peak.
 *   Stage 2  with the heading fixed, solve pitch in one 1-D scan on the actual
 *            geometric residual.
 *   Stage 3  a small **joint** local refinement on (Δh, Δp) around that point,
 *            using the exact rotation, which mops up the residual coupling the
 *            first two stages approximated away.
 *
 * The alternative — one joint 2-D grid at final resolution — costs
 * O(N_h · N_p · columns): 251 × 201 × 512 ≈ 26 M profile lookups for a ±25°/
 * ±10° window, against roughly 0.4 M here, and buys nothing, because stage 3
 * *is* a joint search over the only region where the coupling matters. The
 * decoupling is not an approximation in the answer; it is an approximation in
 * where to look for it, and stage 3 removes it.
 *
 * Roll is deliberately not searched. Almost every photograph is taken close to
 * level, a roll error is not what EXIF gets wrong, and a third free parameter
 * against one 1-D observation is how a fitter starts explaining terrain with
 * whichever parameter happens to be cheapest.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE REFUSAL, WHICH IS THE POINT
 * ═══════════════════════════════════════════════════════════════════════════
 * Every stage above will produce a number for any input whatsoever. Fog
 * produces a number. A sea horizon produces a number. A photograph whose true
 * offset lies outside the search window produces a number. Returning any of
 * them would be worse than not running at all: the labels would move somewhere
 * new and wrong while the system claimed to have checked the photograph against
 * the terrain.
 *
 * So five independent gates stand between the search and an answer, and each
 * one names a physically distinct way of having nothing to say:
 *
 *   coverage   too little readable skyline (fog, night, blown-out sky)
 *   relief     the skyline, or the terrain profile, is a straight line — there
 *              is no information about heading in a flat horizon at any SNR
 *   score      nothing in the window correlates at all
 *   margin     several offsets correlate equally well; the peak is not a lock
 *   residual   an offset was found, but the terrain does not actually lie on
 *              the photograph's skyline there
 *
 * plus a sixth that is about the search rather than the data: a winner sitting
 * at the edge of the window is reported as `search-range-exhausted`, because
 * the real peak may be just outside and the edge value is then meaningless.
 *
 * A failure carries **no offsets** — see the type note in `types.ts`.
 */

import { interpolateHorizonAltitudeDeg } from '../core/horizon.js';
import type { CameraPose, HorizonProfile } from '../core/types.js';
import { clamp01 } from './image.js';
import {
  applyPoseOffset,
  coversBearing,
  directionToSky,
  profileCoverage,
  unprojectFromImage,
  type ProfileCoverage,
} from './rays.js';
import type {
  AlignmentDiagnostics,
  AlignmentFailureReason,
  Skyline,
  SkylineAlignment,
} from './types.js';

// ── Gate thresholds ────────────────────────────────────────────────────────
// None of these is fitted. Each is set from what the quantity means, and the
// reasoning is written next to it so a later reader can argue with the
// reasoning rather than with the number.

/** Below this fraction of usable columns there is not enough photograph to fit. */
export const MIN_USED_FRACTION = 0.25;
/** …and below this the answer is reported but flagged. */
export const GOOD_USED_FRACTION = 0.5;

/**
 * Angular relief below which a skyline carries no heading information.
 *
 * 0.35° is just under the 0.5° accuracy this phase is held to: if the whole
 * skyline varies by less than the precision being claimed, then every heading
 * in the window fits about equally and the "best" one is noise. Applied to both
 * signals — a flat photograph and a flat terrain profile fail for the same
 * reason and are reported separately so the user knows which side is at fault.
 */
export const MIN_RELIEF_DEG = 0.35;
/**
 * Relief at which the relief term of the confidence saturates — i.e. where the
 * shape of the skyline stops being what limits the answer.
 *
 * 1° of standard deviation across the frame against an extractor whose rows
 * scatter by a tenth of a degree is a signal-to-noise ratio of ten; past that
 * the correlation peak is set by the correlation length of the ridgeline and
 * not by how much it moves. For scale, the three-bump analytic profile used in
 * the round-trip tests measures 1.92°, and the real Gornergrat sweep measures
 * about 3°, so an ordinary alpine frame sits comfortably above this and a
 * gently rolling one does not.
 */
export const GOOD_RELIEF_DEG = 1;

/** NCC below this means nothing in the window matched. */
export const MIN_SCORE = 0.35;
/** …and above this the correlation is as good as a real photograph gets. */
export const GOOD_SCORE = 0.9;

/**
 * Peak minus best **rival peak** in NCC. This is the measure that distinguishes
 * "I found it" from "I found something": a correct lock stands clear of every
 * *other* correlation peak, while a self-similar ridgeline produces a landscape
 * of near-equal bumps whose winner is arbitrary. Below 0.03 the winner is
 * inside the noise of its rival and the result is refused outright.
 *
 * "Rival" is deliberately not "any offset more than N degrees away". A real
 * alpine skyline is smooth, so its autocorrelation is broad: at Gornergrat the
 * NCC is still 0.94 a full 2° off the truth, purely because the ridgeline has
 * not changed much yet. Scoring that shoulder as a rival would flag every
 * correct alignment on real terrain as ambiguous. So the peak's own **basin**
 * — the run of offsets over which the score falls away monotonically from the
 * winner — is excluded, and the rival is the best score outside it: the best
 * genuinely *different* explanation of the same skyline. The basin is widened
 * to at least {@link PEAK_EXCLUSION_DEG} so a one-sample dimple in a noisy
 * score curve cannot shrink it to nothing.
 */
export const MIN_MARGIN = 0.03;
/** …and above this the peak is unambiguous. */
export const GOOD_MARGIN = 0.25;

/** Smallest half-width the peak's excluded basin is allowed to have. */
export const PEAK_EXCLUSION_DEG = 2;

/**
 * Weighted RMS misfit above which the offsets are refused. At 1.5° the terrain
 * is a degree and a half off the skyline it is supposed to be lying on, which
 * on the Gornergrat framing is 3 % of the frame height — a visible, obvious
 * mismatch, not a subtle one.
 */
export const MAX_RESIDUAL_DEG = 1.5;
/** …and below this the fit is as tight as SRTM sampling allows. */
export const GOOD_RESIDUAL_DEG = 0.4;

export interface AlignOptions {
  /** Half-width of the heading window, degrees. Default 25. */
  readonly headingRangeDeg?: number;
  /** Heading step of the coarse scan, degrees. Default 0.2. */
  readonly headingStepDeg?: number;
  /** Half-width of the pitch window, degrees. Default 10. */
  readonly pitchRangeDeg?: number;
  /** Pitch step of the 1-D pitch scan, degrees. Default 0.1. */
  readonly pitchStepDeg?: number;
  /** Minimum per-column confidence to be used at all. Default 0.05. */
  readonly minColumnConfidence?: number;
  /** Set false to hold pitch at zero (e.g. a tripod-levelled camera). Default true. */
  readonly searchPitch?: boolean;
}

interface Observation {
  /** Bearing under the nominal pose, degrees. Heading offsets add to this. */
  readonly bearingDeg: number;
  /** Altitude under the nominal pose, degrees. Unchanged by heading offsets. */
  readonly altitudeDeg: number;
  /** ENU unit ray under the nominal pose, for the exact pitched evaluation. */
  readonly e: number;
  readonly n: number;
  readonly u: number;
  readonly weight: number;
}

interface WeightedFit {
  readonly used: number;
  readonly weight: number;
  readonly score: number;
  readonly photoReliefDeg: number;
  readonly profileReliefDeg: number;
  readonly residualRmsDeg: number;
}

/** Build the per-column world rays once, under the pose as supplied. */
function observationsFrom(skyline: Skyline, camera: CameraPose, minConfidence: number): Observation[] {
  const observations: Observation[] = [];
  for (const column of skyline.columns) {
    if (column.rowNorm === undefined) continue;
    if (column.confidence01 < minConfidence) continue;
    const ray = unprojectFromImage(camera, column.xNorm, column.rowNorm);
    const sky = directionToSky(ray);
    observations.push({
      bearingDeg: sky.bearingDeg,
      altitudeDeg: sky.altitudeDeg,
      e: ray.e,
      n: ray.n,
      u: ray.u,
      weight: column.confidence01,
    });
  }
  return observations;
}

const EMPTY_FIT: WeightedFit = {
  used: 0,
  weight: 0,
  score: Number.NEGATIVE_INFINITY,
  photoReliefDeg: 0,
  profileReliefDeg: 0,
  residualRmsDeg: Number.POSITIVE_INFINITY,
};

/**
 * Score one candidate offset pair.
 *
 * `headingOnly` takes the fast path justified in `rays.ts`: at zero pitch the
 * bearing is the nominal bearing plus Δh and the altitude is untouched, so no
 * rotation is evaluated at all. With a pitch offset the exact rotation is
 * applied to each ray — same answer, ~20× the arithmetic, which is why the
 * heading scan runs at Δp = 0.
 */
function evaluate(
  observations: readonly Observation[],
  profile: HorizonProfile,
  coverage: ProfileCoverage,
  nominalHeadingDeg: number,
  headingOffsetDeg: number,
  pitchOffsetDeg: number,
): WeightedFit {
  let weight = 0;
  let used = 0;
  let sumPhoto = 0;
  let sumProfile = 0;
  let sumPhotoSquares = 0;
  let sumProfileSquares = 0;
  let sumProduct = 0;
  let sumResidualSquares = 0;

  for (const observation of observations) {
    let bearingDeg: number;
    let altitudeDeg: number;
    if (pitchOffsetDeg === 0) {
      bearingDeg = observation.bearingDeg + headingOffsetDeg;
      altitudeDeg = observation.altitudeDeg;
    } else {
      const rotated = applyPoseOffset(
        { e: observation.e, n: observation.n, u: observation.u },
        nominalHeadingDeg,
        headingOffsetDeg,
        pitchOffsetDeg,
      );
      const sky = directionToSky(rotated);
      bearingDeg = sky.bearingDeg;
      altitudeDeg = sky.altitudeDeg;
    }
    if (!coversBearing(coverage, bearingDeg)) continue;

    const profileDeg = interpolateHorizonAltitudeDeg(profile, bearingDeg);
    const w = observation.weight;
    weight += w;
    used += 1;
    sumPhoto += w * altitudeDeg;
    sumProfile += w * profileDeg;
    sumPhotoSquares += w * altitudeDeg * altitudeDeg;
    sumProfileSquares += w * profileDeg * profileDeg;
    sumProduct += w * altitudeDeg * profileDeg;
    const residual = altitudeDeg - profileDeg;
    sumResidualSquares += w * residual * residual;
  }

  if (weight <= 0 || used < 2) return EMPTY_FIT;

  const meanPhoto = sumPhoto / weight;
  const meanProfile = sumProfile / weight;
  const variancePhoto = Math.max(0, sumPhotoSquares / weight - meanPhoto * meanPhoto);
  const varianceProfile = Math.max(0, sumProfileSquares / weight - meanProfile * meanProfile);
  const covariance = sumProduct / weight - meanPhoto * meanProfile;
  const denominator = Math.sqrt(variancePhoto * varianceProfile);

  return {
    used,
    weight,
    // A flat signal on either side has no correlation to report; 0 is the
    // honest value, and the relief gate is what turns it into a refusal.
    score: denominator > 1e-12 ? covariance / denominator : 0,
    photoReliefDeg: Math.sqrt(variancePhoto),
    profileReliefDeg: Math.sqrt(varianceProfile),
    residualRmsDeg: Math.sqrt(sumResidualSquares / weight),
  };
}

/**
 * Sub-step peak location by fitting a parabola through the winning sample and
 * its two neighbours. Returns the offset from the centre sample in samples,
 * clamped to ±0.5 so a flat or noisy triple cannot throw the answer into the
 * next bin.
 */
function parabolicOffset(left: number, centre: number, right: number): number {
  const denominator = left - 2 * centre + right;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) return 0;
  const offset = (0.5 * (left - right)) / denominator;
  if (!Number.isFinite(offset)) return 0;
  return Math.max(-0.5, Math.min(0.5, offset));
}

function ramp(value: number, floor: number, reference: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp01((value - floor) / (reference - floor));
}

/**
 * Recover the heading and pitch error of `camera` from `skyline` against
 * `profile`, or report why it could not be done.
 *
 * Pure: same inputs, same answer. No I/O, no clock, no randomness.
 */
export function alignSkyline(
  skyline: Skyline,
  camera: CameraPose,
  profile: HorizonProfile,
  options: AlignOptions = {},
): SkylineAlignment {
  const headingRangeDeg = options.headingRangeDeg ?? 25;
  const headingStepDeg = options.headingStepDeg ?? 0.2;
  const pitchRangeDeg = options.pitchRangeDeg ?? 10;
  const pitchStepDeg = options.pitchStepDeg ?? 0.1;
  const minColumnConfidence = options.minColumnConfidence ?? 0.05;
  const searchPitch = options.searchPitch ?? true;

  if (!(headingRangeDeg > 0) || !(headingStepDeg > 0)) {
    throw new RangeError('headingRangeDeg and headingStepDeg must be > 0');
  }

  const searchRangeDeg: readonly [number, number] = [-headingRangeDeg, headingRangeDeg];
  const observations = observationsFrom(skyline, camera, minColumnConfidence);
  const columnCount = Math.max(1, skyline.columns.length);

  const emptyDiagnostics = (used: number): AlignmentDiagnostics => ({
    usedColumnCount: used,
    usedFraction01: used / columnCount,
    score: 0,
    margin: 0,
    residualRmsDeg: Number.POSITIVE_INFINITY,
    photoReliefDeg: 0,
    profileReliefDeg: 0,
    searchRangeDeg,
    atSearchEdge: false,
  });

  if (profile.length < 2) {
    return {
      status: 'failed',
      reason: 'profile-does-not-cover-frame',
      detail: `the horizon profile has ${profile.length} point(s); at least 2 are needed to interpolate`,
      diagnostics: emptyDiagnostics(observations.length),
    };
  }

  if (observations.length / columnCount < MIN_USED_FRACTION) {
    return {
      status: 'failed',
      reason: 'insufficient-skyline',
      detail:
        `only ${observations.length} of ${columnCount} columns produced a readable skyline ` +
        `(${(100 * (observations.length / columnCount)).toFixed(1)} %, ` +
        `need ${(100 * MIN_USED_FRACTION).toFixed(0)} %)`,
      diagnostics: emptyDiagnostics(observations.length),
    };
  }

  const coverage = profileCoverage(profile);

  // ── Stage 1: heading scan at zero pitch, scored by offset-blind NCC. ──────
  const steps = Math.round((2 * headingRangeDeg) / headingStepDeg);
  const candidates: number[] = [];
  const scores: number[] = [];
  let bestIndex = -1;
  for (let index = 0; index <= steps; index += 1) {
    const headingOffsetDeg = -headingRangeDeg + index * headingStepDeg;
    const fit = evaluate(observations, profile, coverage, camera.headingDeg, headingOffsetDeg, 0);
    // A candidate that can only see a sliver of the profile is not comparable
    // with one that sees all of it, so it does not compete.
    const usable = fit.used >= Math.max(2, observations.length * MIN_USED_FRACTION);
    candidates.push(headingOffsetDeg);
    scores.push(usable ? fit.score : Number.NEGATIVE_INFINITY);
    if (usable && (bestIndex < 0 || fit.score > (scores[bestIndex] ?? Number.NEGATIVE_INFINITY))) {
      bestIndex = index;
    }
  }

  if (bestIndex < 0) {
    return {
      status: 'failed',
      reason: 'profile-does-not-cover-frame',
      detail:
        'no heading in the search window put enough of the frame inside the profile’s covered ' +
        `arc (${coverage.coveredSpanDeg.toFixed(1)}° covered)`,
      diagnostics: emptyDiagnostics(observations.length),
    };
  }

  const coarseBestScore = scores[bestIndex] ?? 0;
  const atSearchEdge = bestIndex === 0 || bestIndex === steps;
  const refinedHeadingDeg =
    (candidates[bestIndex] ?? 0) +
    headingStepDeg *
      parabolicOffset(
        scores[bestIndex - 1] ?? coarseBestScore,
        coarseBestScore,
        scores[bestIndex + 1] ?? coarseBestScore,
      );

  // ── The ambiguity measure: best score outside the winner's own basin. ────
  // Walk out from the peak while the curve keeps falling; the first place it
  // turns back up is the edge of this peak and the start of the next one.
  const scoreAt = (index: number): number => scores[index] ?? Number.NEGATIVE_INFINITY;
  let basinLow = bestIndex;
  while (basinLow > 0 && scoreAt(basinLow - 1) <= scoreAt(basinLow)) basinLow -= 1;
  let basinHigh = bestIndex;
  while (basinHigh < steps && scoreAt(basinHigh + 1) <= scoreAt(basinHigh)) basinHigh += 1;
  const minExclusionSteps = Math.ceil(PEAK_EXCLUSION_DEG / headingStepDeg);
  basinLow = Math.min(basinLow, bestIndex - minExclusionSteps);
  basinHigh = Math.max(basinHigh, bestIndex + minExclusionSteps);

  let runnerUp = Number.NEGATIVE_INFINITY;
  for (let index = 0; index <= steps; index += 1) {
    if (index >= basinLow && index <= basinHigh) continue;
    const score = scoreAt(index);
    if (score > runnerUp) runnerUp = score;
  }
  // No rival at all — the whole window is one descending basin — is a unique
  // lock, and reporting the peak height itself is the honest margin there.
  const margin = Number.isFinite(runnerUp) ? coarseBestScore - runnerUp : coarseBestScore;

  // ── Stage 2: pitch, on the geometric residual, heading held. ──────────────
  let headingOffsetDeg = refinedHeadingDeg;
  let pitchOffsetDeg = 0;
  if (searchPitch) {
    const pitchSteps = Math.round((2 * pitchRangeDeg) / pitchStepDeg);
    let bestPitchIndex = 0;
    const pitchCosts: number[] = [];
    for (let index = 0; index <= pitchSteps; index += 1) {
      const candidate = -pitchRangeDeg + index * pitchStepDeg;
      const fit = evaluate(
        observations,
        profile,
        coverage,
        camera.headingDeg,
        headingOffsetDeg,
        candidate,
      );
      pitchCosts.push(fit.residualRmsDeg);
      if (fit.residualRmsDeg < (pitchCosts[bestPitchIndex] ?? Number.POSITIVE_INFINITY)) {
        bestPitchIndex = index;
      }
    }
    const centre = pitchCosts[bestPitchIndex] ?? 0;
    pitchOffsetDeg =
      -pitchRangeDeg +
      bestPitchIndex * pitchStepDeg +
      pitchStepDeg *
        parabolicOffset(
          pitchCosts[bestPitchIndex - 1] ?? centre,
          centre,
          pitchCosts[bestPitchIndex + 1] ?? centre,
        );
  }

  // ── Stage 3: joint local refinement on the exact rotation. ────────────────
  // A small dense grid, then a parabola in each axis. The window is ±1.5 coarse
  // heading steps and ±3 pitch steps: wide enough to absorb the cosine coupling
  // stages 1 and 2 approximated away, narrow enough that it cannot wander to a
  // different correlation peak and quietly change the answer.
  {
    const headingSpan = 1.5 * headingStepDeg;
    const pitchSpan = searchPitch ? 3 * pitchStepDeg : 0;
    const gridSteps = 12;
    let bestCost = Number.POSITIVE_INFINITY;
    let bestHeading = headingOffsetDeg;
    let bestPitch = pitchOffsetDeg;
    for (let hIndex = 0; hIndex <= gridSteps; hIndex += 1) {
      const h = headingOffsetDeg - headingSpan + (2 * headingSpan * hIndex) / gridSteps;
      const pitchLimit = pitchSpan > 0 ? gridSteps : 0;
      for (let pIndex = 0; pIndex <= pitchLimit; pIndex += 1) {
        const p =
          pitchSpan > 0
            ? pitchOffsetDeg - pitchSpan + (2 * pitchSpan * pIndex) / gridSteps
            : pitchOffsetDeg;
        const fit = evaluate(observations, profile, coverage, camera.headingDeg, h, p);
        if (fit.residualRmsDeg < bestCost) {
          bestCost = fit.residualRmsDeg;
          bestHeading = h;
          bestPitch = p;
        }
      }
    }
    headingOffsetDeg = bestHeading;
    pitchOffsetDeg = bestPitch;
  }

  const finalFit = evaluate(
    observations,
    profile,
    coverage,
    camera.headingDeg,
    headingOffsetDeg,
    pitchOffsetDeg,
  );

  const diagnostics: AlignmentDiagnostics = {
    usedColumnCount: finalFit.used,
    usedFraction01: finalFit.used / columnCount,
    score: finalFit.score,
    margin,
    residualRmsDeg: finalFit.residualRmsDeg,
    photoReliefDeg: finalFit.photoReliefDeg,
    profileReliefDeg: finalFit.profileReliefDeg,
    searchRangeDeg,
    atSearchEdge,
  };

  // ── The gates. Order matters: the most fundamental "nothing to work with"
  // diagnosis wins, so the reported reason is the root cause and not a
  // downstream symptom of it. ───────────────────────────────────────────────
  const fail = (reason: AlignmentFailureReason, detail: string): SkylineAlignment => ({
    status: 'failed',
    reason,
    detail,
    diagnostics,
  });

  if (diagnostics.usedFraction01 < MIN_USED_FRACTION) {
    return fail(
      'insufficient-skyline',
      `only ${finalFit.used} of ${columnCount} columns survived to the fit ` +
        `(${(100 * diagnostics.usedFraction01).toFixed(1)} %, need ${(100 * MIN_USED_FRACTION).toFixed(0)} %)`,
    );
  }
  // Terrain flatness is tested before photograph flatness because it is the
  // more fundamental diagnosis: a photograph of flat terrain has a flat skyline
  // *because* the terrain is flat, and telling the user their photo is
  // featureless would send them off to retake it when no photograph from that
  // viewpoint could ever be aligned. The other order is only right when the
  // terrain has shape and the photograph does not — which is exactly the case
  // this ordering still reports as `featureless-photo-skyline`.
  if (diagnostics.profileReliefDeg < MIN_RELIEF_DEG) {
    return fail(
      'featureless-terrain-profile',
      `the terrain profile varies by only ${diagnostics.profileReliefDeg.toFixed(3)}° across the ` +
        `frame (need ${MIN_RELIEF_DEG}°) — every heading fits a flat horizon equally well`,
    );
  }
  if (diagnostics.photoReliefDeg < MIN_RELIEF_DEG) {
    return fail(
      'featureless-photo-skyline',
      `the photograph's skyline varies by only ${diagnostics.photoReliefDeg.toFixed(3)}° ` +
        `(need ${MIN_RELIEF_DEG}°) — there is no shape here to match a heading against`,
    );
  }
  if (diagnostics.score < MIN_SCORE) {
    return fail(
      'no-correlation',
      `best correlation in ±${headingRangeDeg}° was ${diagnostics.score.toFixed(3)} ` +
        `(need ${MIN_SCORE}); the true offset may lie outside the search window`,
    );
  }
  if (atSearchEdge) {
    return fail(
      'search-range-exhausted',
      `the best heading sat at the edge of the ±${headingRangeDeg}° window, so the correlation ` +
        'peak may be outside it and this value cannot be trusted',
    );
  }
  if (margin < MIN_MARGIN) {
    return fail(
      'ambiguous-correlation',
      `the winning offset beats the best rival correlation peak by only ${margin.toFixed(3)} ` +
        `(need ${MIN_MARGIN}); several headings fit this skyline about equally well`,
    );
  }
  if (diagnostics.residualRmsDeg > MAX_RESIDUAL_DEG) {
    return fail(
      'residual-too-large',
      `terrain sits ${diagnostics.residualRmsDeg.toFixed(2)}° RMS off the extracted skyline ` +
        `at the best offset (limit ${MAX_RESIDUAL_DEG}°)`,
    );
  }

  const concerns: AlignmentFailureReason[] = [];
  if (diagnostics.usedFraction01 < GOOD_USED_FRACTION) concerns.push('insufficient-skyline');
  if (diagnostics.score < GOOD_SCORE) concerns.push('no-correlation');
  if (margin < GOOD_MARGIN) concerns.push('ambiguous-correlation');
  if (diagnostics.residualRmsDeg > GOOD_RESIDUAL_DEG) concerns.push('residual-too-large');
  if (Math.min(diagnostics.photoReliefDeg, diagnostics.profileReliefDeg) < GOOD_RELIEF_DEG) {
    concerns.push('featureless-terrain-profile');
  }

  const confidence01 = clamp01(
    ramp(diagnostics.usedFraction01, MIN_USED_FRACTION, GOOD_USED_FRACTION) *
      ramp(diagnostics.score, MIN_SCORE, GOOD_SCORE) *
      ramp(margin, MIN_MARGIN, GOOD_MARGIN) *
      ramp(-diagnostics.residualRmsDeg, -MAX_RESIDUAL_DEG, -GOOD_RESIDUAL_DEG) *
      ramp(
        Math.min(diagnostics.photoReliefDeg, diagnostics.profileReliefDeg),
        MIN_RELIEF_DEG,
        GOOD_RELIEF_DEG,
      ),
  );

  return {
    status: concerns.length === 0 ? 'aligned' : 'low-confidence',
    headingOffsetDeg,
    pitchOffsetDeg,
    correctedCamera: {
      ...camera,
      headingDeg: camera.headingDeg + headingOffsetDeg,
      pitchDeg: camera.pitchDeg + pitchOffsetDeg,
    },
    confidence01,
    concerns,
    diagnostics,
  };
}
