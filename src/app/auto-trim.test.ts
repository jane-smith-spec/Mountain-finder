/**
 * The pure half of the auto-trim seam: pipeline suggestion → panel view.
 *
 * The DOM half (canvas, Image) is exercised by the Playwright e2e, where a
 * real browser decodes a real file; nothing here fakes a canvas.
 */

import { describe, expect, it } from 'vitest';

import type { PoseTrimSuggestion } from '../pipeline/cv-alignment.js';
import type { SkylineAlignmentSolution, Skyline } from '../cv/types.js';
import { viewOfSuggestion } from './auto-trim.js';

const EMPTY_SKYLINE: Skyline = {
  widthPx: 100,
  heightPx: 75,
  columns: [],
  coverage01: 0,
  meanConfidence01: 0,
  reliefNorm: 0,
};

function solution(
  status: SkylineAlignmentSolution['status'],
  concerns: SkylineAlignmentSolution['concerns'],
): SkylineAlignmentSolution {
  return {
    status,
    headingOffsetDeg: 0.39,
    pitchOffsetDeg: -2.7,
    correctedCamera: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, hFovDeg: 41, vFovDeg: 31 },
    confidence01: 0.5,
    concerns,
    diagnostics: {
      usedColumnCount: 500,
      usedFraction01: 0.98,
      score: 0.6,
      margin: 0.07,
      residualRmsDeg: 1.3,
      photoReliefDeg: 5,
      profileReliefDeg: 4,
      searchRangeDeg: [-6, 6],
      atSearchEdge: false,
    },
  };
}

function suggested(alignment: SkylineAlignmentSolution): PoseTrimSuggestion {
  return {
    status: 'suggested',
    headingTrimDeg: alignment.headingOffsetDeg,
    pitchTrimDeg: alignment.pitchOffsetDeg,
    alignment,
    skyline: EMPTY_SKYLINE,
    compassBudgetDeg: 6,
  };
}

describe('viewOfSuggestion', () => {
  it('passes a confident suggestion through with no concerns', () => {
    const view = viewOfSuggestion(suggested(solution('aligned', [])));
    expect(view).toEqual({
      status: 'suggested',
      headingTrimDeg: 0.39,
      pitchTrimDeg: -2.7,
      tentative: false,
      concerns: [],
    });
  });

  it('marks a low-confidence suggestion tentative and words its concerns', () => {
    const view = viewOfSuggestion(
      suggested(solution('low-confidence', ['no-correlation', 'residual-too-large'])),
    );
    expect(view.status).toBe('suggested');
    if (view.status !== 'suggested') return;
    expect(view.tentative).toBe(true);
    // Sentences, not codes: the exact wording is asserted so it cannot
    // silently regress to the raw enum values.
    expect(view.concerns).toEqual([
      'the match to the terrain shape is weak',
      'the matched skyline still misses by a lot',
    ]);
  });

  it('turns a near-field decline into the sentence that points at the manual controls', () => {
    const view = viewOfSuggestion({
      status: 'declined',
      reason: 'near-field-in-profile',
      detail: '12 profile point(s)…',
    });
    expect(view.status).toBe('declined');
    if (view.status !== 'declined') return;
    expect(view.message).toContain('too close to the camera');
    expect(view.message).toContain('manual');
  });

  it('carries the aligner’s own detail through on any other decline', () => {
    const view = viewOfSuggestion({
      status: 'declined',
      reason: 'no-alignment',
      detail: 'insufficient-skyline: only 12 of 512 columns…',
    });
    expect(view.status).toBe('declined');
    if (view.status !== 'declined') return;
    expect(view.message).toContain('insufficient-skyline');
  });

  it('has a worded sentence for every alignment failure reason', () => {
    // The map in auto-trim.ts must keep up with the union in cv/types.ts —
    // an unknown code falls back to itself, which this test treats as a miss.
    const reasons = [
      'insufficient-skyline',
      'featureless-photo-skyline',
      'featureless-terrain-profile',
      'ambiguous-correlation',
      'no-correlation',
      'search-range-exhausted',
      'residual-too-large',
      'profile-does-not-cover-frame',
    ] as const;
    const view = viewOfSuggestion(suggested(solution('low-confidence', [...reasons])));
    if (view.status !== 'suggested') throw new Error('expected suggested');
    for (const [index, reason] of reasons.entries()) {
      expect(view.concerns[index]).not.toBe(reason);
    }
  });
});
