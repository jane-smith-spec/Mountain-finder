/**
 * Pixels → a single scalar per pixel that says "how much does this look like
 * sky", and the column binning that turns an image into the 1-D signals the
 * skyline extractor works on.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT "SKY AFFINITY" IS, AND WHAT IT IS NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * Sky is usually *brighter* and *bluer* than the terrain under it. That is the
 * whole of the model, and it is a heuristic, not a law:
 *
 *   • sunlit snow is brighter than a hazy sky, and roughly as blue-neutral;
 *   • a dark storm cloud is darker than a sunlit slope;
 *   • backlit rock against a low sun is almost black next to almost white.
 *
 * So this function will be wrong on some columns of some photographs, and the
 * design answer to that is NOT a cleverer affinity — it is that every column
 * carries a confidence which collapses when the evidence is weak, and the
 * aligner weights by it and refuses to answer when too little survives. A
 * better affinity raises the hit rate; the confidence is what keeps a miss from
 * becoming a confidently wrong label. See `skyline.ts` for the four factors.
 *
 * The two channels are combined with fixed weights rather than fitted, because
 * there is no labelled data set in this repository to fit them against and a
 * number tuned on three synthetic images would be an invented precision.
 */

import type { RgbaImage } from './types.js';

/**
 * Rec. 709 luma weights — the standard sRGB→luminance coefficients, the same
 * ones `src/render`'s contrast checks use. Applied to gamma-encoded values
 * (i.e. this is luma, not linear luminance), which is what we want: perceptual
 * lightness is the thing that separates sky from rock to a human eye, and
 * linearising would crush the shadow detail this relies on.
 */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/**
 * How the two cues are mixed. Luminance carries most of the signal — it works
 * on a monochrome photograph and on an overcast day, where blueness carries
 * nothing at all. Blueness is the tiebreaker that saves the case luminance gets
 * wrong most often: bright snow under a hazy sky.
 */
export const LUMINANCE_WEIGHT = 0.65;
export const BLUENESS_WEIGHT = 0.35;

/** Guard for `data.length === width * height * 4`, with a message worth reading. */
export function assertImageShape(image: RgbaImage): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height)) {
    throw new RangeError(
      `image dimensions must be integers, received ${image.width}×${image.height}`,
    );
  }
  if (image.width <= 0 || image.height <= 0) {
    throw new RangeError(`image dimensions must be > 0, received ${image.width}×${image.height}`);
  }
  const expected = image.width * image.height * 4;
  if (image.data.length !== expected) {
    throw new RangeError(
      `image data length ${image.data.length} does not match ${image.width}×${image.height}×4 = ${expected}`,
    );
  }
}

/**
 * Sky affinity of one RGB triple, in [0,1].
 *
 *   luminance01 = luma / 255
 *   blueness01  = 0.5 + (B − (R+G)/2) / 255,  clamped
 *
 * Blueness is centred on 0.5 so that a neutral grey scores exactly 0.5 on both
 * channels: an unsaturated image contributes nothing but its brightness, which
 * is the honest reading of a monochrome photograph.
 */
export function skyAffinity(r: number, g: number, b: number): number {
  const luminance01 = (LUMA_R * r + LUMA_G * g + LUMA_B * b) / 255;
  const blueness01 = clamp01(0.5 + (b - (r + g) / 2) / 255);
  return LUMINANCE_WEIGHT * luminance01 + BLUENESS_WEIGHT * blueness01;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * The image reduced to `columnCount` vertical strips, each strip a column of
 * per-row mean sky affinity.
 *
 * Binning across the strip's width is averaging, not sampling: it suppresses
 * per-pixel sensor noise and JPEG ringing by √n without blurring the thing we
 * are looking for, because the skyline is (locally) horizontal and averaging
 * *horizontally* does not smear a horizontal edge. Averaging vertically would,
 * which is why the row resolution is left alone.
 */
export interface ColumnSignals {
  readonly columnCount: number;
  readonly rowCount: number;
  /** Column-major: `affinity[column * rowCount + row]`. */
  readonly affinity: Float64Array;
  /** Left edge of each strip in source pixels; `columnStart[columnCount]` = width. */
  readonly columnStart: Int32Array;
}

/**
 * @param columnCount how many strips to reduce to. Defaults to the image width
 *   capped at 512 — beyond that the extra columns cost time and buy nothing,
 *   since the aligner's resolution is set by the field of view per column
 *   (65°/512 = 0.13°, already finer than the 0.5° the self-check demands).
 */
export function buildColumnSignals(image: RgbaImage, columnCount?: number): ColumnSignals {
  assertImageShape(image);
  const count = Math.max(1, Math.min(image.width, columnCount ?? Math.min(image.width, 512)));

  const columnStart = new Int32Array(count + 1);
  for (let column = 0; column <= count; column += 1) {
    columnStart[column] = Math.round((column * image.width) / count);
  }
  // Every strip must contain at least one source column, otherwise a wide
  // `columnCount` on a narrow image would produce empty (NaN) strips.
  for (let column = 0; column < count; column += 1) {
    const start = columnStart[column] ?? 0;
    const end = columnStart[column + 1] ?? image.width;
    if (end <= start) columnStart[column + 1] = Math.min(image.width, start + 1);
  }

  const affinity = new Float64Array(count * image.height);
  for (let column = 0; column < count; column += 1) {
    const start = columnStart[column] ?? 0;
    const end = Math.max(start + 1, columnStart[column + 1] ?? start + 1);
    const width = end - start;
    for (let row = 0; row < image.height; row += 1) {
      let total = 0;
      const rowBase = row * image.width;
      for (let x = start; x < end; x += 1) {
        const index = (rowBase + x) * 4;
        total += skyAffinity(
          image.data[index] ?? 0,
          image.data[index + 1] ?? 0,
          image.data[index + 2] ?? 0,
        );
      }
      affinity[column * image.height + row] = total / width;
    }
  }

  return { columnCount: count, rowCount: image.height, affinity, columnStart };
}

/**
 * In-place vertical box blur of one column, radius `radius` rows.
 *
 * Applied before the step fit purely to stop a single bright row (a JPEG
 * artefact, a hot pixel, a thin wire) from being read as the horizon. Radius 1
 * — a 3-row mean — is the default: enough to kill single-row spikes, small
 * enough that a real skyline moves by less than a row.
 */
export function smoothColumn(values: Float64Array, radius: number): Float64Array {
  if (radius <= 0) return values;
  const out = new Float64Array(values.length);
  let window = 0;
  for (let index = 0; index <= Math.min(radius, values.length - 1); index += 1) {
    window += values[index] ?? 0;
  }
  for (let index = 0; index < values.length; index += 1) {
    const low = Math.max(0, index - radius);
    const high = Math.min(values.length - 1, index + radius);
    out[index] = window / (high - low + 1);
    const dropIndex = index - radius;
    const addIndex = index + radius + 1;
    if (dropIndex >= 0) window -= values[dropIndex] ?? 0;
    if (addIndex < values.length) window += values[addIndex] ?? 0;
  }
  return out;
}
