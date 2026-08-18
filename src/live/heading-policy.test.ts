/**
 * The drawable-heading policy.
 *
 * The point under test is a distinction, not a calculation: a magnetic bearing
 * may be DRAWN but must never be LABELLED true. So most of these assert on
 * `basis` and on what reaches the caveat, and one asserts the thing that would
 * be easy to lose in a refactor — that the magnetic path returns the magnetic
 * number unchanged, rather than some number that merely looks plausible.
 */

import { describe, expect, it } from 'vitest';

import { TYPICAL_DECLINATION_BOUND_DEG, resolveHeadingForDrawing } from './heading-policy';
import type { HeadingSample } from './sensors';

const AT_MS = 10_000;

function magneticOnly(magneticDeg: number, timestampMs = AT_MS): HeadingSample {
  return { timestampMs, magneticDeg, accuracyDeg: 20 };
}

describe('resolveHeadingForDrawing', () => {
  it('prefers a true heading and says nothing about it', () => {
    const decision = resolveHeadingForDrawing(
      [{ timestampMs: AT_MS, trueDeg: 174.089, accuracyDeg: 20 }],
      AT_MS,
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.heading.basis).toBe('true');
    expect(decision.heading.headingDeg).toBeCloseTo(174.089, 10);
    expect(decision.heading.caveat).toBe('');
  });

  it('converts with a supplied declination rather than falling back', () => {
    const decision = resolveHeadingForDrawing([magneticOnly(100)], AT_MS, { declinationDeg: 13.5 });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    // Declination is east-positive and added: 100 + 13.5. The basis is `true`
    // because the conversion actually happened.
    expect(decision.heading.headingDeg).toBeCloseTo(113.5, 10);
    expect(decision.heading.basis).toBe('true');
    expect(decision.heading.caveat).toBe('');
  });

  it('draws a magnetic-only heading, unchanged, and labels it magnetic', () => {
    const decision = resolveHeadingForDrawing([magneticOnly(212.75)], AT_MS);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.heading.basis).toBe('magnetic');
    // The number is the magnetic bearing itself — no fudge factor, no guessed
    // declination baked in. That is what makes the label honest.
    expect(decision.heading.headingDeg).toBeCloseTo(212.75, 10);
    expect(decision.heading.caveat).toContain('Magnetic north, not true north');
    expect(decision.heading.caveat).toContain(String(TYPICAL_DECLINATION_BOUND_DEG));
    // A caveat the user cannot act on is just an apology.
    expect(decision.heading.caveat).toContain('Drag');
  });

  it('still refuses when there is genuinely no bearing to draw', () => {
    const empty = resolveHeadingForDrawing([], AT_MS);
    expect(empty).toEqual({
      ok: false,
      refusal: 'no-samples',
      detail: 'the compass has not reported yet',
    });

    // Older than maxAgeMs (1500): stale, and staleness is not recoverable by
    // relabelling — the phone may have been put in a pocket.
    const stale = resolveHeadingForDrawing([magneticOnly(90, AT_MS - 5_000)], AT_MS);
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.refusal).toBe('stale');
    expect(stale.detail).toContain('compass reading');
  });

  it('carries the measured spread and sample count through both paths', () => {
    const samples = [magneticOnly(100, AT_MS - 200), magneticOnly(102, AT_MS - 100)];
    const decision = resolveHeadingForDrawing(samples, AT_MS);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.heading.sampleCount).toBe(2);
    // Two readings 2° apart have a real, non-zero circular spread; the point is
    // that the fallback path does not quietly drop it and claim certainty.
    expect(decision.heading.spreadDeg).toBeGreaterThan(0);
    expect(decision.heading.spreadDeg).toBeLessThan(2);
  });

  it('never reports basis "true" for a bearing that was never converted', () => {
    // The regression this guards: a refactor that returns the magnetic value
    // on the recovery path but forgets to change the label. That single word
    // is the whole difference between honest and wrong.
    for (const bearing of [0, 45, 180, 359.9]) {
      const decision = resolveHeadingForDrawing([magneticOnly(bearing)], AT_MS);
      expect(decision.ok).toBe(true);
      if (!decision.ok) continue;
      expect(decision.heading.basis).toBe('magnetic');
    }
  });
});
