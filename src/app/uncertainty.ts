/**
 * How wrong the labels might be, and how to say so — P5.3.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DECISION THIS IMPLEMENTS (D9)
 * ═══════════════════════════════════════════════════════════════════════════
 * The user's call, 2026-08-17, after trying and failing to name summits in a
 * photograph they had taken themselves:
 *
 *   "I'm barely able to distinguish peaks, not much use to name them for the
 *    user other than 'generally peak xyz are that way'. We tell the app user
 *    our % of error likelihood, and put our peaks overlay on screen for them
 *    to scoot right or left as they wish to align."
 *
 * That is a change to what the product CLAIMS, and it is the right one. A flag
 * planted on a specific bump asserts an identification the pose cannot support;
 * a labelled overlay the user slides asserts a direction, which it can. The
 * measurements back the user up — see docs/REAL-PHOTO-POSE.md: on the one
 * photograph where the pose has been solved independently, the phone's compass
 * was 0.6° out and the unrecorded camera pitch was 3.5° out.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE SUBSTITUTION, MADE DELIBERATELY AND FLAGGED
 * ═══════════════════════════════════════════════════════════════════════════
 * A "% error likelihood" in the sense of *confidence that a label is on the
 * right peak* would be invented. Nothing here supports it: this repository has
 * n = 1 for heading error and n = 1 for pitch, from a single photograph, which
 * is not a distribution and cannot become one by being formatted as a
 * percentage. Publishing 87 % would be the exact failure this project keeps
 * designing against, dressed up as a UX improvement.
 *
 * What IS a percentage, exactly and without inventing anything, is **how much
 * of the frame the uncertainty spans**. An angular band and a field of view
 * give it by arithmetic:
 *
 *     fraction = tan(band) / tan(hFov / 2)      (half-frame = 100 %)
 *
 * "The labels could be a fifth of the screen out" is the sentence a person can
 * act on, it is derived rather than asserted, and it says the same thing the
 * request was reaching for. It is what this module reports.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHERE THE ANGULAR BANDS COME FROM — AND WHERE THEY DO NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * Every term is one of two things, never a blend:
 *
 *   MEASURED       a figure this repository actually measured, with the sample
 *                  size attached. Today every one of them is n = 1.
 *   UNQUANTIFIED   no figure. Reported as unknown, never defaulted to a
 *                  plausible-looking number, and its presence makes the total a
 *                  FLOOR rather than a bound — which the summary says out loud.
 *
 * The pixels-per-degree scale is the one number here that is exact and carries
 * no assumption at all, because it is pure projection arithmetic. It is what
 * tells the user what dragging by a finger-width actually does.
 */

import type { CameraPose } from '../core/types';
import type { FieldSource, PoseField, ResolvedField } from '../exif';

const RAD_PER_DEG = Math.PI / 180;

/** Where a term's figure comes from, or the fact that there is none. */
export type UncertaintyBasis =
  | {
      readonly kind: 'measured';
      readonly deg: number;
      /** How many independent observations produced it. Today always 1. */
      readonly sampleCount: number;
      readonly note: string;
    }
  | { readonly kind: 'unquantified'; readonly note: string };

export interface UncertaintyTerm {
  /** Which way the error moves the labels. */
  readonly axis: 'horizontal' | 'vertical';
  /** Short label for the UI, e.g. "Compass heading". */
  readonly label: string;
  readonly basis: UncertaintyBasis;
}

export interface PoseUncertainty {
  readonly terms: readonly UncertaintyTerm[];
  /** Sum of the MEASURED terms per axis, degrees. A floor, not a bound. */
  readonly measuredDeg: { readonly horizontal: number; readonly vertical: number };
  /** Whether any term has no figure, making the totals a floor. */
  readonly hasUnquantified: boolean;
  /**
   * The measured band as a fraction of the half-frame, so 1 means "the labels
   * could be off by half the picture". This is the honest form of the
   * percentage — see the header.
   */
  readonly frameFraction: { readonly horizontal: number; readonly vertical: number };
  /** Exact projection scale at the frame centre. No assumptions in these. */
  readonly pixelsPerDegree: { readonly horizontal: number; readonly vertical: number };
  /** One sentence for the banner, in the product's own voice. */
  readonly summary: string;
}

/**
 * The one heading comparison this repository has actually made.
 *
 * Railroad Ridge, 2026-08-17: the pose was solved from the photograph itself
 * (Castle Peak's summit read off the full-resolution image) at 174.686°, and
 * the phone's `GPSImgDirection` said 174.089°. Recorded here as a named
 * constant so nobody can mistake it for a specification, and so that the day a
 * second measurement exists this becomes an average of two rather than a
 * number of unclear origin. docs/REAL-PHOTO-POSE.md § correction 2.
 */
export const MEASURED_COMPASS_ERROR_DEG = 0.596;

/**
 * The one pitch measurement, same photograph: the camera was 3.520° below
 * level while every run assumed zero. EXIF has no pitch tag at all, so this is
 * not a sensor error — it is the cost of an assumption the format forces.
 */
export const MEASURED_ASSUMED_PITCH_ERROR_DEG = 3.52;

function sourceOf(field: ResolvedField | undefined): FieldSource | 'missing' {
  if (field === undefined || field.status !== 'resolved') return 'missing';
  return field.source;
}

/** Exact pixels per degree at the frame centre, from the tangent projection. */
export function pixelsPerDegreeAtCentre(fovDeg: number, sizePx: number): number {
  if (!(fovDeg > 0) || !(sizePx > 0)) return 0;
  // d(px)/d(theta) at theta = 0, where px = (size/2) * tan(theta)/tan(fov/2).
  return ((sizePx / 2) * RAD_PER_DEG) / Math.tan((fovDeg / 2) * RAD_PER_DEG);
}

/**
 * What fraction of the HALF-frame an angular band covers.
 *
 * Uses the same tangent projection the overlay does, so the number means the
 * same thing as the picture. A band at or beyond the frame edge saturates at 1
 * rather than running away: "more than the whole picture" is one statement, and
 * distinguishing 340 % from 800 % helps nobody.
 */
export function frameFractionOf(bandDeg: number, fovDeg: number): number {
  if (!(fovDeg > 0) || bandDeg <= 0) return 0;
  if (bandDeg >= fovDeg / 2) return 1;
  return Math.min(1, Math.tan(bandDeg * RAD_PER_DEG) / Math.tan((fovDeg / 2) * RAD_PER_DEG));
}

function headingTerm(source: FieldSource | 'missing'): UncertaintyTerm {
  if (source === 'exif') {
    return {
      axis: 'horizontal',
      label: 'Compass heading',
      basis: {
        kind: 'measured',
        deg: MEASURED_COMPASS_ERROR_DEG,
        sampleCount: 1,
        note:
          'Your phone recorded which way it was pointing. On the one photograph ' +
          'this app has checked against the terrain, that reading was 0.6° out. ' +
          'That is a single comparison, not a specification — phone compasses are ' +
          'routinely several degrees off, and no manufacturer publishes a figure.',
      },
    };
  }
  if (source === 'user') {
    return {
      axis: 'horizontal',
      label: 'Heading you typed',
      basis: {
        kind: 'unquantified',
        note:
          'You supplied the heading, so the app has nothing to check it against ' +
          'and states no error for it. Drag to correct it if the labels sit wrong.',
      },
    };
  }
  return {
    axis: 'horizontal',
    label: 'Heading',
    basis: { kind: 'unquantified', note: 'No heading is resolved, so no overlay can be placed.' },
  };
}

function pitchTerm(source: FieldSource | 'missing'): UncertaintyTerm {
  if (source === 'user') {
    return {
      axis: 'vertical',
      label: 'Tilt you set',
      basis: {
        kind: 'unquantified',
        note: 'You supplied the tilt; the app states no error for a number it did not derive.',
      },
    };
  }
  // 'default' — and it is always the default, because no photograph records
  // pitch. This is the largest single term and the one users feel: it moves
  // every label up or down together.
  return {
    axis: 'vertical',
    label: 'Camera tilt (not recorded)',
    basis: {
      kind: 'measured',
      deg: MEASURED_ASSUMED_PITCH_ERROR_DEG,
      sampleCount: 1,
      note:
        'No photograph records how far up or down the camera was pointing, so the ' +
        'app assumes level. On the one photograph checked, the camera was 3.5° ' +
        'below level — which is normal for a hand-held shot with foreground in it. ' +
        'This moves every label vertically by the same amount.',
    },
  };
}

/**
 * Assemble the uncertainty statement for a pose.
 *
 * `fields` is `PoseResolution.fields` — the provenance of each value, which is
 * what decides whether a term is measurable at all. The pose supplies the field
 * of view, which is what turns degrees into a fraction of the picture.
 */
export function poseUncertainty(
  fields: Partial<Record<PoseField, ResolvedField>>,
  pose: CameraPose,
  imageWidthPx: number,
  imageHeightPx: number,
): PoseUncertainty {
  const terms: UncertaintyTerm[] = [
    headingTerm(sourceOf(fields.headingDeg)),
    pitchTerm(sourceOf(fields.pitchDeg)),
  ];

  const sumFor = (axis: 'horizontal' | 'vertical'): number =>
    terms
      .filter((term) => term.axis === axis && term.basis.kind === 'measured')
      .reduce((total, term) => total + (term.basis.kind === 'measured' ? term.basis.deg : 0), 0);

  const measuredDeg = { horizontal: sumFor('horizontal'), vertical: sumFor('vertical') };
  const hasUnquantified = terms.some((term) => term.basis.kind === 'unquantified');

  const frameFraction = {
    horizontal: frameFractionOf(measuredDeg.horizontal, pose.hFovDeg),
    vertical: frameFractionOf(measuredDeg.vertical, pose.vFovDeg),
  };
  const pixelsPerDegree = {
    horizontal: pixelsPerDegreeAtCentre(pose.hFovDeg, imageWidthPx),
    vertical: pixelsPerDegreeAtCentre(pose.vFovDeg, imageHeightPx),
  };

  return {
    terms,
    measuredDeg,
    hasUnquantified,
    frameFraction,
    pixelsPerDegree,
    summary: summarise(measuredDeg, frameFraction, hasUnquantified),
  };
}

/**
 * The banner sentence.
 *
 * Written to say what the labels ARE — a direction — rather than to apologise
 * for what they are not. Percentages are rounded to whole numbers because the
 * inputs are single measurements and a decimal place would imply a precision
 * that is not there.
 */
export function summarise(
  measuredDeg: PoseUncertainty['measuredDeg'],
  frameFraction: PoseUncertainty['frameFraction'],
  hasUnquantified: boolean,
): string {
  const across = Math.round(frameFraction.horizontal * 100);
  const down = Math.round(frameFraction.vertical * 100);
  const worst = Math.max(across, down);

  if (worst === 0 && !hasUnquantified) {
    return 'Labels are placed from a pose with no measured error. Drag to fine-tune.';
  }

  const scale =
    worst >= 100
      ? 'by more than the whole picture'
      : worst >= 25
        ? `by roughly ${worst}% of the way to the edge of the picture`
        : `by around ${worst}% of the way to the edge of the picture`;

  const floor = hasUnquantified
    ? ' Some of the error has no measured figure at all, so treat this as a minimum.'
    : '';

  return (
    `These labels say which way a summit lies, not exactly which bump it is. ` +
    `They could be out ${scale} — about ${measuredDeg.horizontal.toFixed(1)}° across ` +
    `and ${measuredDeg.vertical.toFixed(1)}° up or down.${floor} ` +
    `Drag the overlay to line it up with what you can see.`
  );
}

/**
 * Convert a drag in pixels into trim offsets in degrees.
 *
 * The inverse of the projection, not a linear approximation: dragging near the
 * edge of a wide frame covers fewer degrees per pixel than dragging through the
 * middle, and a linear mapping would make the overlay slide out from under the
 * cursor. `fromPx` is where the drag started, so the arc actually traversed is
 * the one between the two rays.
 *
 * Sign convention — one rule, applied twice: THE OVERLAY FOLLOWS THE CURSOR.
 * The two axes come out with opposite signs from it, which looks like a bug
 * until it is written down:
 *
 *   RIGHT  a label's x grows as the heading FALLS (turning the camera right
 *          sweeps the world left through the frame), so heading trim is
 *          NEGATIVE for a rightward drag.
 *   DOWN   a label's y grows as the pitch RISES (tilting the camera up pushes
 *          the world down through the frame), so pitch trim is POSITIVE for a
 *          downward drag.
 *
 * The asymmetry is real and both directions are asserted, because getting
 * either backwards feels broken instantly and is invisible to any test that
 * only checks magnitude. (The first version of the test asserted a negative
 * pitch here and was simply wrong about the geometry; the code was right.)
 */
export function dragToTrimDeg(
  fromPx: { readonly xPx: number; readonly yPx: number },
  toPx: { readonly xPx: number; readonly yPx: number },
  pose: CameraPose,
  imageWidthPx: number,
  imageHeightPx: number,
): { readonly headingDeg: number; readonly pitchDeg: number } {
  const angleAt = (px: number, sizePx: number, fovDeg: number): number => {
    if (!(sizePx > 0) || !(fovDeg > 0)) return 0;
    const offset = (px - sizePx / 2) / (sizePx / 2);
    return Math.atan(offset * Math.tan((fovDeg / 2) * RAD_PER_DEG)) / RAD_PER_DEG;
  };

  // Angles swept by the drag. `angleAt` grows rightward on x and DOWNWARD on
  // y, because that is the direction screen coordinates grow.
  const sweptRight =
    angleAt(toPx.xPx, imageWidthPx, pose.hFovDeg) - angleAt(fromPx.xPx, imageWidthPx, pose.hFovDeg);
  const sweptDown =
    angleAt(toPx.yPx, imageHeightPx, pose.vFovDeg) -
    angleAt(fromPx.yPx, imageHeightPx, pose.vFovDeg);

  // `+ 0` normalises -0 to 0. A negative zero is harmless arithmetically and
  // surprising in a state object a test or a UI compares with `Object.is`.
  return { headingDeg: -sweptRight + 0, pitchDeg: sweptDown + 0 };
}
