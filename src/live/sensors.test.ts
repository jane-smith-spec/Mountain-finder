/**
 * P8.2's engine, tested against hand-derived geometry.
 *
 * Every expectation below is worked out from the frame convention in
 * sensors.ts's header — never by running the code. The honesty note there
 * applies: this proves the MATH; the conventions still owe a reconciliation
 * against a physical device before P8.2 is done.
 */

import { describe, expect, it } from 'vitest';

import {
  fuseSensorPose,
  orientationFromGravity,
  poseWithSensors,
  smoothedHeading,
  smoothedOrientation,
  type GravitySample,
  type HeadingSample,
} from './sensors';

const COS30 = Math.sqrt(3) / 2;

describe('orientationFromGravity', () => {
  it('reads the four axis-aligned holds exactly', () => {
    // Upright portrait: down is −y. Camera level, no roll.
    expect(orientationFromGravity({ x: 0, y: -1, z: 0 })).toEqual({
      ok: true,
      pitchDeg: 0,
      rollDeg: 0,
    });
    // Face-down on a table: the back camera looks straight UP; roll is
    // meaningless there and must be refused, not zeroed.
    const faceDown = orientationFromGravity({ x: 0, y: 0, z: 1 });
    expect(faceDown).toEqual({ ok: true, pitchDeg: 90, rollDeg: undefined });
    // Face-up: camera at the ground.
    const faceUp = orientationFromGravity({ x: 0, y: 0, z: -1 });
    expect(faceUp).toEqual({ ok: true, pitchDeg: -90, rollDeg: undefined });
  });

  it('reads a 30° upward tilt as +30° of pitch', () => {
    // Tilting the camera up by t rotates DOWN to (0, −cos t, sin t) in device
    // coordinates (derived in the header; the face-down limit checks it).
    const tilted = orientationFromGravity({ x: 0, y: -COS30, z: 0.5 });
    expect(tilted.ok).toBe(true);
    if (!tilted.ok) return;
    expect(tilted.pitchDeg).toBeCloseTo(30, 10);
    expect(tilted.rollDeg).toBeCloseTo(0, 10);
  });

  it('reads landscape holds as ±90° of roll', () => {
    // Right edge of the screen pointing at the ground: down = +x.
    const rightDown = orientationFromGravity({ x: 1, y: 0, z: 0 });
    expect(rightDown.ok && rightDown.rollDeg).toBe(90);
    const leftDown = orientationFromGravity({ x: -1, y: 0, z: 0 });
    expect(leftDown.ok && leftDown.rollDeg).toBe(-90);
  });

  it('normalises a slightly off-unit vector instead of skewing the angles', () => {
    const result = orientationFromGravity({ x: 0, y: -1.2 * COS30, z: 1.2 * 0.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pitchDeg).toBeCloseTo(30, 10);
  });

  it('refuses free fall and hard shakes as not-gravity', () => {
    expect(orientationFromGravity({ x: 0, y: -0.1, z: 0 })).toEqual({
      ok: false,
      refusal: 'not-gravity',
    });
    // A trace in m/s² instead of g trips the same guard — a unit mix-up must
    // be a loud refusal, not a pose pinned at the asin clamp.
    expect(orientationFromGravity({ x: 0, y: -9.81, z: 0 })).toEqual({
      ok: false,
      refusal: 'not-gravity',
    });
  });
});

describe('smoothedHeading', () => {
  const at = 10_000;
  const trueSample = (ageMs: number, trueDeg: number): HeadingSample => ({
    timestampMs: at - ageMs,
    trueDeg,
  });

  it('averages across the 359°→0° seam without shredding', () => {
    const answer = smoothedHeading([trueSample(0, 359), trueSample(0, 1)], at);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.field.valueDeg).toBeCloseTo(0, 9);
    expect(answer.field.sampleCount).toBe(2);
  });

  it('weights samples exponentially by age', () => {
    // Weights: e⁰ = 1 for the fresh sample, e⁻¹ for one exactly a time
    // constant old. Weighted mean of 10° and 20°:
    //   (10·1 + 20·e⁻¹)/(1 + e⁻¹) = 12.68941…°  (chord effect < 0.01° here)
    const answer = smoothedHeading([trueSample(0, 10), trueSample(400, 20)], at);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.field.valueDeg).toBeCloseTo(12.68941, 2);
  });

  it('converts magnetic headings with an explicit declination and never without', () => {
    const magnetic: HeadingSample = { timestampMs: at, magneticDeg: 100 };
    const withDeclination = smoothedHeading([magnetic], at, { declinationDeg: 13.5 });
    expect(withDeclination.ok).toBe(true);
    if (withDeclination.ok) expect(withDeclination.field.valueDeg).toBeCloseTo(113.5, 10);

    expect(smoothedHeading([magnetic], at)).toEqual({
      ok: false,
      refusal: 'needs-declination',
    });
    // A mixed trace refuses whole: averaging two reference frames is worse
    // than answering from neither.
    expect(smoothedHeading([trueSample(0, 114), magnetic], at)).toEqual({
      ok: false,
      refusal: 'needs-declination',
    });
  });

  it('distinguishes an empty trace from a stale one', () => {
    expect(smoothedHeading([], at)).toEqual({ ok: false, refusal: 'no-samples' });
    expect(smoothedHeading([trueSample(2000, 100)], at)).toEqual({ ok: false, refusal: 'stale' });
  });

  it('drops platform-invalid samples and samples from the future', () => {
    const invalid: HeadingSample = { timestampMs: at, trueDeg: 50, accuracyDeg: -1 };
    const future: HeadingSample = { timestampMs: at + 100, trueDeg: 50 };
    expect(smoothedHeading([invalid, future], at)).toEqual({ ok: false, refusal: 'stale' });
  });

  it('reports no spread for a single sample — one reading has no scatter', () => {
    const answer = smoothedHeading([trueSample(0, 42)], at);
    expect(answer.ok && answer.field.spreadDeg).toBeUndefined();
  });
});

describe('smoothedOrientation', () => {
  const at = 5_000;
  const gravity = (ageMs: number, x: number, y: number, z: number): GravitySample => ({
    timestampMs: at - ageMs,
    x,
    y,
    z,
  });

  it('smooths pitch over the trace and reports the measured spread', () => {
    // Two fresh samples at +30° and −30° of pitch, equal weight → mean 0,
    // spread = the standard deviation of {30, −30} = 30.
    const { pitch } = smoothedOrientation(
      [gravity(0, 0, -COS30, 0.5), gravity(0, 0, -COS30, -0.5)],
      at,
    );
    expect(pitch.ok).toBe(true);
    if (!pitch.ok) return;
    expect(pitch.field.valueDeg).toBeCloseTo(0, 10);
    expect(pitch.field.spreadDeg).toBeCloseTo(30, 10);
  });

  it('refuses roll near straight up, while pitch still answers', () => {
    // 85° of upward tilt: down = (0, −cos85°, sin85°).
    const cos85 = Math.cos((85 * Math.PI) / 180);
    const sin85 = Math.sin((85 * Math.PI) / 180);
    const { pitch, roll } = smoothedOrientation([gravity(0, 0, -cos85, sin85)], at);
    expect(pitch.ok).toBe(true);
    if (pitch.ok) expect(pitch.field.valueDeg).toBeCloseTo(85, 9);
    expect(roll).toEqual({ ok: false, refusal: 'gimbal-degenerate' });
  });

  it('takes roll around its wrap: ±179° holds average to 180°, not 0°', () => {
    // Roll +179°: down barely past straight-up-side-down on the +x side —
    // down = (sin179°, −cos179°, 0) = (+0.01745…, +0.99985…, 0). And −179°
    // mirrored. A linear average would say 0° (upright); the truth is the
    // phone is upside down.
    const sin179 = Math.sin((179 * Math.PI) / 180);
    const cos179 = Math.cos((179 * Math.PI) / 180);
    const { roll } = smoothedOrientation(
      [gravity(0, sin179, -cos179, 0), gravity(0, -sin179, -cos179, 0)],
      at,
    );
    expect(roll.ok).toBe(true);
    if (roll.ok) expect(Math.abs(roll.field.valueDeg)).toBeCloseTo(180, 6);
  });

  it('refuses a trace of shakes as not-gravity, not as a pose', () => {
    const { pitch, roll } = smoothedOrientation([gravity(0, 0, -3, 0)], at);
    expect(pitch).toEqual({ ok: false, refusal: 'not-gravity' });
    expect(roll).toEqual({ ok: false, refusal: 'not-gravity' });
  });
});

describe('fuseSensorPose + poseWithSensors', () => {
  const at = 8_000;
  const base = { headingDeg: 100, pitchDeg: 0, rollDeg: 0, hFovDeg: 41, vFovDeg: 31 };

  it('applies exactly the fields the sensors answered, and says which', () => {
    const sensors = fuseSensorPose(
      {
        gravity: [{ timestampMs: at, x: 0, y: -COS30, z: 0.5 }],
        heading: [], // compass off: heading refuses, base heading survives
      },
      at,
    );
    expect(sensors.heading).toEqual({ ok: false, refusal: 'no-samples' });

    const { pose, applied } = poseWithSensors(base, sensors);
    expect(applied).toEqual(['pitch', 'roll']);
    expect(pose.headingDeg).toBe(100);
    expect(pose.pitchDeg).toBeCloseTo(30, 10);
    expect(pose.rollDeg).toBeCloseTo(0, 10);
    expect(pose.hFovDeg).toBe(41);
  });
});
