/**
 * Manual fine-alignment ("trim") — pure angle arithmetic, no React, no DOM.
 *
 * Decision D3 defers automatic skyline alignment to v2.1, so the base product
 * ships three sliders instead. A trim is an *offset applied to the resolved
 * pose*, never a replacement for it: the panel keeps showing where the heading
 * came from (EXIF / you / assumed) and the slider says how far you nudged it.
 * That separation is what lets the app report "EXIF said 137.25°, you nudged
 * +1.5°" rather than quietly rewriting the photo's metadata.
 *
 * Judgment calls recorded here rather than in a commit message:
 *
 *  - All three trims are ADDITIVE DEGREES, including the field of view. A
 *    multiplicative zoom factor is arguably more natural for a lens, but an
 *    additive degree offset is the one a test can assert exactly, and the
 *    slider is a nudge (±20°), not a zoom control.
 *  - The vertical field of view is recomputed from the trimmed horizontal one
 *    through the tangent relation, preserving the pose's own aspect ratio
 *    `tan(vFov/2) / tan(hFov/2)`. Using the ratio rather than the pixel
 *    dimensions means a user-typed vFov that disagrees with the image aspect is
 *    respected instead of silently overwritten, and the function needs no
 *    knowledge of the image. Where the pose's vFov *was* derived from the pixel
 *    dimensions, the two are identical by construction.
 */

import type { CameraPose } from '../core/types';
import { normaliseBearingDeg, vFovDegFromHFov } from '../exif';

/** Slider offsets, in degrees, all zero when untouched. */
export interface TrimState {
  headingDeg: number;
  pitchDeg: number;
  hFovDeg: number;
}

export const NO_TRIM: TrimState = { headingDeg: 0, pitchDeg: 0, hFovDeg: 0 };

/** Symmetric slider range, i.e. the slider runs from −limit to +limit. */
export const TRIM_LIMIT_DEG: Readonly<Record<keyof TrimState, number>> = {
  headingDeg: 30,
  pitchDeg: 20,
  hFovDeg: 20,
};

/**
 * Slider granularity. One arrow-key press moves the trim by exactly this much,
 * which is the keyboard path the e2e test drives.
 */
export const TRIM_STEP_DEG = 0.25;

/** A camera cannot see through itself or all the way round; keep hFov sane. */
export const MIN_HFOV_DEG = 1;
export const MAX_HFOV_DEG = 175;
const MAX_PITCH_DEG = 90;

const RAD_PER_DEG = Math.PI / 180;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The aspect ratio implied by a pose: `tan(vFov/2) / tan(hFov/2)`, i.e.
 * heightPx / widthPx for a rectilinear lens. Returns undefined when the pose's
 * angles are outside the range where that relation is defined.
 */
export function aspectRatioOfPose(pose: CameraPose): number | undefined {
  if (!Number.isFinite(pose.hFovDeg) || pose.hFovDeg <= 0 || pose.hFovDeg >= 180) return undefined;
  if (!Number.isFinite(pose.vFovDeg) || pose.vFovDeg <= 0 || pose.vFovDeg >= 180) return undefined;
  const halfWidthTan = Math.tan((pose.hFovDeg * RAD_PER_DEG) / 2);
  if (halfWidthTan <= 0) return undefined;
  return Math.tan((pose.vFovDeg * RAD_PER_DEG) / 2) / halfWidthTan;
}

/**
 * Apply the slider offsets to a resolved pose.
 *
 * Heading wraps into [0, 360); pitch is clamped to ±90°; the horizontal field
 * of view is clamped into (0, 180) before the vertical one is re-derived from
 * it. Roll is untouched — there is deliberately no roll slider, because roll
 * comes from how the camera was held rather than from alignment error, and a
 * fourth knob makes the other three harder to use.
 */
export function applyTrim(pose: CameraPose, trim: TrimState): CameraPose {
  const hFovDeg = clamp(pose.hFovDeg + trim.hFovDeg, MIN_HFOV_DEG, MAX_HFOV_DEG);
  const aspect = aspectRatioOfPose(pose);
  return {
    headingDeg: normaliseBearingDeg(pose.headingDeg + trim.headingDeg),
    pitchDeg: clamp(pose.pitchDeg + trim.pitchDeg, -MAX_PITCH_DEG, MAX_PITCH_DEG),
    rollDeg: pose.rollDeg,
    hFovDeg,
    // vFovDegFromHFov only uses the ratio of its two pixel arguments, so
    // (1, aspect) asks it exactly the question we mean.
    vFovDeg: aspect === undefined ? pose.vFovDeg : vFovDegFromHFov(hFovDeg, 1, aspect),
  };
}

/** True when nothing has been nudged — used to enable/disable the reset button. */
export function isUntrimmed(trim: TrimState): boolean {
  return trim.headingDeg === 0 && trim.pitchDeg === 0 && trim.hFovDeg === 0;
}
