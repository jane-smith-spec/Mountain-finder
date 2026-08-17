/**
 * The seam between the CV aligner and the rest of the pipeline — and nothing
 * else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * Phase 7 builds the aligner and proves it. Wiring it into the app — replacing
 * the manual trim sliders of P5.1 with an automatic correction — is a separate
 * step, on purpose: the trim sliders are a control the user can see and undo,
 * and swapping them for an automatic one is only an improvement once the
 * automatic one's quality on *real photographs* is known. It is not yet (see
 * `src/cv/real-photo.test.ts`: this repository contains no photograph of a
 * mountain to measure it on).
 *
 * So this file is one small pure function plus the shape a caller would use. It
 * is not exported from `src/pipeline/index.ts`, nothing in `src/app` imports
 * it, and no existing pipeline file was touched to add it. When integration
 * happens, the changes are:
 *
 *   1. `src/app` decodes the dropped photograph to RGBA it already has in a
 *      canvas, and calls {@link alignSceneToPhoto} with the scene the pipeline
 *      just produced.
 *   2. On `'aligned'`, the trim sliders are *pre-set* to the recovered offsets
 *      and labelled as auto-detected — not hidden. On `'low-confidence'` the
 *      offsets are offered as a suggestion the user applies. On `'failed'` the
 *      sliders behave exactly as they do today and the reason is shown.
 *   3. Nothing about the scene is recomputed silently: the corrected pose is a
 *      new pose, and re-running the pipeline with it is the caller's decision.
 *
 * The reason step 2 is written down here rather than left to taste: an
 * automatic correction that cannot be seen or undone is strictly worse than a
 * manual one, because when it is wrong the user has no way to know it moved
 * anything.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PURITY
 * ═══════════════════════════════════════════════════════════════════════════
 * Unlike the rest of `src/pipeline` this module awaits nothing and injects
 * nothing: it is as pure as `src/cv` itself. Decoding the JPEG to pixels is the
 * caller's job, which is what keeps an image codec out of the pipeline's
 * dependency graph and lets the identical call run in Node and in a browser.
 */

import type { CameraPose, HorizonProfile } from '../core/types.js';
import { alignSkyline, type AlignOptions } from '../cv/align.js';
import { extractSkyline, type SkylineOptions } from '../cv/skyline.js';
import type {
  RgbaImage,
  Skyline,
  SkylineAlignment,
  SkylineAlignmentFailure,
  SkylineAlignmentSolution,
} from '../cv/types.js';

/** What the aligner needs from a scene. Structurally satisfied by `AnnotatedScene`. */
export interface AlignableScene {
  /** The pose the scene was computed with — the one suspected of being wrong. */
  readonly camera: CameraPose;
  /** The terrain skyline the same run produced. */
  readonly horizon: HorizonProfile;
}

export interface SceneAlignmentRequest {
  /** The photograph, decoded. `jpeg-js` and `getImageData` both produce this. */
  readonly image: RgbaImage;
  readonly scene: AlignableScene;
  readonly skyline?: SkylineOptions;
  readonly align?: AlignOptions;
}

export interface SceneAlignmentResult {
  /** What the extractor read off the photograph, kept for diagnostics and overlays. */
  readonly skyline: Skyline;
  readonly alignment: SkylineAlignment;
  /**
   * The pose to re-run the pipeline with, or `undefined` when the alignment
   * failed. Present for `'low-confidence'` too — the caller decides whether to
   * offer or apply it, and `alignment.status` is how it decides.
   */
  readonly correctedCamera: CameraPose | undefined;
}

/**
 * Extract the photograph's skyline and align the scene's terrain profile to it.
 *
 * Pure and synchronous. Returns data, never a mutated scene: correcting a pose
 * means re-running the pipeline, and doing that behind the caller's back is how
 * a system ends up with two poses and no idea which one drew the labels.
 */
export function alignSceneToPhoto(request: SceneAlignmentRequest): SceneAlignmentResult {
  const skyline = extractSkyline(request.image, request.skyline);
  const alignment = alignSkyline(
    skyline,
    request.scene.camera,
    request.scene.horizon,
    request.align,
  );
  return {
    skyline,
    alignment,
    correctedCamera: alignment.status === 'failed' ? undefined : alignment.correctedCamera,
  };
}

/**
 * A one-line summary for a UI or a log: what happened, and how sure.
 *
 * Exists so that "failed" is never rendered as an empty string somewhere and
 * read as "fine". Every branch says something.
 */
export function describeAlignment(alignment: SkylineAlignment): string {
  if (alignment.status === 'failed') {
    return `no alignment (${alignment.reason}): ${alignment.detail}`;
  }
  const heading = alignment.headingOffsetDeg.toFixed(2);
  const pitch = alignment.pitchOffsetDeg.toFixed(2);
  const confidence = (100 * alignment.confidence01).toFixed(0);
  if (alignment.status === 'low-confidence') {
    return (
      `tentative: heading ${heading}°, pitch ${pitch}° (confidence ${confidence} %, ` +
      `concerns: ${alignment.concerns.join(', ')})`
    );
  }
  return `heading ${heading}°, pitch ${pitch}° (confidence ${confidence} %)`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * P7.4 — the decision layer: from "an alignment" to "a trim worth suggesting"
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `alignSceneToPhoto` answers "what offset best matches this profile to this
 * photograph". Whether that offset should ever reach the trim sliders is a
 * separate question, and the Railroad Ridge measurements (CV-10 in
 * docs/FINDINGS.md) settled two policies this function enforces:
 *
 * 1. **The profile must not contain the near field.** With the 90 m phantom
 *    wall in the profile the recovered pitch was wrong by +1.13°; with terrain
 *    inside 150 m excluded it was wrong by 0.07–0.82° in every configuration
 *    measured. The near field is unresolvable ground (docs/NEAR-FIELD.md) and
 *    aligning a photograph to it is aligning to the sampling grid. This is
 *    checkable from the profile itself — every point carries the range of the
 *    terrain that set it — so it is CHECKED, not trusted to a comment.
 *
 * 2. **The heading search is clamped to the compass's error budget.** Given
 *    the full ±25° window on the phantom-free profile, the aligner picked a
 *    heading 10.4° west of the photogrammetric truth — with the best score
 *    (0.861) and margin (0.392) of any run measured, i.e. a confident
 *    impostor no internal gate can catch. SRTM smooths and laterally
 *    displaces the crests whose shape is being matched, and on a serrated
 *    ridge system the smoothed shape can genuinely resemble itself elsewhere.
 *    The only anchor that separates the true peak from the impostor is the
 *    compass: inside a ±6° window the same skyline, profile and gates
 *    recovered the heading to 0.21°. So the search range here IS the claim
 *    "the compass is not wrong by more than this", the default is small, and
 *    a compass worse than the budget produces an honest refusal (the search
 *    hits its rim and the aligner declines) rather than a confident wrong
 *    answer from a wider hunt.
 */

/**
 * How far the compass is allowed to be wrong, degrees — the heading search
 * half-range.
 *
 * 6° is ten times the one measured compass error in this repository (0.596°,
 * docs/REAL-PHOTO-POSE.md) and small enough to exclude the measured impostor
 * at 10.4°. It is NOT large enough to cover the folklore 5–15° worst case —
 * deliberately: a compass that wrong makes the sliders-stay-manual outcome the
 * correct one, because a wider search has been measured to return confident
 * wrong answers, and a wrong pre-set is strictly worse than no pre-set.
 */
export const DEFAULT_COMPASS_BUDGET_DEG = 6;

/** Ground nearer than this is unresolvable by the DEM — see docs/NEAR-FIELD.md. */
export const DEFAULT_NEAR_FIELD_RADIUS_M = 150;

/**
 * Spacing of the comb's window centres, degrees. With windows ±0.6° wide the
 * comb overlaps itself, so an optimum near a window's rim is interior to the
 * neighbouring window — measured as what it takes to isolate the +0.50°
 * optimum on the real frame, where a ±6° window's own rim out-scores it.
 */
export const COMB_STEP_DEG = 1;

/** Half-width of each comb window, degrees. Overlaps the step (see above). */
export const COMB_HALF_WIDTH_DEG = 0.6;

export interface PoseTrimRequest {
  readonly image: RgbaImage;
  readonly scene: AlignableScene;
  /** Heading search half-range. Default {@link DEFAULT_COMPASS_BUDGET_DEG}. */
  readonly compassBudgetDeg?: number;
  /** Near-field radius for the profile precondition. Default 150 m. */
  readonly nearFieldRadiusM?: number;
  readonly skyline?: SkylineOptions;
  readonly align?: Omit<AlignOptions, 'headingRangeDeg'>;
}

/** Why no trim was suggested. Every value is a distinct, actionable diagnosis. */
export type PoseTrimDeclineReason =
  /**
   * The scene's profile rests on unresolvable near ground somewhere in the
   * searched span. Re-sweep with `minRangeM` at the near-field radius; the
   * pipeline's own verdicts keep the near field (P1.6 carries its uncertainty
   * instead), so this is a second sweep, not a changed scene.
   */
  | 'near-field-in-profile'
  /** The aligner refused — fog, flat terrain, search rim, ambiguity, … */
  | 'no-alignment';

export type PoseTrimSuggestion =
  | {
      readonly status: 'suggested';
      /** Add to the pose's heading — the same sign the trim sliders use. */
      readonly headingTrimDeg: number;
      readonly pitchTrimDeg: number;
      /** The aligner's own quality verdict, gates and diagnostics included. */
      /**
       * The chosen window's own result. Its `headingOffsetDeg` is relative to
       * that window's centre — `headingTrimDeg` above is the total; the
       * `correctedCamera` is already the fully corrected pose.
       */
      readonly alignment: SkylineAlignmentSolution;
      readonly skyline: Skyline;
      readonly compassBudgetDeg: number;
      /**
       * Other interior optima found in the budget, as total heading trims,
       * nearest-first. Usually empty; more than one means the terrain shape
       * genuinely supports several compass-consistent headings and the user
       * should treat the suggestion as one of them, not the answer.
       */
      readonly otherCandidateHeadingsDeg: readonly number[];
    }
  | {
      readonly status: 'declined';
      readonly reason: PoseTrimDeclineReason;
      readonly detail: string;
      /** Present unless the decline happened before the photograph was read. */
      readonly skyline?: Skyline;
    };

/**
 * The searched bearing span: the frame plus the compass budget on both sides —
 * every bearing whose terrain the clamped search can bring into the frame.
 */
function searchedSpan(camera: CameraPose, budgetDeg: number): { fromDeg: number; toDeg: number } {
  const half = camera.hFovDeg / 2 + budgetDeg;
  return { fromDeg: camera.headingDeg - half, toDeg: camera.headingDeg + half };
}

/** Absolute angular separation of two bearings, wrap-safe, 0–180. */
function bearingSeparationDeg(aDeg: number, bDeg: number): number {
  return Math.abs(((aDeg - bDeg + 540) % 360) - 180);
}

/**
 * Extract, align within the compass budget, and decide whether the result is a
 * trim worth pre-setting the sliders with (P7.4). Pure and synchronous.
 *
 * A `'suggested'` result is exactly that — decision D9 stands: the caller
 * PRE-SETS the visible trim controls and says so; it never applies a hidden
 * correction. A `'declined'` result leaves the sliders where they are, with a
 * reason fit to show.
 */
export function suggestPoseTrim(request: PoseTrimRequest): PoseTrimSuggestion {
  const compassBudgetDeg = request.compassBudgetDeg ?? DEFAULT_COMPASS_BUDGET_DEG;
  if (!(compassBudgetDeg > 0)) {
    throw new RangeError(`compassBudgetDeg must be > 0, received ${compassBudgetDeg}`);
  }
  const nearFieldRadiusM = request.nearFieldRadiusM ?? DEFAULT_NEAR_FIELD_RADIUS_M;

  // Precondition first, before any pixel is read: a profile whose skyline
  // rests on near-field ground anywhere the search can look would hand the
  // aligner the phantom wall as shape to match (CV-9, CV-10).
  const span = searchedSpan(request.scene.camera, compassBudgetDeg);
  const centre = (span.fromDeg + span.toDeg) / 2;
  const halfSpan = (span.toDeg - span.fromDeg) / 2;
  const nearFieldPoints = request.scene.horizon.filter(
    (point) =>
      bearingSeparationDeg(point.bearingDeg, centre) <= halfSpan &&
      point.distanceKm * 1000 < nearFieldRadiusM,
  );
  if (nearFieldPoints.length > 0) {
    return {
      status: 'declined',
      reason: 'near-field-in-profile',
      detail:
        `${nearFieldPoints.length} profile point(s) in the searched span rest on terrain ` +
        `within ${nearFieldRadiusM} m of the camera — unresolvable ground the aligner must ` +
        'not match against (docs/NEAR-FIELD.md). Sweep the alignment profile with ' +
        `minRangeM: ${nearFieldRadiusM} and try again.`,
    };
  }

  // ── The comb search: interior optima, not the window maximum ──────────────
  // A single search over the whole budget inherits the rim problem in
  // miniature: on the measured frame the impostor's slope crosses the window,
  // the in-window maximum lands on the rim, and the aligner (correctly)
  // refuses — throwing away a genuine local optimum at +0.50° that the
  // landscape scan shows is the only interior one for 8° in either direction.
  // So the budget is swept with overlapping NARROW windows instead. Each
  // window that resolves a non-rim optimum contributes a candidate; a window
  // crossed by a slope refuses at its own rim and contributes nothing. What
  // survives is the set of local optima of the same gated machinery — and the
  // compass, which is a measurement, picks the NEAREST one. A monotone slope
  // toward a match outside the budget produces no candidates at all, which is
  // the CV-10 refusal, reached the honest way.
  const skyline = extractSkyline(request.image, request.skyline);
  const candidates: { totalHeadingDeg: number; alignment: SkylineAlignmentSolution }[] = [];
  // A window that fails for a reason OTHER than its own rim — fog, a flat
  // profile, a lost skyline — is diagnosing the INPUT, not the search. Kept so
  // an unreadable photograph is declined for what it is, instead of being
  // blamed on the terrain shape.
  let nonRimFailure: SkylineAlignmentFailure | undefined;
  for (
    let centreDeg = -compassBudgetDeg;
    centreDeg <= compassBudgetDeg + 1e-9;
    centreDeg += COMB_STEP_DEG
  ) {
    const posed: CameraPose = {
      ...request.scene.camera,
      headingDeg: request.scene.camera.headingDeg + centreDeg,
    };
    const alignment = alignSkyline(skyline, posed, request.scene.horizon, {
      ...request.align,
      headingRangeDeg: COMB_HALF_WIDTH_DEG,
      headingStepDeg: 0.1,
    });
    if (alignment.status === 'failed') {
      if (alignment.reason !== 'search-range-exhausted') {
        nonRimFailure ??= alignment;
      }
      continue;
    }
    const totalHeadingDeg = centreDeg + alignment.headingOffsetDeg;
    if (Math.abs(totalHeadingDeg) > compassBudgetDeg + 1e-9) continue;
    // Overlapping windows find the same optimum twice: keep the better-scored.
    const near = candidates.find(
      (candidate) => Math.abs(candidate.totalHeadingDeg - totalHeadingDeg) < COMB_STEP_DEG / 2,
    );
    if (near === undefined) {
      candidates.push({ totalHeadingDeg, alignment });
    } else if (alignment.diagnostics.score > near.alignment.diagnostics.score) {
      near.totalHeadingDeg = totalHeadingDeg;
      near.alignment = alignment;
    }
  }

  if (candidates.length === 0) {
    return {
      status: 'declined',
      reason: 'no-alignment',
      detail:
        nonRimFailure !== undefined
          ? `${nonRimFailure.reason}: ${nonRimFailure.detail}`
          : `no interior correlation optimum within the ±${compassBudgetDeg}° compass budget — ` +
            'every window ran to its rim, i.e. the terrain shape rises toward a match outside ' +
            'the budget, which CV-10 forbids trusting. The manual controls are the honest option.',
      skyline,
    };
  }

  candidates.sort((a, b) => Math.abs(a.totalHeadingDeg) - Math.abs(b.totalHeadingDeg));
  const chosen = candidates[0];
  if (chosen === undefined) throw new Error('unreachable: candidates is non-empty');

  return {
    status: 'suggested',
    headingTrimDeg: chosen.totalHeadingDeg,
    pitchTrimDeg: chosen.alignment.pitchOffsetDeg,
    alignment: chosen.alignment,
    skyline,
    compassBudgetDeg,
    otherCandidateHeadingsDeg: candidates.slice(1).map((c) => c.totalHeadingDeg),
  };
}
