/**
 * Skyline extraction: for every image column, where does the sky stop?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE METHOD
 * ═══════════════════════════════════════════════════════════════════════════
 * Each column is reduced to a 1-D signal of sky affinity (see `image.ts`) and
 * fitted with a single **ordered step**: the row `k` that best splits the
 * column into a bright/blue segment above and a dark segment below. "Best" is
 * the classic between-class variance,
 *
 *     σ²_b(k) = w₁ w₂ (μ₁ − μ₂)²,     w₁ = k/H, w₂ = (H−k)/H
 *
 * maximised over k — Otsu's criterion, but with the two classes forced to be
 * *contiguous and ordered* rather than found by thresholding, because a
 * skyline is a boundary and not a colour. Sky above and terrain below is
 * imposed (μ₁ > μ₂ required), which is not a limitation but the definition of
 * the thing being looked for.
 *
 * Prefix sums make each column O(H), so the whole extraction is one pass over
 * the pixels plus one pass over the reduced signal.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE CONFIDENCE IS FOUR NUMBERS AND NOT ONE
 * ═══════════════════════════════════════════════════════════════════════════
 * A step fit ALWAYS returns a row. Uniform fog returns a row. A photograph of
 * a wall returns a row. So the returned row is worthless without a measure of
 * whether there was anything to find, and the four ways this can go wrong are
 * genuinely independent — a single blended score would hide which one fired:
 *
 *   contrast    Is there any difference between the two halves at all?
 *               → collapses on uniform fog, on a blank grey frame.
 *   snr         Is that difference large next to the scatter *within* each
 *               half? → collapses on a noisy or textured column where the
 *               "step" is just two random halves of the same distribution.
 *   edge01      Is there an actual transition AT the chosen row, or did the
 *               fit just cut a smooth gradient in half? → collapses on a
 *               cloudless graded sky with no terrain in the column at all,
 *               which is exactly the case `contrast` and `snr` both wave
 *               through (a top-to-bottom gradient has a big contrast and a
 *               respectable SNR, and no horizon anywhere in it).
 *   agreement01 Does this column agree with its neighbours? → collapses on
 *               the single column that locked onto a cloud edge 300 rows above
 *               the ridge, which is the failure that would otherwise be
 *               reported with full confidence and drag the fit with it.
 *
 * The product is the confidence, and a column below {@link READABLE_FLOOR}
 * reports **no row at all**. That is the brief's rule made mechanical: a wrong
 * skyline confidently reported is worse than a gap.
 *
 * None of these thresholds is fitted — there is no labelled photograph set in
 * this repository to fit them on, and a constant tuned against three synthetic
 * images would be an invented precision. Each is set from what the quantity
 * physically means, and the reasoning is written next to it.
 */

import { buildColumnSignals, clamp01, smoothColumn } from './image.js';
import type { RgbaImage, Skyline, SkylineColumn } from './types.js';

/**
 * Contrast below which a column is treated as carrying no evidence. Sky
 * affinity spans [0,1]; 0.04 is about ten 8-bit luma levels, i.e. inside the
 * band that JPEG chroma noise and atmospheric haze occupy on their own.
 */
export const CONTRAST_FLOOR = 0.04;
/**
 * Contrast at which the contrast factor saturates. A normally exposed sky/rock
 * boundary — say luma 200 over luma 60 — is 0.65 · 140/255 ≈ 0.36 on the
 * luminance channel alone, so 0.20 is comfortably below "an ordinary good
 * column" and comfortably above "haze".
 */
export const CONTRAST_REFERENCE = 0.2;

/** Contrast ÷ within-segment scatter below which the step is indistinguishable from noise. */
export const SNR_FLOOR = 1;
/** …and where that factor saturates. A real sky gradient alone puts a good column near 3–4. */
export const SNR_REFERENCE = 4;

/**
 * Confidence below which no row is reported at all.
 *
 * The confidence is a product of factors each in [0,1], so 0.10 is roughly
 * "every factor at least half decent, or one weak one carried by two strong
 * ones". The number is set by the case it has to exclude rather than by taste:
 * a cloudless graded sky with no terrain in the column at all scores a full
 * contrast and a healthy SNR, and is caught *only* by the edge factor, which
 * for a linear ramp comes out near 0.03–0.10 depending on frame height. A floor
 * of 0.10 puts that case out; a floor of 0.03 lets it through with a row
 * planted halfway down the sky, which is precisely the confident fabrication
 * this module exists to avoid.
 */
export const READABLE_FLOOR = 0.1;

/** How far a column may sit from its neighbours' median before agreement halves. */
export const AGREEMENT_TOLERANCE_NORM = 0.12;

export interface SkylineOptions {
  /** Number of vertical strips to reduce the image to. Default min(width, 512). */
  readonly columnCount?: number;
  /** Vertical box-blur radius in rows applied before the step fit. Default 1. */
  readonly smoothingRadiusRows?: number;
  /**
   * Height, in rows, of the two bands compared across the chosen row to measure
   * a *local* edge. Default `max(2, round(0.015 · height))`.
   */
  readonly edgeBandRows?: number;
  /** Half-width in columns of the neighbour-agreement window. Default 16. */
  readonly agreementWindowColumns?: number;
  /** Rows at the very top/bottom excluded from the split, as a fraction. Default 0. */
  readonly marginFraction?: number;
}

interface StepFit {
  /** Row index of the split: rows `< row` are the sky segment. */
  readonly row: number;
  readonly contrast: number;
  readonly withinStd: number;
}

/**
 * Best ordered step in one column, or `undefined` when no split has the sky
 * segment brighter than the terrain segment (an upside-down column: there is
 * no skyline in it, by definition).
 */
function fitStep(column: Float64Array, marginRows: number): StepFit | undefined {
  const rows = column.length;
  if (rows < 4) return undefined;

  const sum = new Float64Array(rows + 1);
  const sumSquares = new Float64Array(rows + 1);
  for (let row = 0; row < rows; row += 1) {
    const value = column[row] ?? 0;
    sum[row + 1] = (sum[row] ?? 0) + value;
    sumSquares[row + 1] = (sumSquares[row] ?? 0) + value * value;
  }

  const total = sum[rows] ?? 0;
  const totalSquares = sumSquares[rows] ?? 0;
  const mean = total / rows;
  const totalVariance = Math.max(0, totalSquares / rows - mean * mean);

  const lowest = Math.max(1, marginRows);
  const highest = Math.min(rows - 1, rows - marginRows);

  let bestRow = -1;
  let bestBetween = 0;
  let bestContrast = 0;
  for (let split = lowest; split < highest; split += 1) {
    const above = sum[split] ?? 0;
    const meanAbove = above / split;
    const meanBelow = (total - above) / (rows - split);
    const contrast = meanAbove - meanBelow;
    if (contrast <= 0) continue;
    const weightAbove = split / rows;
    const between = weightAbove * (1 - weightAbove) * contrast * contrast;
    if (between > bestBetween) {
      bestBetween = between;
      bestRow = split;
      bestContrast = contrast;
    }
  }
  if (bestRow < 0) return undefined;

  // σ²_within = σ²_total − σ²_between, which is exact for a two-class partition.
  const withinVariance = Math.max(0, totalVariance - bestBetween);
  return { row: bestRow, contrast: bestContrast, withinStd: Math.sqrt(withinVariance) };
}

/**
 * Mean of `values` over `[from, to)`, clamped to the array — `undefined` when
 * the clamped range is empty. Undefined rather than 0, so a band that ran off
 * the top or bottom of the frame cannot masquerade as a measurement of zero
 * brightness and turn a split at the frame edge into a confident edge.
 */
function meanOver(values: Float64Array, from: number, to: number): number | undefined {
  const low = Math.max(0, from);
  const high = Math.min(values.length, to);
  if (high <= low) return undefined;
  let total = 0;
  for (let index = low; index < high; index += 1) total += values[index] ?? 0;
  return total / (high - low);
}

/** Median of a numeric list. `undefined` for an empty one — never a guessed 0. */
function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle];
  const low = sorted[middle - 1];
  const high = sorted[middle];
  if (low === undefined || high === undefined) return undefined;
  return (low + high) / 2;
}

function rampFactor(value: number, floor: number, reference: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp01((value - floor) / (reference - floor));
}

/**
 * Extract the skyline.
 *
 * Pure: the same pixels always produce the same answer. No DOM, no clock, no
 * randomness.
 */
export function extractSkyline(image: RgbaImage, options: SkylineOptions = {}): Skyline {
  const signals = buildColumnSignals(image, options.columnCount);
  const rows = signals.rowCount;
  const smoothingRadius = options.smoothingRadiusRows ?? 1;
  const edgeBand = options.edgeBandRows ?? Math.max(2, Math.round(rows * 0.015));
  const agreementWindow = options.agreementWindowColumns ?? 16;
  const marginRows = Math.round(rows * (options.marginFraction ?? 0));

  // ── Pass 1: per-column step fit and the three intrinsic factors. ──────────
  const rawRows: (number | undefined)[] = [];
  const contrasts: number[] = [];
  const snrs: number[] = [];
  const edges: number[] = [];
  const intrinsic: number[] = [];

  for (let column = 0; column < signals.columnCount; column += 1) {
    const slice = signals.affinity.subarray(column * rows, (column + 1) * rows);
    const smoothed = smoothColumn(Float64Array.from(slice), smoothingRadius);
    const fit = fitStep(smoothed, marginRows);

    if (fit === undefined) {
      rawRows.push(undefined);
      contrasts.push(0);
      snrs.push(0);
      edges.push(0);
      intrinsic.push(0);
      continue;
    }

    // The two bands are held `guard` rows clear of the split itself, because
    // the pre-blur has already spread a one-row step over `2·radius + 1` rows:
    // measuring right up against the boundary would sample that ramp and
    // report a perfectly sharp edge as a soft one. Clear of it, a true step
    // gives `localAbove − localBelow` equal to the global contrast, i.e. 1.
    const guard = smoothingRadius + 1;
    const localAbove = meanOver(smoothed, fit.row - guard - edgeBand, fit.row - guard);
    const localBelow = meanOver(smoothed, fit.row + guard, fit.row + guard + edgeBand);
    const edge01 =
      localAbove === undefined || localBelow === undefined
        ? 0
        : clamp01((localAbove - localBelow) / Math.max(fit.contrast, 1e-9));

    // withinStd of exactly 0 means a noiseless step — an infinite SNR, which
    // saturates the factor rather than producing a NaN.
    const snr = fit.withinStd > 0 ? fit.contrast / fit.withinStd : Number.POSITIVE_INFINITY;

    const factor =
      rampFactor(fit.contrast, CONTRAST_FLOOR, CONTRAST_REFERENCE) *
      rampFactor(snr, SNR_FLOOR, SNR_REFERENCE) *
      edge01;

    rawRows.push(fit.row);
    contrasts.push(fit.contrast);
    snrs.push(Number.isFinite(snr) ? snr : SNR_REFERENCE);
    edges.push(edge01);
    intrinsic.push(factor);
  }

  // ── Pass 2: neighbour agreement. ─────────────────────────────────────────
  // The median is taken over neighbours that already look credible on their
  // own, so a run of nonsense columns cannot vote a good one down. With fewer
  // than three such neighbours there is nothing to disagree with and the factor
  // is 1: absence of corroboration is not evidence against.
  const columns: SkylineColumn[] = [];
  for (let column = 0; column < signals.columnCount; column += 1) {
    const row = rawRows[column];
    const own = intrinsic[column] ?? 0;
    const xNorm = (column + 0.5) / signals.columnCount;

    let agreement01 = 1;
    if (row !== undefined) {
      const neighbours: number[] = [];
      const from = Math.max(0, column - agreementWindow);
      const to = Math.min(signals.columnCount, column + agreementWindow + 1);
      for (let other = from; other < to; other += 1) {
        if (other === column) continue;
        const otherRow = rawRows[other];
        if (otherRow === undefined) continue;
        if ((intrinsic[other] ?? 0) < READABLE_FLOOR) continue;
        neighbours.push(otherRow);
      }
      const localMedian = neighbours.length >= 3 ? median(neighbours) : undefined;
      if (localMedian !== undefined) {
        const deviation = Math.abs(row - localMedian) / rows / AGREEMENT_TOLERANCE_NORM;
        agreement01 = 1 / (1 + deviation * deviation);
      }
    }

    const confidence01 = clamp01(own * agreement01);
    const readable = row !== undefined && confidence01 >= READABLE_FLOOR;
    columns.push({
      xNorm,
      rowNorm: readable ? (row + 0.5) / rows : undefined,
      confidence01: readable ? confidence01 : 0,
      contrast: contrasts[column] ?? 0,
      snr: snrs[column] ?? 0,
      edge01: edges[column] ?? 0,
      agreement01,
    });
  }

  const readableColumns = columns.filter((column) => column.rowNorm !== undefined);
  const coverage01 = columns.length === 0 ? 0 : readableColumns.length / columns.length;
  const meanConfidence01 =
    readableColumns.length === 0
      ? 0
      : readableColumns.reduce((total, column) => total + column.confidence01, 0) /
        readableColumns.length;

  return {
    widthPx: image.width,
    heightPx: image.height,
    columns,
    coverage01,
    meanConfidence01,
    reliefNorm: weightedStandardDeviation(readableColumns),
  };
}

/**
 * Confidence-weighted standard deviation of the readable rows.
 *
 * This is the photograph's side of the "is there anything to lock onto"
 * question, and it is deliberately measured on the RAW rows rather than after
 * any detrending: a skyline that is a straight line has nothing to correlate
 * against however cleanly it was found.
 */
function weightedStandardDeviation(columns: readonly SkylineColumn[]): number {
  let weight = 0;
  let sum = 0;
  let sumSquares = 0;
  for (const column of columns) {
    if (column.rowNorm === undefined) continue;
    weight += column.confidence01;
    sum += column.confidence01 * column.rowNorm;
    sumSquares += column.confidence01 * column.rowNorm * column.rowNorm;
  }
  if (weight <= 0) return 0;
  const mean = sum / weight;
  return Math.sqrt(Math.max(0, sumSquares / weight - mean * mean));
}
