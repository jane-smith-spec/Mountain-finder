/**
 * Sky affinity and column reduction.
 *
 * Every expectation is arithmetic done by hand from the published Rec. 709
 * luma coefficients and the weights declared in `image.ts` — nothing here was
 * obtained by running the function and copying its answer.
 */

import { describe, expect, it } from 'vitest';

import {
  assertImageShape,
  buildColumnSignals,
  clamp01,
  skyAffinity,
  smoothColumn,
} from './image.js';
import type { RgbaImage } from './types.js';

/** Build an image from a per-pixel colour function. */
function imageFrom(
  width: number,
  height: number,
  colour: (x: number, y: number) => readonly [number, number, number],
): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colour(x, y);
      const index = (y * width + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 255;
    }
  }
  return { width, height, data };
}

describe('skyAffinity', () => {
  it('matches hand-computed values on the primaries', () => {
    // affinity = 0.65 · (0.2126R + 0.7152G + 0.0722B)/255
    //          + 0.35 · clamp(0.5 + (B − (R+G)/2)/255)
    //
    // black  : 0.65·0            + 0.35·0.5                    = 0.175
    // white  : 0.65·1            + 0.35·(0.5 + 0)              = 0.825
    // mid-grey (128): 0.65·(128/255) + 0.175                   = 0.501275…
    // blue   : 0.65·0.0722      + 0.35·clamp(0.5 + 1) = 1      = 0.396930
    // red    : 0.65·0.2126      + 0.35·clamp(0.5 − 0.5) = 0    = 0.138190
    expect(skyAffinity(0, 0, 0)).toBeCloseTo(0.175, 12);
    expect(skyAffinity(255, 255, 255)).toBeCloseTo(0.825, 12);
    expect(skyAffinity(128, 128, 128)).toBeCloseTo(0.65 * (128 / 255) + 0.175, 12);
    expect(skyAffinity(0, 0, 255)).toBeCloseTo(0.65 * 0.0722 + 0.35, 12);
    expect(skyAffinity(255, 0, 0)).toBeCloseTo(0.65 * 0.2126, 12);
  });

  it('ranks a hazy sky above dark rock, which is the entire premise', () => {
    const sky = skyAffinity(200, 215, 230);
    const rock = skyAffinity(60, 52, 45);
    expect(sky - rock).toBeGreaterThan(0.35);
  });

  it('gives sunlit snow a HIGHER affinity than a muted sky — the known failure mode', () => {
    // Recorded as a test rather than a comment: this is the case the extractor
    // gets wrong, and the confidence measure is what has to catch it. If a
    // later change to the weights makes this assertion fail, that is a real
    // improvement and the test should be updated deliberately, not silently.
    const snow = skyAffinity(250, 250, 248);
    const mutedSky = skyAffinity(120, 140, 160);
    expect(snow).toBeGreaterThan(mutedSky);
  });
});

describe('clamp01', () => {
  it('clamps and rejects non-finite input rather than propagating NaN', () => {
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(7)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('assertImageShape', () => {
  it('rejects a buffer whose length disagrees with the stated size', () => {
    expect(() => assertImageShape({ width: 3, height: 2, data: new Uint8Array(20) })).toThrow(
      /does not match 3×2×4 = 24/,
    );
  });
  it('rejects non-positive dimensions', () => {
    expect(() => assertImageShape({ width: 0, height: 2, data: new Uint8Array(0) })).toThrow(
      RangeError,
    );
  });
});

describe('buildColumnSignals', () => {
  it('averages across each strip', () => {
    // 4×1: two black pixels then two white ones, reduced to two strips.
    // Strip 0 = mean(black, black) = 0.175; strip 1 = mean(white, white) = 0.825.
    const image = imageFrom(4, 1, (x) => (x < 2 ? [0, 0, 0] : [255, 255, 255]));
    const signals = buildColumnSignals(image, 2);
    expect(signals.columnCount).toBe(2);
    expect(signals.rowCount).toBe(1);
    expect(signals.affinity[0]).toBeCloseTo(0.175, 12);
    expect(signals.affinity[1]).toBeCloseTo(0.825, 12);
  });

  it('averages a strip that straddles two different pixels', () => {
    // One strip over the whole 2-pixel width: mean(0.175, 0.825) = 0.5.
    const image = imageFrom(2, 1, (x) => (x === 0 ? [0, 0, 0] : [255, 255, 255]));
    const signals = buildColumnSignals(image, 1);
    expect(signals.affinity[0]).toBeCloseTo(0.5, 12);
  });

  it('never produces an empty strip when asked for more columns than pixels', () => {
    const image = imageFrom(3, 2, () => [10, 20, 30]);
    const signals = buildColumnSignals(image, 999);
    expect(signals.columnCount).toBe(3);
    for (const value of signals.affinity) expect(Number.isFinite(value)).toBe(true);
  });

  it('keeps row resolution intact — vertical detail is the thing being measured', () => {
    const image = imageFrom(8, 5, (_x, y) => (y < 2 ? [255, 255, 255] : [0, 0, 0]));
    const signals = buildColumnSignals(image, 4);
    expect(signals.rowCount).toBe(5);
    expect(signals.affinity[0]).toBeCloseTo(0.825, 12);
    expect(signals.affinity[1]).toBeCloseTo(0.825, 12);
    expect(signals.affinity[2]).toBeCloseTo(0.175, 12);
  });
});

describe('smoothColumn', () => {
  it('is a centred box mean with shrinking windows at the ends', () => {
    const input = Float64Array.from([0, 0, 0, 3, 0, 0, 0]);
    const output = smoothColumn(input, 1);
    expect(output[0]).toBeCloseTo(0, 12); // mean of rows 0..1
    expect(output[2]).toBeCloseTo(1, 12); // mean of rows 1..3 = 3/3
    expect(output[3]).toBeCloseTo(1, 12); // mean of rows 2..4 = 3/3
    expect(output[4]).toBeCloseTo(1, 12); // mean of rows 3..5 = 3/3
    expect(output[6]).toBeCloseTo(0, 12);
  });

  it('preserves the total (it is a mean, not a sum) and does not move a step', () => {
    const input = Float64Array.from([1, 1, 1, 1, 0, 0, 0, 0]);
    const output = smoothColumn(input, 1);
    // A symmetric box blur leaves the midpoint of a step at the midpoint.
    expect(output[3]).toBeCloseTo(2 / 3, 12);
    expect(output[4]).toBeCloseTo(1 / 3, 12);
    expect((output[3] ?? 0) + (output[4] ?? 0)).toBeCloseTo(1, 12);
  });

  it('returns the input untouched at radius 0', () => {
    const input = Float64Array.from([1, 2, 3]);
    expect(smoothColumn(input, 0)).toBe(input);
  });
});
