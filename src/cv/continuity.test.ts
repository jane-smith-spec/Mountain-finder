/**
 * The continuity constraint across columns.
 *
 * These are the cases a per-column step fit cannot get right *in principle*,
 * because the information that decides them does not exist inside any single
 * column. Both images are drawn by this file, so the answer is known before
 * anything runs; every threshold below is arithmetic on the three sky-affinity
 * values the images are painted with, done by hand in the comments.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE AFFINITIES, ONCE, SO THE REST IS ARITHMETIC
 * ───────────────────────────────────────────────────────────────────────────
 * `skyAffinity = 0.65 · luma/255 + 0.35 · clamp(0.5 + (B − (R+G)/2)/255)`:
 *
 *   SKY  [150,175,215]  luma 172.573 → 0.676757;  blueness 0.705882 → 0.686951
 *   FACE [130,130,130]  luma 130     → 0.509804;  blueness 0.5      → 0.506373
 *   BAND [ 40, 40, 40]  luma  40     → 0.156863;  blueness 0.5      → 0.276961
 *
 * FACE is the sunlit upper face of a distant massif; BAND is the dark cliff
 * band below it. The step FACE→BAND (0.229) is bigger than SKY→FACE (0.181),
 * which is the whole point: inside those columns the *nearer, lower* edge is
 * the better step, and any per-column fit will take it.
 */

import { describe, expect, it } from 'vitest';

import { extractSkyline } from './skyline.js';
import type { RgbaImage } from './types.js';

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

const SKY: readonly [number, number, number] = [150, 175, 215];
const FACE: readonly [number, number, number] = [130, 130, 130];
const BAND: readonly [number, number, number] = [40, 40, 40];

describe('two surfaces in one frame', () => {
  const WIDTH = 256;
  const HEIGHT = 400;
  /** The distant skyline: row 60, rising to row 40 around x = 200. */
  const crestRow = (x: number): number => 60 - Math.round(20 * Math.exp(-(((x - 200) / 24) ** 2)));
  /** The dark cliff band, present only under columns 80–143. */
  const BAND_TOP = 260;
  const BAND_FROM = 80;
  const BAND_TO = 144;

  const image = imageFrom(WIDTH, HEIGHT, (x, y) => {
    if (y < crestRow(x)) return SKY;
    if (x >= BAND_FROM && x < BAND_TO && y >= BAND_TOP) return BAND;
    return FACE;
  });
  const skyline = extractSkyline(image, { columnCount: WIDTH });

  it('follows the distant skyline even where the nearer edge is the stronger step', () => {
    // ── Why a per-column fit gets this wrong ────────────────────────────────
    // In a band column the affinity is 0.686951 for 60 rows, 0.506373 for 200
    // and 0.276961 for 140, of 400. Otsu's between-class variance
    // w₁w₂(μ₁−μ₂)² at the two candidate splits is
    //
    //   crest, k = 60   μ₁ = 0.686951, μ₂ = 0.411921, w₁ = 0.15 → 0.009648
    //   band,  k = 260  μ₁ = 0.548056, μ₂ = 0.276961, w₁ = 0.65 → 0.016716
    //
    // so the BAND wins by 1.7×, in every one of those 64 columns, and each is a
    // perfectly good step on its own terms. The old per-column extractor put
    // them at row 260 — half the frame below the skyline it found either side.
    //
    // ── Why the continuous path gets it right ───────────────────────────────
    // Evidence (contrast × SNR × edge, the three ramped factors) is 0.3596 at
    // the crest and 0.8462 at the band, so the band is worth 0.487 per column,
    // 31 in total over 64 columns. Reaching it costs either a 200-row jump —
    // 200/1 px per column of bearing = 200 units of apparent slope, 195 above
    // the free limit of 5 — or a ramp at the free slope, which needs 200/5 = 40
    // columns of run-in and 40 of run-out. 80 crossing columns to service 64
    // band columns: the detour cannot pay for itself even at zero jump cost.
    expect(skyline.coverage01).toBe(1);
    for (let column = 0; column < WIDTH; column += 1) {
      const found = skyline.columns[column]?.rowNorm;
      expect(found).toBeDefined();
      if (found === undefined) continue;
      // Two rows of slack for the 3-row pre-blur; nothing else can move it.
      expect(Math.abs(found * HEIGHT - (crestRow(column) + 0.5))).toBeLessThanOrEqual(2);
    }
  });

  it('keeps the extracted boundary inside the relief that was actually drawn', () => {
    // The drawn crest occupies rows 40–60, i.e. 20 of 400 rows = 0.05 of the
    // frame. Anything materially above that is a second surface having crept in
    // — the shape of the real defect, stated as a single number the way the
    // altitude span states it on the real photograph.
    const rows = skyline.columns
      .map((column) => column.rowNorm)
      .filter((row): row is number => row !== undefined);
    expect(rows.length).toBeGreaterThan(0);
    const span = Math.max(...rows) - Math.min(...rows);
    expect(span).toBeLessThanOrEqual((20 + 4) / HEIGHT);
  });

  it('still reports neighbour agreement as an independent number, not a tautology', () => {
    // The path is chosen by a slope penalty; agreement is measured against the
    // local median. They are different measurements of continuity, and keeping
    // them separate is what lets agreement corroborate the path rather than
    // certify itself. On this image the path is right, so agreement is high —
    // that is the corroboration, and it would collapse if the path were dragged
    // across a surface boundary.
    for (const column of skyline.columns) {
      if (column.rowNorm === undefined) continue;
      expect(column.agreement01).toBeGreaterThan(0.9);
    }
  });
});

describe('a genuine cliff, which the penalty must make expensive and not impossible', () => {
  const WIDTH = 256;
  const HEIGHT = 400;
  const CLIFF_COLUMN = 64;
  const HIGH_ROW = 80;
  const LOW_ROW = 220;
  const ROCK: readonly [number, number, number] = [55, 48, 42];
  const trueRow = (x: number): number => (x < CLIFF_COLUMN ? HIGH_ROW : LOW_ROW);

  const image = imageFrom(WIDTH, HEIGHT, (x, y) => (y < trueRow(x) ? SKY : ROCK));
  const skyline = extractSkyline(image, { columnCount: WIDTH });

  it('never reports a fabricated row on the way across', () => {
    // A hard slope cap would smear this 140-row step into a slope. The penalty
    // does not cap: the boundary is free to sit anywhere, and what decides the
    // matter is that rows in between carry no evidence at all. The local-edge
    // bands are `guard + edgeBand` = 2 + 6 = 8 rows deep on each side of a
    // candidate row, so a row more than 8 clear of the drawn boundary has both
    // bands inside one material, `edge01` is exactly 0, and the column is
    // reported UNREADABLE rather than at an invented height.
    //
    // That is the required behaviour on both counts: the cliff is crossed, and
    // the crossing costs coverage instead of producing a plausible wrong curve.
    for (let column = 0; column < WIDTH; column += 1) {
      const found = skyline.columns[column]?.rowNorm;
      if (found === undefined) continue;
      expect(Math.abs(found * HEIGHT - (trueRow(column) + 0.5))).toBeLessThanOrEqual(9);
    }
  });

  it('reads both levels of the cliff, losing only the columns beside it', () => {
    // Both plateaus must come back at their own height. 224 of the 256 columns
    // are more than 4 columns clear of the step; the crossing may cost at most
    // the columns a free-slope ramp spans, 140/5 = 28 either side.
    const left = skyline.columns[16]?.rowNorm;
    const right = skyline.columns[240]?.rowNorm;
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    if (left === undefined || right === undefined) return;
    expect(Math.abs(left * HEIGHT - (HIGH_ROW + 0.5))).toBeLessThanOrEqual(2);
    expect(Math.abs(right * HEIGHT - (LOW_ROW + 0.5))).toBeLessThanOrEqual(2);
    expect(skyline.coverage01).toBeGreaterThan(0.7);
  });
});
