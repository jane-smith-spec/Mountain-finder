/**
 * The geometry that makes the search cheap and exact: turning image columns
 * into world rays, and turning a (heading, pitch) error into a single rotation
 * applied to those rays.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A ROTATION AND NOT A PIXEL SHIFT
 * ═══════════════════════════════════════════════════════════════════════════
 * The obvious implementation of "cross-correlate over heading" slides the
 * computed skyline sideways across the photograph a pixel at a time. That is
 * *wrong* for a real lens and wrong by a lot. A rectilinear camera is linear in
 * the tangent of the off-axis angle, not in the angle (see
 * `src/core/projection.ts`), so rotating the camera by Δ does not translate the
 * image — it warps it. On the 65.5° frame this repository's Gornergrat fixture
 * describes, a 10° heading error moves the frame centre by 0.305 of the width
 * but the frame edge by 0.416: a 3.7° discrepancy at the edge, seven times the
 * 0.5° the self-check demands. A pixel-shift correlator would therefore be
 * *systematically* biased by an amount that grows with the error it is trying
 * to measure.
 *
 * So the correspondence is done in world angles instead, where the relationship
 * is exact and, as it happens, simpler.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE EXACT RESULT THIS MODULE RESTS ON
 * ═══════════════════════════════════════════════════════════════════════════
 * Write `A(h, p)` for the camera axis triple that `cameraAxes` builds at
 * heading `h` and pitch `p` (roll fixed). Then
 *
 *     A(h₀ + Δh, p₀ + Δp) = R_up(Δh) · R_r(Δp) · A(h₀, p₀)
 *
 * where `R_up(Δh)` rotates about the world vertical and `R_r(Δp)` rotates about
 * `r = levelRight(h₀)`, the horizontal axis across the frame at the *nominal*
 * heading. Proof, in three lines:
 *
 *   • Pitch. `levelRight` does not depend on pitch, so `R_r` fixes it; a pitch
 *     change rotates `forward` about exactly that axis by construction; and
 *     `levelUp = levelRight × forward` follows because a proper rotation
 *     commutes with the cross product. Roll then mixes `levelRight` and
 *     `levelUp` with coefficients that do not depend on pitch, so it survives.
 *   • Heading. `R_up` maps `forward(h, p) ↦ forward(h + Δh, p)` and
 *     `levelRight(h) ↦ levelRight(h + Δh)`, and again the cross product and the
 *     roll mix come along.
 *   • Therefore any camera-frame ray `c` obeys `A(h₀+Δh, p₀+Δp)·c =
 *     R_up(Δh)·R_r(Δp)·A(h₀, p₀)·c`, i.e. **the same rotation moves every
 *     pixel's world direction, independently of the pixel.**
 *
 * Two consequences drive the whole aligner:
 *
 *   1. At Δp = 0 the rotation is about the vertical, which shifts every ray's
 *      **bearing by exactly Δh and leaves its altitude exactly alone.** So in
 *      (bearing, altitude) space a heading error is a rigid translation along
 *      the bearing axis — a true 1-D cross-correlation with no approximation
 *      anywhere, and no trigonometry inside the search loop.
 *   2. A pitch error is *not* a rigid translation in altitude: rotating about a
 *      horizontal axis moves a ray at off-axis bearing β by about Δp·cos β, so
 *      it shrinks toward the frame edges (16 % at ±33°). It is very nearly a
 *      constant offset near the axis, which is why the heading stage can be
 *      made blind to it (correlate the *shape*, not the height) and why the
 *      pitch is then solved separately and refined jointly. See `align.ts`.
 */

import { normaliseBearingDeg, toDegrees, toRadians } from '../core/geodesy.js';
import { cameraAxes, type Vec3 } from '../core/projection.js';
import type { CameraPose, HorizonProfile } from '../core/types.js';

/** A world direction in East-North-Up, expressed the way the profile is indexed. */
export interface SkyDirection {
  readonly bearingDeg: number;
  readonly altitudeDeg: number;
}

/**
 * Inverse of `projectToImage`: the world direction a normalised image point
 * looks along.
 *
 * The camera-frame ray of a pixel is `(cx, cy, 1)` with
 * `cx = (x − ½)·2·tan(hFOV/2)` and `cy = (½ − y)·2·tan(vFOV/2)`; mapping it
 * through the axis triple and normalising gives the world direction. Round-trip
 * exactness against `projectToImage` is asserted in `rays.test.ts` — these two
 * functions must never drift apart, since the aligner's answer is expressed in
 * the pose that the renderer then projects with.
 */
export function unprojectFromImage(pose: CameraPose, xNorm: number, yNorm: number): Vec3 {
  const axes = cameraAxes(pose);
  const across = (xNorm - 0.5) * 2 * Math.tan(toRadians(pose.hFovDeg) / 2);
  const upward = (0.5 - yNorm) * 2 * Math.tan(toRadians(pose.vFovDeg) / 2);

  const e = across * axes.right.e + upward * axes.up.e + axes.forward.e;
  const n = across * axes.right.n + upward * axes.up.n + axes.forward.n;
  const u = across * axes.right.u + upward * axes.up.u + axes.forward.u;
  const length = Math.hypot(e, n, u);
  if (length === 0) throw new RangeError('degenerate camera ray');
  return { e: e / length, n: n / length, u: u / length };
}

/** A unit ENU vector as a compass bearing and a vertical angle. */
export function directionToSky(direction: Vec3): SkyDirection {
  return {
    bearingDeg: normaliseBearingDeg(toDegrees(Math.atan2(direction.e, direction.n))),
    altitudeDeg: toDegrees(Math.asin(Math.max(-1, Math.min(1, direction.u)))),
  };
}

/**
 * Rotate about the world vertical by `deltaDeg` in the compass sense, so that
 * a direction at bearing β comes out at bearing β + `deltaDeg`.
 */
export function rotateAboutVertical(direction: Vec3, deltaDeg: number): Vec3 {
  const angle = toRadians(deltaDeg);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    e: direction.e * cos + direction.n * sin,
    n: direction.n * cos - direction.e * sin,
    u: direction.u,
  };
}

/**
 * The horizontal axis across the frame at heading `headingDeg`: the axis a
 * pitch change rotates about. This is `levelRight` from `cameraAxes`, repeated
 * here because the aligner needs it at the *nominal* heading, independently of
 * any pose object.
 */
export function levelRightAxis(headingDeg: number): Vec3 {
  const heading = toRadians(headingDeg);
  return { e: Math.cos(heading), n: -Math.sin(heading), u: 0 };
}

/** Rodrigues rotation of `direction` about the unit axis `axis` by `deltaDeg`. */
export function rotateAboutAxis(direction: Vec3, axis: Vec3, deltaDeg: number): Vec3 {
  const angle = toRadians(deltaDeg);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = axis.e * direction.e + axis.n * direction.n + axis.u * direction.u;
  const crossE = axis.n * direction.u - axis.u * direction.n;
  const crossN = axis.u * direction.e - axis.e * direction.u;
  const crossU = axis.e * direction.n - axis.n * direction.e;
  return {
    e: direction.e * cos + crossE * sin + axis.e * dot * (1 - cos),
    n: direction.n * cos + crossN * sin + axis.n * dot * (1 - cos),
    u: direction.u * cos + crossU * sin + axis.u * dot * (1 - cos),
  };
}

/**
 * Apply a pose error to a ray computed under the nominal pose: pitch first
 * (about the nominal frame's horizontal axis), then heading (about the
 * vertical). The order is the one the identity at the top of this file
 * requires; swapping it is wrong by O(Δh·Δp) and would show up as a
 * heading-dependent pitch bias.
 */
export function applyPoseOffset(
  direction: Vec3,
  nominalHeadingDeg: number,
  headingOffsetDeg: number,
  pitchOffsetDeg: number,
): Vec3 {
  const pitched =
    pitchOffsetDeg === 0
      ? direction
      : rotateAboutAxis(direction, levelRightAxis(nominalHeadingDeg), pitchOffsetDeg);
  return headingOffsetDeg === 0 ? pitched : rotateAboutVertical(pitched, headingOffsetDeg);
}

/**
 * The bearings a profile actually covers, and the gap it does not.
 *
 * `interpolateHorizonAltitudeDeg` treats a profile as a closed loop, so asking
 * it about a bearing inside a 300°-wide hole in a sector sweep gets a confident
 * straight-line answer bridging the hole. For a full 360° sweep that is right;
 * for the sector sweep a single-photo run uses (`SweepConfig.spanDeg`) it would
 * be terrain invented out of nothing, and the aligner would then correlate
 * against it. So the largest angular gap between consecutive samples is found
 * once, and any query bearing inside it is reported as uncovered rather than
 * interpolated.
 *
 * A gap is only treated as a hole when it is wider than
 * {@link GAP_MULTIPLE_OF_SPACING} times the median sample spacing — otherwise
 * an ordinary uniform sweep, whose largest gap equals its step, would exclude
 * its own last interval.
 */
export const GAP_MULTIPLE_OF_SPACING = 4;

export interface ProfileCoverage {
  /** Start of the uncovered arc, degrees; `undefined` when the profile is closed. */
  readonly gapFromDeg: number | undefined;
  /** End of the uncovered arc, degrees. */
  readonly gapToDeg: number | undefined;
  /** Total covered arc width in degrees (360 for a closed profile). */
  readonly coveredSpanDeg: number;
}

export function profileCoverage(profile: HorizonProfile): ProfileCoverage {
  if (profile.length < 2) {
    return { gapFromDeg: undefined, gapToDeg: undefined, coveredSpanDeg: 0 };
  }
  const bearings = profile.map((point) => point.bearingDeg);
  const gaps: number[] = [];
  for (let index = 0; index < bearings.length; index += 1) {
    const from = bearings[index] ?? 0;
    const to = bearings[(index + 1) % bearings.length] ?? 0;
    gaps.push(index === bearings.length - 1 ? to + 360 - from : to - from);
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const medianGap = sorted[sorted.length >> 1] ?? 0;
  let largestIndex = 0;
  for (let index = 1; index < gaps.length; index += 1) {
    if ((gaps[index] ?? 0) > (gaps[largestIndex] ?? 0)) largestIndex = index;
  }
  const largest = gaps[largestIndex] ?? 0;

  if (medianGap <= 0 || largest <= medianGap * GAP_MULTIPLE_OF_SPACING) {
    return { gapFromDeg: undefined, gapToDeg: undefined, coveredSpanDeg: 360 };
  }
  const gapFromDeg = bearings[largestIndex] ?? 0;
  const gapToDeg = normaliseBearingDeg(gapFromDeg + largest);
  return { gapFromDeg, gapToDeg, coveredSpanDeg: 360 - largest };
}

/** Is `bearingDeg` inside the profile's covered arc? */
export function coversBearing(coverage: ProfileCoverage, bearingDeg: number): boolean {
  const { gapFromDeg, gapToDeg } = coverage;
  if (gapFromDeg === undefined || gapToDeg === undefined) return true;
  const offset = normaliseBearingDeg(bearingDeg - gapFromDeg);
  const gapWidth = normaliseBearingDeg(gapToDeg - gapFromDeg);
  return !(offset > 0 && offset < gapWidth);
}
