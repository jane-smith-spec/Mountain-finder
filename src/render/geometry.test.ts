import { describe, expect, it } from 'vitest';

import type { CameraPose } from '../core/types';
import { clipPolylineToFrame, clipSegmentToFrame, isInFrontOfCamera } from './geometry';
import type { PointPx } from './types';

const POSE: CameraPose = {
  headingDeg: 90,
  pitchDeg: 0,
  rollDeg: 0,
  hFovDeg: 60,
  vFovDeg: 46.82644889274108,
};

describe('isInFrontOfCamera', () => {
  it('accepts the optical axis and rejects the exact opposite', () => {
    expect(isInFrontOfCamera(POSE, 90, 0)).toBe(true);
    expect(isInFrontOfCamera(POSE, 270, 0)).toBe(false);
  });

  it('rejects anything more than a quarter turn off the axis', () => {
    // depth = cos(bearing − heading), so the sign flips at ±90°. The boundary
    // itself is deliberately not asserted: in exact arithmetic depth is 0
    // there, but cos(π/2) evaluates to 6.1e-17 in doubles, so the verdict at
    // exactly ±90° is floating-point noise. It is also immaterial — such a
    // direction projects to |x| → ∞ and is clipped away either way.
    expect(isInFrontOfCamera(POSE, 181, 0)).toBe(false);
    expect(isInFrontOfCamera(POSE, 359, 0)).toBe(false);
  });

  it('accepts anything inside a quarter turn of the axis', () => {
    expect(isInFrontOfCamera(POSE, 179, 0)).toBe(true);
    expect(isInFrontOfCamera(POSE, 1, 0)).toBe(true);
  });

  it('follows the pitch: straight up is in front of a camera aimed at the sky', () => {
    const skyward: CameraPose = { ...POSE, pitchDeg: 89 };
    expect(isInFrontOfCamera(skyward, 270, 90)).toBe(true);
    expect(isInFrontOfCamera(skyward, 270, -90)).toBe(false);
  });
});

const at = (xPx: number, yPx: number): PointPx => ({ xPx, yPx });

describe('clipSegmentToFrame', () => {
  it('leaves a fully interior segment untouched', () => {
    expect(clipSegmentToFrame(at(10, 10), at(90, 40), 100, 100)).toEqual([
      at(10, 10),
      at(90, 40),
    ]);
  });

  it('clips one crossing end to the frame edge', () => {
    // The segment (50,50) → (150,50) leaves through x = 100.
    expect(clipSegmentToFrame(at(50, 50), at(150, 50), 100, 100)).toEqual([
      at(50, 50),
      at(100, 50),
    ]);
  });

  it('clips both ends of a segment that crosses right through', () => {
    // (−50,25) → (150,25) enters at x = 0 and leaves at x = 100, y unchanged.
    expect(clipSegmentToFrame(at(-50, 25), at(150, 25), 100, 100)).toEqual([
      at(0, 25),
      at(100, 25),
    ]);
  });

  it('interpolates the crossing point on a sloped segment', () => {
    // (0,−20) → (100,80): y = x − 20, so it enters the frame where y = 0, at
    // x = 20. Hand-computed, not read off the implementation.
    expect(clipSegmentToFrame(at(0, -20), at(100, 80), 100, 100)).toEqual([
      at(20, 0),
      at(100, 80),
    ]);
  });

  it('rejects a segment that misses the frame entirely', () => {
    expect(clipSegmentToFrame(at(-10, -10), at(-5, 500), 100, 100)).toBeUndefined();
  });

  it('rejects a segment parallel to an edge and outside it', () => {
    expect(clipSegmentToFrame(at(-5, 0), at(-5, 100), 100, 100)).toBeUndefined();
  });

  it('keeps a degenerate point that lies inside', () => {
    expect(clipSegmentToFrame(at(50, 50), at(50, 50), 100, 100)).toEqual([
      at(50, 50),
      at(50, 50),
    ]);
  });

  it('rejects a degenerate point that lies outside', () => {
    expect(clipSegmentToFrame(at(150, 50), at(150, 50), 100, 100)).toBeUndefined();
  });
});

describe('clipPolylineToFrame', () => {
  it('returns a single run for a polyline that stays inside', () => {
    const runs = clipPolylineToFrame([at(10, 10), at(50, 20), at(90, 10)], 100, 100);
    expect(runs).toEqual([[at(10, 10), at(50, 20), at(90, 10)]]);
  });

  it('splits into two runs where the line leaves and re-enters', () => {
    // Down through the bottom edge and back up: y = 50 → 150 → 50 across
    // x = 0 → 50 → 100. It exits at x = 25 (y = 100) and re-enters at x = 75.
    const runs = clipPolylineToFrame([at(0, 50), at(50, 150), at(100, 50)], 100, 100);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual([at(0, 50), at(25, 100)]);
    expect(runs[1]).toEqual([at(75, 100), at(100, 50)]);
  });

  it('breaks a run at an undefined sample (a point behind the camera)', () => {
    const runs = clipPolylineToFrame(
      [at(10, 10), at(40, 10), undefined, at(60, 10), at(90, 10)],
      100,
      100,
    );
    expect(runs).toEqual([
      [at(10, 10), at(40, 10)],
      [at(60, 10), at(90, 10)],
    ]);
  });

  it('does not append a duplicate point where a segment only grazes the edge', () => {
    // The second segment starts exactly on the right edge and leaves, so it
    // clips to the single point (100,50) — already the tail of the run.
    const runs = clipPolylineToFrame([at(0, 50), at(100, 50), at(200, 50)], 100, 100);
    expect(runs).toEqual([[at(0, 50), at(100, 50)]]);
  });

  it('does not open a run for a segment that only touches a corner', () => {
    const runs = clipPolylineToFrame([at(100, 100), at(200, 200)], 100, 100);
    expect(runs).toEqual([]);
  });

  it('returns nothing when the whole polyline misses the frame', () => {
    expect(clipPolylineToFrame([at(-40, -40), at(-20, -30)], 100, 100)).toEqual([]);
  });

  it('returns nothing for fewer than two points', () => {
    expect(clipPolylineToFrame([at(10, 10)], 100, 100)).toEqual([]);
    expect(clipPolylineToFrame([], 100, 100)).toEqual([]);
  });
});
