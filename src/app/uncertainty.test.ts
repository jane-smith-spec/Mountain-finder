/**
 * Uncertainty reporting and drag-to-align — unit tests.
 *
 * Expectations are computed by hand from the tangent projection, never taken
 * from a run. Where a number is a judgement (the wording thresholds), the test
 * asserts the PROPERTY that matters rather than the string.
 */

import { describe, expect, it } from 'vitest';

import type { CameraPose } from '../core/types';
import type { PoseField, ResolvedField } from '../exif';
import {
  dragToTrimDeg,
  frameFractionOf,
  MEASURED_ASSUMED_PITCH_ERROR_DEG,
  MEASURED_COMPASS_ERROR_DEG,
  pixelsPerDegreeAtCentre,
  poseUncertainty,
} from './uncertainty';

/** A 48 mm-equivalent 4:3 frame — the Railroad Ridge lens, exactly. */
const TELE: CameraPose = {
  headingDeg: 174.089,
  pitchDeg: 0,
  rollDeg: 0,
  hFovDeg: 41.11209043916693,
  vFovDeg: 31.417275658031485,
};

/** A 14 mm-equivalent ultrawide, where the same degrees are far fewer pixels. */
const ULTRAWIDE: CameraPose = {
  headingDeg: 203.611,
  pitchDeg: 0,
  rollDeg: 0,
  hFovDeg: 104.25,
  vFovDeg: 87.92,
};

const fromExif = (): ResolvedField => ({ status: 'resolved', value: 1, source: 'exif' });
const fromUser = (): ResolvedField => ({ status: 'resolved', value: 1, source: 'user' });
const assumed = (): ResolvedField => ({ status: 'resolved', value: 0, source: 'default' });

const fields = (
  heading: ResolvedField,
  pitch: ResolvedField,
): Partial<Record<PoseField, ResolvedField>> => ({ headingDeg: heading, pitchDeg: pitch });

describe('pixelsPerDegreeAtCentre', () => {
  it('is the derivative of the tangent projection, not the linear guess', () => {
    // px = (W/2)·tan(θ)/tan(hFov/2)  =>  dpx/dθ|₀ = (W/2)·(π/180)/tan(hFov/2).
    // For 4032 px at 41.11209°: 2016 × 0.0174532925 / tan(20.556045°)
    //                         = 35.1858… / 0.3750000… = 93.83 px/deg.
    const value = pixelsPerDegreeAtCentre(41.11209043916693, 4032);
    expect(value).toBeCloseTo(93.83, 1);

    // The naive W/hFov would give 4032/41.112 = 98.07 — noticeably different,
    // which is why the derivative is used rather than the average.
    expect(value).not.toBeCloseTo(4032 / 41.11209043916693, 1);
  });

  it('gives fewer pixels per degree on a wider lens, at the same frame size', () => {
    expect(pixelsPerDegreeAtCentre(104.25, 4032)).toBeLessThan(
      pixelsPerDegreeAtCentre(41.112, 4032),
    );
  });

  it('refuses nonsense rather than returning Infinity', () => {
    expect(pixelsPerDegreeAtCentre(0, 4032)).toBe(0);
    expect(pixelsPerDegreeAtCentre(41, 0)).toBe(0);
    expect(pixelsPerDegreeAtCentre(-10, 4032)).toBe(0);
  });
});

describe('frameFractionOf', () => {
  it('is tan(band)/tan(fov/2) — half the frame is 1', () => {
    // A band of exactly half the field of view reaches the frame edge. Written
    // as the division rather than as a decimal: the half angle needs more
    // significant digits than a JS number literal can carry, and rounding it
    // would make the test assert something a hair off the boundary it is about.
    expect(frameFractionOf(TELE.hFovDeg / 2, TELE.hFovDeg)).toBe(1);
    // 0.596° in a 41.112° frame: tan(0.596°)/tan(20.556°) = 0.010403/0.375 = 0.02774.
    expect(frameFractionOf(0.596, 41.11209043916693)).toBeCloseTo(0.02774, 4);
  });

  it('is BIGGER on a narrow lens for the same angular error', () => {
    // The point users feel: half a degree is nothing on an ultrawide and a
    // visible shift on a telephoto. A 4.30° frame is the 480 mm photograph.
    const tele = frameFractionOf(0.596, 4.3);
    const wide = frameFractionOf(0.596, 104.25);
    expect(tele).toBeGreaterThan(wide);
    expect(tele).toBeGreaterThan(0.27); // over a quarter of the way to the edge
    expect(wide).toBeLessThan(0.01);
  });

  it('saturates at 1 rather than reporting 800%', () => {
    expect(frameFractionOf(60, 20)).toBe(1);
  });

  it('is zero for a zero or negative band', () => {
    expect(frameFractionOf(0, 41)).toBe(0);
    expect(frameFractionOf(-3, 41)).toBe(0);
  });
});

describe('poseUncertainty', () => {
  it('reports the compass term as MEASURED with its sample size attached', () => {
    const result = poseUncertainty(fields(fromExif(), assumed()), TELE, 4032, 3024);
    const compass = result.terms.find((term) => term.axis === 'horizontal');
    expect(compass?.basis.kind).toBe('measured');
    if (compass?.basis.kind === 'measured') {
      expect(compass.basis.deg).toBe(MEASURED_COMPASS_ERROR_DEG);
      // n = 1 must travel with the number. A single comparison formatted as a
      // specification is the failure this module was written to avoid.
      expect(compass.basis.sampleCount).toBe(1);
      expect(compass.basis.note).toMatch(/single comparison|not a specification/i);
    }
  });

  it('always charges for camera tilt, because no photograph records it', () => {
    const result = poseUncertainty(fields(fromExif(), assumed()), TELE, 4032, 3024);
    expect(result.measuredDeg.vertical).toBe(MEASURED_ASSUMED_PITCH_ERROR_DEG);
    // And it is the bigger of the two — the thing users actually see.
    expect(result.measuredDeg.vertical).toBeGreaterThan(result.measuredDeg.horizontal);
  });

  it('states NO figure for a value the user typed, rather than a flattering one', () => {
    const result = poseUncertainty(fields(fromUser(), fromUser()), TELE, 4032, 3024);
    expect(result.terms.every((term) => term.basis.kind === 'unquantified')).toBe(true);
    expect(result.measuredDeg).toEqual({ horizontal: 0, vertical: 0 });
    expect(result.hasUnquantified).toBe(true);
    // …and the summary must not read as "no error".
    expect(result.summary).toMatch(/minimum/i);
  });

  it('marks the total a FLOOR whenever any term is unquantified', () => {
    const withUnknown = poseUncertainty(fields(fromUser(), assumed()), TELE, 4032, 3024);
    expect(withUnknown.hasUnquantified).toBe(true);
    expect(withUnknown.summary).toMatch(/minimum/i);

    const allMeasured = poseUncertainty(fields(fromExif(), assumed()), TELE, 4032, 3024);
    expect(allMeasured.hasUnquantified).toBe(false);
    expect(allMeasured.summary).not.toMatch(/minimum/i);
  });

  it('reports the SAME angles as a much larger share of a narrow frame', () => {
    const tele = poseUncertainty(fields(fromExif(), assumed()), TELE, 4032, 3024);
    const wide = poseUncertainty(fields(fromExif(), assumed()), ULTRAWIDE, 4032, 3024);
    expect(tele.measuredDeg).toEqual(wide.measuredDeg);
    expect(tele.frameFraction.horizontal).toBeGreaterThan(wide.frameFraction.horizontal);
    expect(tele.frameFraction.vertical).toBeGreaterThan(wide.frameFraction.vertical);
  });

  it('never claims a label identifies a particular summit', () => {
    // D9, as an executable claim about the words the app puts on screen.
    const result = poseUncertainty(fields(fromExif(), assumed()), TELE, 4032, 3024);
    expect(result.summary).toMatch(/which way|direction/i);
    expect(result.summary).toMatch(/drag/i);
    expect(result.summary).not.toMatch(/\bexact(ly)? which bump is\b(?! not)/i);
  });

  it('carries the exact pixel scale, so the UI can say what a drag does', () => {
    const result = poseUncertainty(fields(fromExif(), assumed()), TELE, 4032, 3024);
    expect(result.pixelsPerDegree.horizontal).toBeCloseTo(93.83, 1);
    // 3.52° of unrecorded tilt on this lens is ~440 px of a 3024 px frame.
    const verticalPx = result.measuredDeg.vertical * result.pixelsPerDegree.vertical;
    expect(verticalPx).toBeGreaterThan(300);
    expect(verticalPx).toBeLessThan(600);
  });
});

describe('dragToTrimDeg', () => {
  const size = { w: 4032, h: 3024 };

  it('turns no drag into no trim', () => {
    const trim = dragToTrimDeg({ xPx: 100, yPx: 100 }, { xPx: 100, yPx: 100 }, TELE, size.w, size.h);
    expect(trim.headingDeg).toBeCloseTo(0, 12);
    expect(trim.pitchDeg).toBeCloseTo(0, 12);
  });

  it('drags the overlay RIGHT by decreasing the heading', () => {
    // The sign convention, asserted because getting it backwards feels broken
    // instantly and is invisible in arithmetic that only checks magnitude.
    // Labels belong further right => the camera faced further left.
    const trim = dragToTrimDeg({ xPx: 2016, yPx: 1512 }, { xPx: 2516, yPx: 1512 }, TELE, size.w, size.h);
    expect(trim.headingDeg).toBeLessThan(0);
    expect(trim.pitchDeg).toBeCloseTo(0, 12);
  });

  it('drags the overlay DOWN by INCREASING the pitch — opposite in sign to heading', () => {
    // Not a typo and not symmetry-breaking for its own sake: tilting the camera
    // up pushes the world down through the frame, so "labels belong lower"
    // means "the camera was pointing higher". This test asserted the opposite
    // in its first version and was wrong about the geometry; the code was not.
    const trim = dragToTrimDeg({ xPx: 2016, yPx: 1512 }, { xPx: 2016, yPx: 2012 }, TELE, size.w, size.h);
    expect(trim.pitchDeg).toBeGreaterThan(0);
    expect(trim.headingDeg).toBeCloseTo(0, 12);
  });

  it('moves the overlay by exactly the angle between the two rays', () => {
    // From frame centre, 500 px right on a 4032 px / 41.11209° frame. The half
    // angle is atan(18/48), so tan(hFov/2) is EXACTLY 0.375 — no rounding
    // enters the expectation at all:
    //   offset = 500/2016      = 0.248015873
    //   tanθ   = 0.248015873 × 0.375 = 0.093005952
    //   θ      = atan(0.093005952)   = 0.092739 rad = 5.31356°
    const trim = dragToTrimDeg({ xPx: 2016, yPx: 1512 }, { xPx: 2516, yPx: 1512 }, TELE, size.w, size.h);
    expect(trim.headingDeg).toBeCloseTo(-5.31356, 4);
  });

  it('is NOT linear in pixels — the same drag near the edge is fewer degrees', () => {
    // The reason the inverse projection is used rather than px × deg-per-px.
    // A linear map would let the overlay slide out from under the cursor on a
    // wide lens, which is exactly where users would be dragging hardest.
    const middle = dragToTrimDeg(
      { xPx: 2016, yPx: 1512 }, { xPx: 2216, yPx: 1512 }, ULTRAWIDE, size.w, size.h,
    );
    const edge = dragToTrimDeg(
      { xPx: 3700, yPx: 1512 }, { xPx: 3900, yPx: 1512 }, ULTRAWIDE, size.w, size.h,
    );
    expect(Math.abs(edge.headingDeg)).toBeLessThan(Math.abs(middle.headingDeg));
  });

  it('round-trips: dragging back returns the trim to zero', () => {
    const out = dragToTrimDeg({ xPx: 800, yPx: 600 }, { xPx: 2600, yPx: 2100 }, TELE, size.w, size.h);
    const back = dragToTrimDeg({ xPx: 2600, yPx: 2100 }, { xPx: 800, yPx: 600 }, TELE, size.w, size.h);
    expect(out.headingDeg + back.headingDeg).toBeCloseTo(0, 12);
    expect(out.pitchDeg + back.pitchDeg).toBeCloseTo(0, 12);
  });

  it('returns zero rather than NaN for a degenerate frame', () => {
    const trim = dragToTrimDeg({ xPx: 0, yPx: 0 }, { xPx: 10, yPx: 10 }, TELE, 0, 0);
    expect(trim.headingDeg).toBe(0);
    expect(trim.pitchDeg).toBe(0);
  });
});
