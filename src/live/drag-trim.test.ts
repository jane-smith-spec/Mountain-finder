/**
 * Drag geometry.
 *
 * Expectations come from the projection equation quoted in drag-trim.ts's
 * header, never from running it. Two anchors are chosen so the arithmetic can
 * be done in the head: with a 90° field of view, `2·tan(45°)` is exactly 2, so
 * a drag of half the frame gives `atan(0.5 · 2) = atan(1) = 45°` on the nose.
 *
 * The end-to-end tests are the ones that matter. They drag by a known number
 * of pixels and require a feature to land exactly that many pixels away
 * *through the real `projectToImage`* — which is both the specification of
 * what a drag means and the assertion no sign error can survive. They also
 * caught the first version of this module, which used `fov/px` and lagged the
 * finger by 46 % on a portrait frame's 108° vertical field.
 */

import { describe, expect, it } from 'vitest';

import { NO_TRIM, TRIM_LIMIT_DEG, applyTrim } from '../app/trim';
import { cameraPoseFromFocalLength, projectToImage } from '../core/projection';
import { degPerPx, dragAngleDeg, trimFromDrag } from './drag-trim';

const FRAME = { widthPx: 400, heightPx: 800 };
/** 90° both ways makes `2·tan(fov/2)` exactly 2 — see the header. */
const SQUARE_FOV = { hFovDeg: 90, vFovDeg: 90 };

describe('dragAngleDeg', () => {
  it('is exact where the arithmetic can be checked by hand', () => {
    // Half the frame at 90° FOV: atan(0.5 · 2·tan45°) = atan(1) = 45°.
    expect(dragAngleDeg(200, 400, 90)).toBeCloseTo(45, 10);
    expect(dragAngleDeg(-200, 400, 90)).toBeCloseTo(-45, 10);
    // A quarter frame: atan(0.25 · 2) = atan(0.5).
    expect(dragAngleDeg(100, 400, 90)).toBeCloseTo((Math.atan(0.5) * 180) / Math.PI, 10);
    expect(dragAngleDeg(0, 400, 90)).toBe(0);
  });

  it('is NOT the naive fov/px, and diverges most where phones actually live', () => {
    // A portrait frame's vertical field is around 108°. Over a tenth of the
    // frame the naive scale is already several per cent out, and the gap grows
    // with the drag — the bug this module was rewritten to fix.
    const naive = (80 / 800) * 108;
    const actual = dragAngleDeg(80, 800, 108);
    expect(actual).toBeGreaterThan(naive);
    expect(actual / naive).toBeGreaterThan(1.2);
  });

  it('refuses to divide by a frame that has not been laid out yet', () => {
    expect(dragAngleDeg(50, 0, 90)).toBe(0);
    expect(dragAngleDeg(50, 400, 0)).toBe(0);
  });
});

describe('degPerPx', () => {
  it('is the derivative of dragAngleDeg at zero', () => {
    const perPx = degPerPx(FRAME, SQUARE_FOV);
    // 2·tan(45°)/400 rad/px = 1/200 rad/px = 0.286479°/px.
    expect(perPx.x).toBeCloseTo(((1 / 200) * 180) / Math.PI, 10);
    expect(perPx.y).toBeCloseTo(((1 / 400) * 180) / Math.PI, 10);
    // A one-pixel drag must agree with the derivative to the cubic term and no
    // further: atan(x) = x − x³/3 + …, and at x = 1/200 that third-order term
    // is 2.4e-6 degrees. Asserting tighter would be asserting that atan is
    // linear, which is the very thing this module exists to deny.
    const oneDrag = dragAngleDeg(1, FRAME.widthPx, SQUARE_FOV.hFovDeg);
    expect(oneDrag).toBeCloseTo(perPx.x, 5);
    expect(Math.abs(oneDrag - perPx.x)).toBeLessThan(1e-5);
  });

  it('is zero rather than Infinity for a frame with no extent', () => {
    expect(degPerPx({ widthPx: 0, heightPx: 0 }, SQUARE_FOV)).toEqual({ x: 0, y: 0 });
  });
});

describe('trimFromDrag', () => {
  it('moves the overlay the way the finger moved', () => {
    // Drags chosen to stay inside the slider limits (±30° heading, ±20°
    // pitch), so these assert the geometry and not the clamp — which the next
    // test covers on its own. A quarter of the frame at 90°: atan(0.25·2).
    const quarterDeg = (Math.atan(0.5) * 180) / Math.PI;

    const right = trimFromDrag(NO_TRIM, { dx: 100, dy: 0 }, FRAME, SQUARE_FOV);
    expect(right.headingDeg).toBeCloseTo(-quarterDeg, 10);
    expect(right.pitchDeg).toBe(0);

    const left = trimFromDrag(NO_TRIM, { dx: -100, dy: 0 }, FRAME, SQUARE_FOV);
    expect(left.headingDeg).toBeCloseTo(quarterDeg, 10);

    // An eighth of the 800 px frame: atan(0.125·2) = atan(0.25).
    const eighthDeg = (Math.atan(0.25) * 180) / Math.PI;
    const down = trimFromDrag(NO_TRIM, { dx: 0, dy: 100 }, FRAME, SQUARE_FOV);
    expect(down.pitchDeg).toBeCloseTo(eighthDeg, 10);
    expect(down.headingDeg).toBe(0);

    const up = trimFromDrag(NO_TRIM, { dx: 0, dy: -100 }, FRAME, SQUARE_FOV);
    expect(up.pitchDeg).toBeCloseTo(-eighthDeg, 10);
  });

  it('stops at the same limits the sliders stop at', () => {
    const far = trimFromDrag(NO_TRIM, { dx: 4000, dy: 4000 }, FRAME, SQUARE_FOV);
    expect(far.headingDeg).toBe(-TRIM_LIMIT_DEG.headingDeg);
    expect(far.pitchDeg).toBe(TRIM_LIMIT_DEG.pitchDeg);

    const farOther = trimFromDrag(NO_TRIM, { dx: -4000, dy: -4000 }, FRAME, SQUARE_FOV);
    expect(farOther.headingDeg).toBe(TRIM_LIMIT_DEG.headingDeg);
    expect(farOther.pitchDeg).toBe(-TRIM_LIMIT_DEG.pitchDeg);
  });

  it('accumulates from the base trim', () => {
    const base = { headingDeg: -2, pitchDeg: 3, hFovDeg: 0 };
    const moved = trimFromDrag(base, { dx: 50, dy: 0 }, FRAME, SQUARE_FOV);
    // atan(50/400 · 2) = atan(0.25), added to the −2° already there.
    expect(moved.headingDeg).toBeCloseTo(-2 - (Math.atan(0.25) * 180) / Math.PI, 10);
    expect(moved.pitchDeg).toBe(3);
  });

  it('leaves the field of view alone — one finger is not a zoom', () => {
    const base = { headingDeg: 1, pitchDeg: 2, hFovDeg: 3 };
    expect(trimFromDrag(base, { dx: 50, dy: 50 }, FRAME, SQUARE_FOV).hFovDeg).toBe(3);
  });
});

describe('through the real projection', () => {
  const pose = cameraPoseFromFocalLength({
    headingDeg: 100,
    focalLength35mm: 26,
    imageWidthPx: FRAME.widthPx,
    imageHeightPx: FRAME.heightPx,
  });
  const fov = { hFovDeg: pose.hFovDeg, vFovDeg: pose.vFovDeg };

  it('puts the feature exactly where the finger put it, horizontally', () => {
    const before = projectToImage(pose, pose.headingDeg, 0);
    expect(before.x).toBeCloseTo(0.5, 10);

    for (const dxPx of [10, 40, 120, -75]) {
      const trimmed = applyTrim(pose, trimFromDrag(NO_TRIM, { dx: dxPx, dy: 0 }, FRAME, fov));
      const after = projectToImage(trimmed, pose.headingDeg, 0);
      const movedPx = (after.x - before.x) * FRAME.widthPx;
      // Exact, not approximate: the drag inverts the projection rather than
      // linearising it. A tolerance of 1e-9 px would pass; 1e-6 leaves room
      // for the trim's own degree round-tripping.
      expect(movedPx).toBeCloseTo(dxPx, 6);
    }
  });

  it('puts the feature exactly where the finger put it, vertically', () => {
    const before = projectToImage(pose, pose.headingDeg, 0);
    expect(before.y).toBeCloseTo(0.5, 10);

    // Kept inside the ±20° pitch limit, which on this frame is reached at
    // 105.1 px — past that the clamp is the answer, not the geometry.
    for (const dyPx of [10, 40, 90, -75]) {
      const trimmed = applyTrim(pose, trimFromDrag(NO_TRIM, { dx: 0, dy: dyPx }, FRAME, fov));
      const after = projectToImage(trimmed, pose.headingDeg, 0);
      const movedPx = (after.y - before.y) * FRAME.heightPx;
      expect(movedPx).toBeCloseTo(dyPx, 6);
    }
  });

  it('is what the naive scale would have got wrong', () => {
    // Same drag, scored under the fov/px rule the first version used. The
    // portrait frame's vertical field is ~108°, so the feature would have
    // followed the finger less than two thirds of the way.
    const dyPx = 120;
    const naiveTrim = { headingDeg: 0, pitchDeg: (dyPx / FRAME.heightPx) * fov.vFovDeg, hFovDeg: 0 };
    const before = projectToImage(pose, pose.headingDeg, 0);
    const after = projectToImage(applyTrim(pose, naiveTrim), pose.headingDeg, 0);
    const movedPx = (after.y - before.y) * FRAME.heightPx;
    expect(movedPx).toBeLessThan(dyPx * 0.75);
  });
});
