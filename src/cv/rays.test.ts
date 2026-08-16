/**
 * The ray geometry the whole aligner rests on.
 *
 * Every expectation here is derived from the projection model or from closed
 * form — never from running the aligner. The two claims that matter are:
 *
 *   1. `unprojectFromImage` is the exact inverse of `projectToImage`, so the
 *      pose the aligner returns means the same thing to the renderer.
 *   2. The rotation identity in `rays.ts` holds: applying a heading/pitch
 *      offset to a nominal ray gives the *same* direction as rebuilding the
 *      camera at the offset pose. This is what makes the search exact rather
 *      than a small-angle approximation.
 */

import { describe, expect, it } from 'vitest';

import { projectToImage } from '../core/projection.js';
import type { CameraPose } from '../core/types.js';
import {
  applyPoseOffset,
  coversBearing,
  directionToSky,
  profileCoverage,
  rotateAboutVertical,
  unprojectFromImage,
} from './rays.js';
import { analyticProfile } from './testing/profiles.js';

const POSE: CameraPose = {
  headingDeg: 265.4,
  pitchDeg: -3.5,
  rollDeg: 0,
  hFovDeg: 65.4704525442152,
  vFovDeg: 51.387,
};

describe('unprojectFromImage', () => {
  it('inverts projectToImage over the whole frame', () => {
    for (const x of [0, 0.13, 0.5, 0.77, 1]) {
      for (const y of [0, 0.29, 0.5, 0.91, 1]) {
        const direction = unprojectFromImage(POSE, x, y);
        const sky = directionToSky(direction);
        const back = projectToImage(POSE, sky.bearingDeg, sky.altitudeDeg);
        expect(back.x).toBeCloseTo(x, 10);
        expect(back.y).toBeCloseTo(y, 10);
      }
    }
  });

  it('sends the frame centre along the optical axis', () => {
    const sky = directionToSky(unprojectFromImage(POSE, 0.5, 0.5));
    expect(sky.bearingDeg).toBeCloseTo(POSE.headingDeg, 10);
    expect(sky.altitudeDeg).toBeCloseTo(POSE.pitchDeg, 10);
  });

  it('inverts a rolled pose too', () => {
    const rolled: CameraPose = { ...POSE, rollDeg: 12 };
    const sky = directionToSky(unprojectFromImage(rolled, 0.2, 0.8));
    const back = projectToImage(rolled, sky.bearingDeg, sky.altitudeDeg);
    expect(back.x).toBeCloseTo(0.2, 10);
    expect(back.y).toBeCloseTo(0.8, 10);
  });
});

describe('rotateAboutVertical', () => {
  it('shifts bearing by exactly the offset and leaves altitude untouched', () => {
    // Closed form: a rotation about the world vertical maps bearing β ↦ β + Δ
    // and fixes the vertical component, hence the altitude angle.
    const direction = unprojectFromImage(POSE, 0.18, 0.4);
    const before = directionToSky(direction);
    for (const delta of [-17.25, -1, 0.5, 9.75]) {
      const after = directionToSky(rotateAboutVertical(direction, delta));
      expect(after.altitudeDeg).toBeCloseTo(before.altitudeDeg, 12);
      const expected = ((before.bearingDeg + delta) % 360 + 360) % 360;
      expect(after.bearingDeg).toBeCloseTo(expected, 10);
    }
  });
});

describe('applyPoseOffset', () => {
  it('reproduces the ray of the offset pose exactly, for every pixel', () => {
    // The identity under test:
    //   unproject(pose(h₀+Δh, p₀+Δp), u) == R_up(Δh) · R_r(Δp) · unproject(pose(h₀, p₀), u)
    // Checked at pixels spread across the frame and at offsets far larger than
    // any small-angle approximation would survive.
    const offsets: readonly (readonly [number, number])[] = [
      [0, 0],
      [7.3, 1.4],
      [-12.5, -4.25],
      [23, 8],
    ];
    for (const [headingOffset, pitchOffset] of offsets) {
      const truePose: CameraPose = {
        ...POSE,
        headingDeg: POSE.headingDeg + headingOffset,
        pitchDeg: POSE.pitchDeg + pitchOffset,
      };
      for (const x of [0.02, 0.31, 0.5, 0.86, 0.99]) {
        for (const y of [0.05, 0.45, 0.95]) {
          const expected = directionToSky(unprojectFromImage(truePose, x, y));
          const rotated = directionToSky(
            applyPoseOffset(
              unprojectFromImage(POSE, x, y),
              POSE.headingDeg,
              headingOffset,
              pitchOffset,
            ),
          );
          expect(rotated.bearingDeg).toBeCloseTo(expected.bearingDeg, 9);
          expect(rotated.altitudeDeg).toBeCloseTo(expected.altitudeDeg, 9);
        }
      }
    }
  });

  it('holds with roll applied, which the aligner never searches but must not break', () => {
    const rolledNominal: CameraPose = { ...POSE, rollDeg: 9.5 };
    const rolledTrue: CameraPose = {
      ...rolledNominal,
      headingDeg: rolledNominal.headingDeg - 6,
      pitchDeg: rolledNominal.pitchDeg + 2.5,
    };
    const expected = directionToSky(unprojectFromImage(rolledTrue, 0.87, 0.22));
    const rotated = directionToSky(
      applyPoseOffset(
        unprojectFromImage(rolledNominal, 0.87, 0.22),
        rolledNominal.headingDeg,
        -6,
        2.5,
      ),
    );
    expect(rotated.bearingDeg).toBeCloseTo(expected.bearingDeg, 9);
    expect(rotated.altitudeDeg).toBeCloseTo(expected.altitudeDeg, 9);
  });

  it('is NOT the same as applying the rotations in the other order', () => {
    // Recorded so nobody "simplifies" the order later: the two compositions
    // differ at O(Δh·Δp), which at 20°/8° is far above the 0.5° target.
    const direction = unprojectFromImage(POSE, 0.9, 0.3);
    const correct = directionToSky(applyPoseOffset(direction, POSE.headingDeg, 20, 8));
    const swapped = directionToSky(
      applyPoseOffset(rotateAboutVertical(direction, 20), POSE.headingDeg + 20, 0, 8),
    );
    expect(Math.abs(correct.altitudeDeg - swapped.altitudeDeg)).toBeGreaterThan(0.1);
  });
});

describe('profileCoverage', () => {
  it('reports a uniform 360° sweep as fully covered', () => {
    const profile = analyticProfile({
      fromBearingDeg: 0,
      toBearingDeg: 359.5,
      stepDeg: 0.5,
      baseAltitudeDeg: 2,
      bumps: [],
    });
    const coverage = profileCoverage(profile);
    expect(coverage.gapFromDeg).toBeUndefined();
    expect(coverage.coveredSpanDeg).toBe(360);
    expect(coversBearing(coverage, 123.4)).toBe(true);
  });

  it('finds the hole in a sector sweep and refuses bearings inside it', () => {
    // 205°…325° sampled every 0.25°: the covered arc is 120° wide and the
    // remaining 240° is a hole that must not be interpolated across.
    const profile = analyticProfile({
      fromBearingDeg: 205,
      toBearingDeg: 325,
      stepDeg: 0.25,
      baseAltitudeDeg: 2,
      bumps: [],
    });
    const coverage = profileCoverage(profile);
    expect(coverage.gapFromDeg).toBeCloseTo(325, 6);
    expect(coverage.gapToDeg).toBeCloseTo(205, 6);
    expect(coverage.coveredSpanDeg).toBeCloseTo(120, 6);

    expect(coversBearing(coverage, 265)).toBe(true);
    expect(coversBearing(coverage, 205)).toBe(true);
    expect(coversBearing(coverage, 325)).toBe(true);
    expect(coversBearing(coverage, 10)).toBe(false);
    expect(coversBearing(coverage, 180)).toBe(false);
    expect(coversBearing(coverage, 330)).toBe(false);
  });

  it('handles a sector that straddles north', () => {
    const profile = analyticProfile({
      fromBearingDeg: 350,
      toBearingDeg: 380,
      stepDeg: 0.5,
      baseAltitudeDeg: 2,
      bumps: [],
    });
    const coverage = profileCoverage(profile);
    expect(coverage.coveredSpanDeg).toBeCloseTo(30, 6);
    expect(coversBearing(coverage, 355)).toBe(true);
    expect(coversBearing(coverage, 5)).toBe(true);
    expect(coversBearing(coverage, 180)).toBe(false);
  });
});
