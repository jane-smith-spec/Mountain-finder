/**
 * Skyline extraction: for every image column, where does the sky stop?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE METHOD
 * ═══════════════════════════════════════════════════════════════════════════
 * Each column is reduced to a 1-D signal of sky affinity (see `image.ts`), and
 * every row in it is scored as a candidate **ordered step**: a bright/blue
 * segment above, a darker one below. The score is the same three-factor
 * evidence the confidence is built from (contrast × SNR × local edge, all in
 * [0,1] — see below), evaluated at *every* row rather than only at the winner.
 *
 * The boundary is then the **path through those per-row scores that maximises
 * total evidence minus a penalty for how fast it moves between neighbouring
 * columns** — a dynamic program over columns, solved exactly.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A PATH AND NOT A WINNER PER COLUMN
 * ═══════════════════════════════════════════════════════════════════════════
 * This module used to take, in each column independently, the single split that
 * maximised the between-class variance (Otsu's criterion with the two classes
 * forced to be contiguous and ordered). That is a good answer to the wrong
 * question. A photograph taken while standing on a broad ridge contains at
 * least two ordered steps in most columns — the distant skyline against the sky,
 * and a nearer edge inside the terrain (a snowfield ending on a cliff band, the
 * lip of the foreground) — and *both are good steps*. Choosing per column, some
 * columns lock onto one and some onto the other, each with full confidence, and
 * the returned curve is two different surfaces stitched together.
 *
 * That is not a hypothetical. On `fixtures/photos/real/tundra-blue-sky.jpeg`,
 * taken from Railroad Ridge, Idaho, the per-column extractor returned a boundary
 * spanning **15.96° of altitude**, against a terrain horizon that spans 10.97°
 * over the entire 360° compass and at most 8.8° inside any single 69° frame from
 * that viewpoint. The measurement is decisive because span is invariant to the
 * two unknowns: an unmodelled pitch shifts the range without changing its span,
 * and a wrong focal length scales it roughly uniformly. Neither turns 8.8° into
 * 15.96°. See `docs/CV-REAL-PHOTO-FINDING.md`.
 *
 * The fix has to be a constraint ACROSS columns, because that is the only place
 * the information lives: each of the two steps is individually excellent, and no
 * amount of per-column cleverness can tell which surface the other 500 columns
 * are on.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PENALTY, AND WHY IT IS A SLOPE AND NOT A PIXEL COUNT
 * ═══════════════════════════════════════════════════════════════════════════
 * The quantity the penalty is written in is
 *
 *     s = dα/dβ  =  degrees of altitude per degree of bearing,
 *
 * which is a real physical slope, not an image measurement. For a skyline at
 * horizontal distance d, moving dβ along the crest covers ground d·dβ and
 * changes height by dz, and the altitude angle is α ≈ z/d, so
 *
 *     dα/dβ = dz / (d · dβ) = tan θ / sin φ
 *
 * where θ is the ground slope along the crest and φ is the angle between the
 * crest line and the line of sight. **The distance cancels.** A ridge 2 km away
 * and one 20 km away with the same shape present the same apparent slope.
 *
 * And it is measurable without knowing the focal length. A rectilinear lens with
 * square pixels has the same angular size per pixel horizontally and vertically,
 * so at the frame centre
 *
 *     s = Δrow_px / Δx_px
 *
 * exactly, with no focal length in it. Off axis the two stretch differently and
 * the pixel slope understates `s` by at most sec(hFOV/2) − 1 ≈ 21 % across a 69°
 * frame — far inside the tolerance of the limit it is compared against.
 *
 * `CONTINUITY_FREE_SLOPE` is where the penalty starts, and it is set from what
 * terrain can actually do: ground slopes run to about 40° (tan 0.84) before
 * turning into cliff, and a crest seen within about 10° of end-on divides that
 * by sin 10° ≈ 0.17. Hence **5 degrees of altitude per degree of bearing** as
 * the steepest slope ordinary terrain presents. Below it the boundary moves for
 * free; above it every further unit of slope costs `CONTINUITY_PENALTY` — one
 * column's worth of unambiguous step evidence.
 *
 * The penalty is **linear** in the excess, which is deliberate and is what keeps
 * a cliff possible. A quadratic penalty would make the total cost of a rise
 * depend on how abruptly it happens, i.e. it would forbid near-vertical
 * skyline — and a real skyline *is* locally near-vertical at a cliff edge or a
 * crest seen end-on. Linear charges the same for a rise whether it is taken in
 * one column or spread over ten, so sharpness itself is never penalised: only
 * the total, and only above what terrain does for free.
 *
 * What actually stops the two-surface stitch, then, is not the jump alone. It is
 * that leaving the skyline and coming back costs the excess slope **twice** and
 * spends the crossing columns on rows where there is no edge at all, so the
 * detour has to out-earn its own dead columns as well. A genuine spire pays
 * nothing extra, because every row of its flank is a real edge and its slope is
 * inside the free limit.
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
 *   agreement01 Does this column agree with its neighbours? → the one
 *               DIAGNOSTIC of the four, and deliberately still a diagnostic.
 *
 * The first three are the dynamic program's per-row evidence, which is why they
 * are computed at every row and not only at the winner. `agreement01` is not,
 * and the decision to leave it out is worth stating plainly: **the continuity
 * constraint and the continuity diagnostic must not be the same number.** If
 * agreement drove the choice it would be measuring its own output, would read
 * near 1 by construction, and could never report that the constraint had been
 * forced into something implausible. Kept separate it stays an independent
 * check — it is what catches the column the path was dragged through on its way
 * between two surfaces, or the isolated lock the evidence was strong enough to
 * buy. A constraint that grades its own work is not a check.
 *
 * The product is the confidence, and a column below {@link READABLE_FLOOR}
 * reports **no row at all**. That is the brief's rule made mechanical: a wrong
 * skyline confidently reported is worse than a gap.
 *
 * None of these thresholds is fitted — there is no labelled photograph set in
 * this repository to fit them on, and a constant tuned against three synthetic
 * images would be an invented precision. Each is set from what the quantity
 * physically means, and the reasoning is written next to it.
 *
 * Pure: no DOM, no fetch, no clock, no randomness. The dynamic program is exact
 * and its tie-breaks are deterministic, so the same pixels always give the same
 * answer.
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

/**
 * Apparent skyline slope, in degrees of altitude per degree of bearing, up to
 * which the boundary may move between neighbouring columns at no cost.
 *
 * Derived, not fitted: `dα/dβ = tan θ / sin φ` (see the header), θ the ground
 * slope along the crest and φ the crest's angle to the line of sight. Ordinary
 * mountain terrain reaches about θ = 40° (tan 0.84) before it stops being a
 * slope and starts being a cliff, and a crest running within about 10° of the
 * line of sight divides that by sin 10° = 0.174 — giving ≈ 4.8. Five is that
 * number, and it is the *ordinary* limit, not a maximum: steeper is allowed,
 * it is merely charged for.
 */
export const CONTINUITY_FREE_SLOPE = 5;

/**
 * What one unit of apparent slope above {@link CONTINUITY_FREE_SLOPE} costs, in
 * the same currency as the per-column evidence.
 *
 * The evidence of one column is in [0,1], 1 being an unambiguous, sharp,
 * high-contrast step. Setting this to 1 says: *a boundary that moves one degree
 * of altitude per degree of bearing faster than terrain ordinarily does must be
 * paid for with one whole column of perfect evidence.* There is no scene-derived
 * calibration available for this exchange rate and pretending otherwise would be
 * invented precision, so it is fixed at unity and the sensitivity is reported
 * instead: on the Railroad Ridge photograph the two-surface detour is rejected
 * for any value from about 0.3 upward, and no existing round-trip case is
 * touched at all, because their skylines never exceed the free slope.
 */
export const CONTINUITY_PENALTY = 1;

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

/**
 * Vertical roughness at or below which the region above a split is fully
 * credible as SKY, in mean |Δaffinity| per row over the blurred column strip.
 *
 * MEASURED, not tuned (CV-2, 2026-08-17, the three real Idaho frames): above
 * every true sky/terrain split the mean roughness is 0.2–1.8 ×10⁻³ per row —
 * the 48 mm frame's bold clouds included (p90 = 1.7 ×10⁻³) — while any split
 * whose "sky" contains terrain reads 2.5–13 ×10⁻³. Sky, even dramatic sky,
 * varies SMOOTHLY down a column; rock, snowfields and tundra do not, and the
 * ~8-pixel horizontal strip averaging has already suppressed their texture
 * once, so what survives is a 3–10× separation.
 */
export const SKY_ROUGHNESS_CLEAR = 0.002;

/**
 * Roughness at or beyond which the region above a split cannot be sky at all.
 * 0.006 sits below every terrain-contaminated measurement (min 2.5 ×10⁻³ only
 * for barely-contaminated splits; the wide frames' foreground locks read
 * 5.4–10.9 ×10⁻³) and above every sky one. Between the two bounds credibility
 * falls linearly — a soft ramp, so a single freak column cannot flip a path.
 */
export const SKY_ROUGHNESS_OPAQUE = 0.006;

/** Everything needed to score any split of one column in O(1). */
interface ColumnPrefix {
  readonly rows: number;
  readonly sum: Float64Array;
  readonly values: Float64Array;
  /** Prefix sums of |values[r] − values[r−1]| — the sky-roughness cue (CV-2). */
  readonly roughness: Float64Array;
  readonly total: number;
  readonly totalVariance: number;
  readonly edgeBand: number;
  readonly guard: number;
}

/** The three intrinsic factors at one split row, and their product. */
interface StepFactors {
  readonly contrast: number;
  readonly snr: number;
  readonly edge01: number;
  /** `contrast × snr × edge01`, each ramped to [0,1]. The DP's per-row evidence. */
  readonly evidence: number;
  /**
   * Between-class variance `w₁w₂(μ₁−μ₂)²` — Otsu's criterion. NOT part of the
   * evidence: it is the sub-pixel *localiser* (see {@link refineRow}).
   */
  readonly between: number;
}

const NO_STEP: StepFactors = { contrast: 0, snr: 0, edge01: 0, evidence: 0, between: 0 };

function prefixOf(values: Float64Array, edgeBand: number, guard: number): ColumnPrefix {
  const rows = values.length;
  const sum = new Float64Array(rows + 1);
  const sumSquares = new Float64Array(rows + 1);
  const roughness = new Float64Array(rows);
  for (let row = 0; row < rows; row += 1) {
    const value = values[row] ?? 0;
    sum[row + 1] = (sum[row] ?? 0) + value;
    sumSquares[row + 1] = (sumSquares[row] ?? 0) + value * value;
    if (row > 0) {
      roughness[row] = (roughness[row - 1] ?? 0) + Math.abs(value - (values[row - 1] ?? 0));
    }
  }
  const total = sum[rows] ?? 0;
  const mean = total / rows;
  const totalVariance = Math.max(0, (sumSquares[rows] ?? 0) / rows - mean * mean);
  return { rows, sum, values, roughness, total, totalVariance, edgeBand, guard };
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

/**
 * Score the ordered step that puts rows `< split` in the sky segment.
 *
 * Returns {@link NO_STEP} when the upper segment is not brighter than the lower
 * one: sky above and terrain below is imposed, which is not a limitation but the
 * definition of the thing being looked for.
 */
function factorsAt(prefix: ColumnPrefix, split: number): StepFactors {
  const { rows, sum, values, roughness, total, totalVariance, edgeBand, guard } = prefix;
  if (split <= 0 || split >= rows) return NO_STEP;

  const above = sum[split] ?? 0;
  const contrast = above / split - (total - above) / (rows - split);
  if (contrast <= 0) return NO_STEP;

  // CV-2: the region above a sky/terrain boundary must BE sky, and sky varies
  // smoothly down a column while terrain does not (constants above, measured).
  // This is the cue that stops a bright snowfield or sunlit tundra edge from
  // impersonating the horizon: the step itself looks identical, but everything
  // above a false step contains terrain and is rough. The `guard` rows next to
  // the split are excluded for the same reason `edge01` excludes them: the
  // pre-blur has smeared the step itself across them, and charging a boundary
  // with the roughness OF ITS OWN EDGE would penalise exactly the sharpest,
  // best splits. A split near the top of the frame has almost nothing above it
  // to measure, and correctly scores clear.
  const topRows = split - guard - 1;
  const meanRoughnessAbove = topRows <= 1 ? 0 : (roughness[topRows - 1] ?? 0) / (topRows - 1);
  const skyClarity01 = clamp01(
    (SKY_ROUGHNESS_OPAQUE - meanRoughnessAbove) / (SKY_ROUGHNESS_OPAQUE - SKY_ROUGHNESS_CLEAR),
  );
  if (skyClarity01 <= 0) return NO_STEP;

  // σ²_within = σ²_total − σ²_between, which is exact for a two-class partition.
  const weightAbove = split / rows;
  const between = weightAbove * (1 - weightAbove) * contrast * contrast;
  const withinStd = Math.sqrt(Math.max(0, totalVariance - between));
  // withinStd of exactly 0 means a noiseless step — an infinite SNR, which
  // saturates the factor rather than producing a NaN.
  const snr = withinStd > 0 ? contrast / withinStd : Number.POSITIVE_INFINITY;

  // The two bands are held `guard` rows clear of the split itself, because the
  // pre-blur has already spread a one-row step over `2·radius + 1` rows:
  // measuring right up against the boundary would sample that ramp and report a
  // perfectly sharp edge as a soft one. Clear of it, a true step gives
  // `localAbove − localBelow` equal to the global contrast, i.e. 1.
  const localAbove = meanOver(values, split - guard - edgeBand, split - guard);
  const localBelow = meanOver(values, split + guard, split + guard + edgeBand);
  const edge01 =
    localAbove === undefined || localBelow === undefined
      ? 0
      : clamp01((localAbove - localBelow) / Math.max(contrast, 1e-9));

  const evidence =
    rampFactor(contrast, CONTRAST_FLOOR, CONTRAST_REFERENCE) *
    rampFactor(snr, SNR_FLOOR, SNR_REFERENCE) *
    edge01 *
    skyClarity01;

  return {
    contrast,
    snr: Number.isFinite(snr) ? snr : SNR_REFERENCE,
    edge01,
    evidence,
    between,
  };
}

/**
 * Sub-pixel placement of a boundary the path has already chosen.
 *
 * The three evidence factors are *gates*: each saturates at "good enough", so on
 * a clean high-contrast step they are all 1 over the whole band of rows the
 * pre-blur has smeared the edge across, and their product cannot say which row
 * inside that band is the edge. Otsu's between-class variance can — it has a
 * single sharp maximum at the true step and is the classic maximum-likelihood
 * placement of one. So the two jobs are split: **the dynamic program decides
 * WHICH edge, the between-class variance decides exactly WHERE it is.**
 *
 * The search radius is the blur's own ambiguity, `smoothingRadius + 1` rows, and
 * nothing wider. That is far too small to reach a different surface, so this
 * cannot undo the continuity decision — it only recovers the pixel that the
 * saturated gates threw away. Ties keep the path's own row.
 */
function refineRow(
  prefix: ColumnPrefix,
  row: number,
  radius: number,
  lowest: number,
  highest: number,
): number {
  let bestRow = row;
  let bestBetween = factorsAt(prefix, row).between;
  for (let offset = 1; offset <= radius; offset += 1) {
    for (const candidate of [row - offset, row + offset]) {
      if (candidate < lowest || candidate >= highest) continue;
      const factors = factorsAt(prefix, candidate);
      // Only rows that are themselves credible steps compete: the refinement
      // may move the boundary within the blur, never onto a row the evidence
      // does not support at all.
      if (factors.evidence <= 0) continue;
      if (factors.between > bestBetween) {
        bestBetween = factors.between;
        bestRow = candidate;
      }
    }
  }
  return bestRow;
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
 * The maximum-evidence boundary path, solved exactly by dynamic programming.
 *
 * `evidence` is column-major, `stateCount` rows per column, state `i` meaning
 * split row `lowest + i`. The recurrence is
 *
 *     best_c(k) = evidence_c(k) + max_j [ best_{c−1}(j) − penalty(|k − j|) ]
 *
 * with `penalty(d) = penaltyPerRow · max(0, d − freeRows)`. Evaluating that max
 * naively is O(states²) per column; because the penalty is flat then linear it
 * factors into a **sliding-window maximum** of half-width `freeRows` followed by
 * the classic two-pass L1 transform, which is O(states) per column and gives the
 * identical answer — 512 × 3024 states solve in a few milliseconds.
 *
 * Ties are broken deterministically (strict `>` throughout, so the earliest
 * state wins and a path never moves without a strictly better reason).
 */
function bestPath(
  evidence: Float64Array,
  columnCount: number,
  stateCount: number,
  freeRows: number,
  penaltyPerRow: number,
): Int32Array {
  const chosen = new Int32Array(columnCount);
  if (columnCount === 0 || stateCount <= 0) return chosen;

  const best = new Float64Array(stateCount);
  const carried = new Float64Array(stateCount);
  const windowArg = new Int32Array(stateCount);
  const carriedArg = new Int32Array(stateCount);
  const deque = new Int32Array(stateCount);
  const parent = new Int32Array(columnCount * stateCount);

  for (let state = 0; state < stateCount; state += 1) best[state] = evidence[state] ?? 0;

  for (let column = 1; column < columnCount; column += 1) {
    // ── free window: max over states within `freeRows`, monotone deque. ──────
    let head = 0;
    let tail = 0;
    let pushed = 0;
    for (let state = 0; state < stateCount; state += 1) {
      const limit = Math.min(stateCount - 1, state + freeRows);
      while (pushed <= limit) {
        const value = best[pushed] ?? 0;
        while (tail > head && (best[deque[tail - 1] ?? 0] ?? 0) < value) tail -= 1;
        deque[tail] = pushed;
        tail += 1;
        pushed += 1;
      }
      while (tail > head && (deque[head] ?? 0) < state - freeRows) head += 1;
      const arg = deque[head] ?? state;
      windowArg[state] = arg;
      carried[state] = best[arg] ?? 0;
      carriedArg[state] = state;
    }

    // ── linear tail beyond the free window: forward then backward pass. ──────
    for (let state = 1; state < stateCount; state += 1) {
      const value = (carried[state - 1] ?? 0) - penaltyPerRow;
      if (value > (carried[state] ?? 0)) {
        carried[state] = value;
        carriedArg[state] = carriedArg[state - 1] ?? state;
      }
    }
    for (let state = stateCount - 2; state >= 0; state -= 1) {
      const value = (carried[state + 1] ?? 0) - penaltyPerRow;
      if (value > (carried[state] ?? 0)) {
        carried[state] = value;
        carriedArg[state] = carriedArg[state + 1] ?? state;
      }
    }

    const base = column * stateCount;
    for (let state = 0; state < stateCount; state += 1) {
      const via = carriedArg[state] ?? state;
      parent[base + state] = windowArg[via] ?? via;
      best[state] = (carried[state] ?? 0) + (evidence[base + state] ?? 0);
    }
  }

  let end = 0;
  for (let state = 1; state < stateCount; state += 1) {
    if ((best[state] ?? 0) > (best[end] ?? 0)) end = state;
  }
  chosen[columnCount - 1] = end;
  for (let column = columnCount - 1; column > 0; column -= 1) {
    end = parent[column * stateCount + end] ?? end;
    chosen[column - 1] = end;
  }
  return chosen;
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
  const columnCount = signals.columnCount;
  const smoothingRadius = options.smoothingRadiusRows ?? 1;
  const edgeBand = options.edgeBandRows ?? Math.max(2, Math.round(rows * 0.015));
  const agreementWindow = options.agreementWindowColumns ?? 16;
  const marginRows = Math.round(rows * (options.marginFraction ?? 0));
  const guard = smoothingRadius + 1;

  // Splits are rows `1 … rows−1`: the sky segment and the terrain segment must
  // both be non-empty for the two means to exist at all.
  const lowest = Math.max(1, marginRows);
  const highest = Math.min(rows - 1, rows - marginRows);
  const stateCount = rows < 4 ? 0 : Math.max(0, highest - lowest);

  // ── Pass 1: per-row step evidence for every column. ───────────────────────
  const evidence = new Float64Array(columnCount * stateCount);
  const prefixes: ColumnPrefix[] = [];
  for (let column = 0; column < columnCount; column += 1) {
    const slice = signals.affinity.subarray(column * rows, (column + 1) * rows);
    const prefix = prefixOf(smoothColumn(Float64Array.from(slice), smoothingRadius), edgeBand, guard);
    prefixes.push(prefix);
    const base = column * stateCount;
    for (let state = 0; state < stateCount; state += 1) {
      evidence[base + state] = factorsAt(prefix, lowest + state).evidence;
    }
  }

  // ── Pass 2: the continuous path through them. ─────────────────────────────
  // One sampled column is `pitch` source pixels wide, and rows are counted in
  // source pixels, so `Δrow / pitch` is the apparent slope dα/dβ (header).
  const pitch = image.width / columnCount;
  const freeRows = Math.max(1, Math.round(CONTINUITY_FREE_SLOPE * pitch));
  const penaltyPerRow = CONTINUITY_PENALTY / pitch;
  const path = bestPath(evidence, columnCount, stateCount, freeRows, penaltyPerRow);

  // ── Pass 3: neighbour agreement, and the confidence it completes. ─────────
  // The median is taken over neighbours that already look credible on their
  // own, so a run of nonsense columns cannot vote a good one down. With fewer
  // than three such neighbours there is nothing to disagree with and the factor
  // is 1: absence of corroboration is not evidence against.
  const chosenRows: (number | undefined)[] = [];
  const factors: StepFactors[] = [];
  for (let column = 0; column < columnCount; column += 1) {
    const prefix = prefixes[column];
    if (prefix === undefined || stateCount <= 0) {
      chosenRows.push(undefined);
      factors.push(NO_STEP);
      continue;
    }
    const row = refineRow(prefix, lowest + (path[column] ?? 0), guard, lowest, highest);
    const factor = factorsAt(prefix, row);
    chosenRows.push(factor.evidence > 0 ? row : undefined);
    factors.push(factor);
  }

  const columns: SkylineColumn[] = [];
  for (let column = 0; column < columnCount; column += 1) {
    const row = chosenRows[column];
    const factor = factors[column] ?? NO_STEP;
    const xNorm = (column + 0.5) / columnCount;

    let agreement01 = 1;
    if (row !== undefined) {
      const neighbours: number[] = [];
      const from = Math.max(0, column - agreementWindow);
      const to = Math.min(columnCount, column + agreementWindow + 1);
      for (let other = from; other < to; other += 1) {
        if (other === column) continue;
        const otherRow = chosenRows[other];
        if (otherRow === undefined) continue;
        if ((factors[other]?.evidence ?? 0) < READABLE_FLOOR) continue;
        neighbours.push(otherRow);
      }
      const localMedian = neighbours.length >= 3 ? median(neighbours) : undefined;
      if (localMedian !== undefined) {
        const deviation = Math.abs(row - localMedian) / rows / AGREEMENT_TOLERANCE_NORM;
        agreement01 = 1 / (1 + deviation * deviation);
      }
    }

    const confidence01 = clamp01(factor.evidence * agreement01);
    const readable = row !== undefined && confidence01 >= READABLE_FLOOR;
    columns.push({
      xNorm,
      rowNorm: readable ? (row + 0.5) / rows : undefined,
      confidence01: readable ? confidence01 : 0,
      contrast: factor.contrast,
      snr: factor.snr,
      edge01: factor.edge01,
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
