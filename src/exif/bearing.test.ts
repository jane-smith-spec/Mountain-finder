import { describe, expect, it } from 'vitest';

import { bearingDeltaDeg, normaliseBearingDeg } from './bearing';

describe('normaliseBearingDeg', () => {
  it('wraps into [0, 360)', () => {
    expect(normaliseBearingDeg(0)).toBe(0);
    expect(normaliseBearingDeg(359.9)).toBeCloseTo(359.9, 10);
    expect(normaliseBearingDeg(360)).toBe(0);
    expect(normaliseBearingDeg(450)).toBe(90);
    expect(normaliseBearingDeg(-90)).toBe(270);
    expect(normaliseBearingDeg(-450)).toBe(270);
  });
});

describe('bearingDeltaDeg', () => {
  it('takes the short way round, including across the seam', () => {
    expect(bearingDeltaDeg(10, 350)).toBe(20);
    expect(bearingDeltaDeg(350, 10)).toBe(-20);
    // The naive subtraction gives −340 and +340 respectively, which is both
    // the wrong magnitude and the wrong sign for a heading error.
    expect(bearingDeltaDeg(90, 80)).toBe(10);
    expect(bearingDeltaDeg(80, 90)).toBe(-10);
  });

  it('lands in (−180, 180], with the antipode resolving to +180', () => {
    expect(bearingDeltaDeg(180, 0)).toBe(180);
    expect(bearingDeltaDeg(0, 180)).toBe(180);
    // Just inside the boundary on each side keeps its sign.
    expect(bearingDeltaDeg(179, 0)).toBe(179);
    expect(bearingDeltaDeg(181, 0)).toBe(-179);
  });

  it('is zero for equal bearings however they are written', () => {
    expect(bearingDeltaDeg(37, 37)).toBe(0);
    expect(bearingDeltaDeg(397, 37)).toBe(0);
    expect(bearingDeltaDeg(-323, 37)).toBe(0);
  });

  it('never returns negative zero, which would print as "−0.0°"', () => {
    // `-360 % 360` is −0, and (−0).toFixed(1) is the string "-0.0".
    expect(Object.is(normaliseBearingDeg(-360), 0)).toBe(true);
    expect(Object.is(bearingDeltaDeg(-323, 37), 0)).toBe(true);
    expect(normaliseBearingDeg(-720).toFixed(1)).toBe('0.0');
  });
});
