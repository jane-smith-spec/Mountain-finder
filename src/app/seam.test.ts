/**
 * The seam's small pure parts. The seam's *behaviour* is proved in the browser
 * by `tests/e2e/app.spec.ts` ("the overlay and export seam works end to end"),
 * which drives the probe implementations through the real component tree.
 */

import { describe, expect, it } from 'vitest';

import { annotatedFileName } from './seam';
import { seamProbeEnabled } from './seam-probe';

describe('annotatedFileName', () => {
  it('swaps the photo extension for an annotated PNG name', () => {
    expect(annotatedFileName('chamonix-north-east.jpg')).toBe('chamonix-north-east-annotated.png');
    expect(annotatedFileName('IMG_0042.JPEG')).toBe('IMG_0042-annotated.png');
  });

  it('copes with dots in the stem and with no extension at all', () => {
    expect(annotatedFileName('walk.2026-08-16.jpg')).toBe('walk.2026-08-16-annotated.png');
    expect(annotatedFileName('photo')).toBe('photo-annotated.png');
  });

  it('never produces a bare "-annotated.png" from an empty name', () => {
    expect(annotatedFileName('')).toBe('photo-annotated.png');
    expect(annotatedFileName('.jpg')).toBe('photo-annotated.png');
  });
});

describe('seamProbeEnabled', () => {
  it('is off for every ordinary URL', () => {
    expect(seamProbeEnabled('')).toBe(false);
    expect(seamProbeEnabled('?foo=1')).toBe(false);
    expect(seamProbeEnabled('?seam-probe=0')).toBe(false);
    expect(seamProbeEnabled('?seam-probe')).toBe(false);
  });

  it('is on only when explicitly asked for', () => {
    expect(seamProbeEnabled('?seam-probe=1')).toBe(true);
    expect(seamProbeEnabled('?a=b&seam-probe=1')).toBe(true);
  });
});
