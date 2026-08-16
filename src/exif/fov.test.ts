import { describe, expect, it } from 'vitest';

import { hFovDegFromFocalLength35mm, vFovDegFromHFov } from './fov';

/**
 * Expectations are computed from the closed forms, not from this code:
 *
 *   hFov = 2*atan(36 / (2*f35))
 *   f35 = 18 -> 36/36 = 1        -> 2*atan(1)    = 90 deg exactly
 *   f35 = 24 -> 36/48 = 0.75     -> 2*atan(0.75) = 73.739795 deg
 *   f35 = 36 -> 36/72 = 0.5      -> 2*atan(0.5)  = 53.130102 deg
 *   f35 = 50 -> 36/100 = 0.36    -> 2*atan(0.36) = 39.597753 deg
 *
 * The 24 mm and 50 mm figures are the published horizontal angles of view for
 * those lenses on a 36x24 mm frame (73.7 deg and 39.6 deg).
 */
describe('hFovDegFromFocalLength35mm', () => {
  it('gives exactly 90 degrees when the focal length equals half the frame width', () => {
    expect(hFovDegFromFocalLength35mm(18)).toBeCloseTo(90, 12);
  });

  it('matches published angles of view for common lenses', () => {
    expect(hFovDegFromFocalLength35mm(24)).toBeCloseTo(73.739795, 6);
    expect(hFovDegFromFocalLength35mm(36)).toBeCloseTo(53.130102, 6);
    expect(hFovDegFromFocalLength35mm(50)).toBeCloseTo(39.597753, 6);
  });

  it('shrinks monotonically as focal length grows', () => {
    const wide = hFovDegFromFocalLength35mm(24);
    const normal = hFovDegFromFocalLength35mm(50);
    const long = hFovDegFromFocalLength35mm(200);
    expect(wide).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(long);
  });

  it('rejects non-positive or non-finite focal lengths', () => {
    expect(() => hFovDegFromFocalLength35mm(0)).toThrow(RangeError);
    expect(() => hFovDegFromFocalLength35mm(-24)).toThrow(RangeError);
    expect(() => hFovDegFromFocalLength35mm(Number.NaN)).toThrow(RangeError);
  });
});

/**
 * tan(vFov/2) = tan(hFov/2) * height/width. With hFov = 90 deg the tangent is
 * exactly 1, so the expectations reduce to 2*atan(height/width):
 *
 *   1:1  -> 2*atan(1)    = 90 deg
 *   2:1  -> 2*atan(0.5)  = 53.130102 deg
 *   4:3  -> 2*atan(0.75) = 73.739795 deg
 */
describe('vFovDegFromHFov', () => {
  it('equals hFov on a square image', () => {
    expect(vFovDegFromHFov(90, 100, 100)).toBeCloseTo(90, 12);
    expect(vFovDegFromHFov(43.5, 512, 512)).toBeCloseTo(43.5, 12);
  });

  it('follows the tangent relation, not a linear scaling', () => {
    expect(vFovDegFromHFov(90, 200, 100)).toBeCloseTo(53.130102, 6);
    expect(vFovDegFromHFov(90, 800, 600)).toBeCloseTo(73.739795, 6);
    // The naive hFov * height/width would have said 45 and 67.5 respectively.
    expect(vFovDegFromHFov(90, 200, 100)).not.toBeCloseTo(45, 2);
  });

  it('depends only on the aspect ratio, not the absolute pixel count', () => {
    expect(vFovDegFromHFov(60, 800, 600)).toBeCloseTo(vFovDegFromHFov(60, 4000, 3000), 12);
  });

  it('exceeds hFov on a portrait image', () => {
    expect(vFovDegFromHFov(60, 600, 800)).toBeGreaterThan(60);
  });

  it('rejects impossible inputs', () => {
    expect(() => vFovDegFromHFov(0, 800, 600)).toThrow(RangeError);
    expect(() => vFovDegFromHFov(180, 800, 600)).toThrow(RangeError);
    expect(() => vFovDegFromHFov(60, 0, 600)).toThrow(RangeError);
    expect(() => vFovDegFromHFov(60, 800, -600)).toThrow(RangeError);
  });
});
