/**
 * Text width estimation without a DOM.
 *
 * Label collision avoidance needs to know how wide a label is *before* anything
 * is drawn, and the overlay builder is a pure function — there is no
 * `measureText`, no font loaded, no layout engine. So widths are estimated from
 * a table of approximate advance widths.
 *
 * ## Why an estimate is enough
 *
 * Labels are centre-anchored (`text-anchor="middle"`), so an error in the
 * estimate never moves the text — it only makes the reserved box slightly too
 * wide or too narrow, which at worst leaves a little extra air between two
 * stacked labels or lets two labels approach a few pixels closer than intended.
 * That is a cosmetic error. Had labels been left-anchored at a computed
 * `x - width/2`, the same error would shift the glyphs themselves, and every
 * label position would inherit the metric's inaccuracy. The anchoring choice is
 * what makes the approximation acceptable, so it is not an incidental detail.
 *
 * ## The table
 *
 * Advance widths are in *em* units (fractions of the font size) for a
 * Helvetica/Arial-class humanist sans at a semi-bold weight, grouped into five
 * buckets rather than tabulated per glyph. Grouping costs maybe 10 % accuracy
 * on an individual glyph and far less on a whole word, where over- and
 * under-estimates average out. Values are the conventional Helvetica figures:
 * digits are tabular at 0.556 em, lowercase averages ~0.55 em, capitals ~0.68
 * em, `m`/`w`/`M`/`W` ~0.87 em, and the thin set (`i`, `l`, `.`, `'`) ~0.28 em.
 *
 * Characters outside the table — accented Latin, CJK, anything else — fall back
 * to the default width. Accented Latin letters have the same advance as their
 * base letter, so `Hérens` is estimated exactly as well as `Herens`; CJK is
 * genuinely wider than the fallback, which is a documented limitation rather
 * than a hidden one.
 */

/** Advance width in em units used for any character not otherwise classified. */
export const DEFAULT_ADVANCE_EM = 0.55;

const THIN_CHARS = "iljtfI.,:;'`!|()[]{}-";
const WIDE_CHARS = 'mwMW@%';
const CAPITAL_CHARS = 'ABCDEFGHJKLNOPQRSTUVXYZ';
const DIGIT_CHARS = '0123456789';

/** Approximate advance width of a single character, in em units. */
export function advanceWidthEm(character: string): number {
  if (character === ' ') return 0.28;
  if (THIN_CHARS.includes(character)) return 0.28;
  if (WIDE_CHARS.includes(character)) return 0.87;
  if (CAPITAL_CHARS.includes(character)) return 0.68;
  if (DIGIT_CHARS.includes(character)) return 0.556;
  return DEFAULT_ADVANCE_EM;
}

/**
 * Approximate rendered width of a string at a given font size, in pixels.
 *
 * Iteration is by code point (`for…of`), not by UTF-16 code unit, so a name
 * containing an astral character counts it once rather than twice.
 */
export function estimateTextWidthPx(text: string, fontSizePx: number): number {
  let widthEm = 0;
  for (const character of text) {
    widthEm += advanceWidthEm(character);
  }
  return widthEm * fontSizePx;
}
