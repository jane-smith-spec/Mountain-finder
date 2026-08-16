import { describe, expect, it } from 'vitest';

import { DEFAULT_ADVANCE_EM, advanceWidthEm, estimateTextWidthPx } from './text-metrics';

describe('advanceWidthEm', () => {
  it('orders the buckets the way a sans-serif actually does', () => {
    // i < a < A < M is true of every humanist sans; if the table ever stops
    // satisfying it, the estimate has become worse than useless for layout.
    expect(advanceWidthEm('i')).toBeLessThan(advanceWidthEm('a'));
    expect(advanceWidthEm('a')).toBeLessThan(advanceWidthEm('A'));
    expect(advanceWidthEm('A')).toBeLessThan(advanceWidthEm('M'));
  });

  it('falls back to the default width for unclassified characters', () => {
    expect(advanceWidthEm('é')).toBe(DEFAULT_ADVANCE_EM);
    expect(advanceWidthEm('ß')).toBe(DEFAULT_ADVANCE_EM);
  });

  it('gives digits a single tabular width, so numbers do not jitter', () => {
    const widths = new Set('0123456789'.split('').map(advanceWidthEm));
    expect(widths.size).toBe(1);
  });
});

describe('estimateTextWidthPx', () => {
  it('is zero for the empty string', () => {
    expect(estimateTextWidthPx('', 20)).toBe(0);
  });

  it('scales linearly with font size', () => {
    const small = estimateTextWidthPx('Matterhorn', 10);
    const large = estimateTextWidthPx('Matterhorn', 30);
    expect(large).toBeCloseTo(3 * small, 10);
  });

  it('sums the per-character table', () => {
    // "Mi" = one wide capital (0.87 em) + one thin lowercase (0.28 em)
    //      = 1.15 em, which at 20 px is 23 px.
    expect(estimateTextWidthPx('Mi', 20)).toBeCloseTo(23, 10);
  });

  it('grows monotonically as characters are appended', () => {
    expect(estimateTextWidthPx('Dent', 20)).toBeLessThan(estimateTextWidthPx('Dent d', 20));
  });

  it('counts an accented letter exactly once', () => {
    // 'é' is one code point; a UTF-16 code-unit loop would still count it once,
    // but the same loop counts an astral character twice — see below.
    expect(estimateTextWidthPx('Hérens', 20)).toBeCloseTo(
      estimateTextWidthPx('Herens', 20),
      10,
    );
  });

  it('counts an astral character once, not twice', () => {
    // '𝔄' is a surrogate pair. `for…of` iterates code points, so this is one
    // default advance, not two.
    expect(estimateTextWidthPx('𝔄', 20)).toBeCloseTo(DEFAULT_ADVANCE_EM * 20, 10);
  });
});
