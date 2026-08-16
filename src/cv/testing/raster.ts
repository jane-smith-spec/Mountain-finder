/**
 * A pure, deterministic mountain-photograph synthesiser — the ground truth
 * generator for the Phase 7 self-check.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS AND NOT `src/render/testing/synthetic-photo.ts`
 * ═══════════════════════════════════════════════════════════════════════════
 * That module draws a very similar picture and is the right thing for the
 * compositor test, but it draws on a `<canvas>`: it needs a browser, and every
 * `src/cv` test has to run in plain Node under vitest. It also takes its ridge
 * as *pixel polylines* already laid out by the overlay builder, whereas the
 * round-trip here has to control the exact camera pose the ridge was projected
 * with — that pose is the thing being recovered.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT MAKES THE ROUND-TRIP A REAL TEST
 * ═══════════════════════════════════════════════════════════════════════════
 * The picture is drawn by projecting a **closed-form** horizon profile through
 * a **stated true pose**. The aligner is then handed the same profile and a
 * pose that differs from the true one by an offset chosen in the test. The
 * expectation is that offset — a number written down before anything ran, not
 * an output pasted back in.
 *
 * The hostile options are here for the same reason `src/render`'s version has
 * them: an extractor that only works on a clean two-tone silhouette has not
 * been tested. Haze at the skyline, near-black rock, a blown-out sun, drifting
 * cloud and per-pixel noise are all the things that actually break a
 * luminance-based extractor, and they are all reproducible from a seed —
 * `Math.random` is banned in this module for the same reason it is banned in
 * `src/core`.
 */

import { cameraAxes, directionVector, projectToImage } from '../../core/projection.js';
import type { CameraPose, HorizonProfile } from '../../core/types.js';
import type { RgbaImage } from '../types.js';

/** An 8-bit colour. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface CloudSpec {
  readonly xNorm: number;
  readonly yNorm: number;
  readonly radiusNorm: number;
  /** −1 (dark storm) … +1 (bright cumulus). */
  readonly strength: number;
}

export interface SkylinePhotoSpec {
  readonly widthPx: number;
  readonly heightPx: number;
  /** The pose the photograph was actually taken with. */
  readonly pose: CameraPose;
  readonly profile: HorizonProfile;
  readonly skyTop?: Rgb;
  readonly skyHorizon?: Rgb;
  readonly rockTop?: Rgb;
  readonly rockBottom?: Rgb;
  /** Per-pixel uniform noise amplitude, 0…1 of full scale. Default 0. */
  readonly noise01?: number;
  /** Seed for that noise. Required if `noise01 > 0`; there is no default clock. */
  readonly seed?: number;
  readonly clouds?: readonly CloudSpec[];
  /**
   * Terrain above this image row is snow rather than rock.
   *
   * The adversarial case for a luminance-based extractor, and the reason it is
   * here: sunlit snow is *brighter* than a hazy sky, so the sky/terrain step
   * inverts across the snowline and the correct answer stops being the
   * brightest-above/darkest-below split. Give it a bright `snowColour` and a
   * muted sky and the extractor should not merely be wrong — it should say it
   * is unsure. That claim is only worth anything if it can be run.
   */
  readonly snowRowNorm?: number;
  readonly snowColour?: Rgb;
  /** Blown-out sun: centre and radius in normalised units. */
  readonly sun?: { readonly xNorm: number; readonly yNorm: number; readonly radiusNorm: number };
  /**
   * Column ranges (normalised, inclusive) flooded with flat fog — the failure
   * mode where the extractor simply cannot read part of the frame.
   */
  readonly fogBands?: readonly (readonly [number, number])[];
  readonly fogColour?: Rgb;
}

const DEFAULT_SKY_TOP: Rgb = { r: 29, g: 92, b: 158 };
const DEFAULT_SKY_HORIZON: Rgb = { r: 223, g: 233, b: 238 };
const DEFAULT_ROCK_TOP: Rgb = { r: 74, g: 64, b: 56 };
const DEFAULT_ROCK_BOTTOM: Rgb = { r: 15, g: 13, b: 12 };
const DEFAULT_FOG: Rgb = { r: 176, g: 178, b: 180 };

/** Mulberry32 — a small, well-mixed, fully deterministic PRNG. Seeded, never global. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The ridge row for every pixel column, in normalised image units, or
 * `undefined` where the profile puts no terrain in that column.
 *
 * Profile points are projected individually through `projectToImage` and joined
 * with straight segments — the same polyline the renderer draws, so the picture
 * and the overlay agree by construction. Points behind the camera are dropped
 * before projection (the perspective divide mirrors them into frame, which
 * would fold the ridge back on itself).
 *
 * Exported because the round-trip test asserts against the ridge it *asked
 * for*, not against whatever the extractor found.
 */
export function projectRidgeRows(
  pose: CameraPose,
  profile: HorizonProfile,
  widthPx: number,
): (number | undefined)[] {
  const axes = cameraAxes(pose);
  const projected: { x: number; y: number }[] = [];
  for (const point of profile) {
    const direction = directionVector(point.bearingDeg, point.altitudeDeg);
    const depth =
      direction.e * axes.forward.e + direction.n * axes.forward.n + direction.u * axes.forward.u;
    if (depth <= 1e-6) continue;
    const image = projectToImage(pose, point.bearingDeg, point.altitudeDeg);
    projected.push({ x: image.x, y: image.y });
  }
  projected.sort((a, b) => a.x - b.x);

  const rows: (number | undefined)[] = new Array<number | undefined>(widthPx).fill(undefined);
  if (projected.length < 2) return rows;

  let segment = 0;
  for (let column = 0; column < widthPx; column += 1) {
    const xNorm = (column + 0.5) / widthPx;
    while (segment < projected.length - 2 && (projected[segment + 1]?.x ?? 0) < xNorm) {
      segment += 1;
    }
    const left = projected[segment];
    const right = projected[segment + 1];
    if (left === undefined || right === undefined) continue;
    if (xNorm < left.x || xNorm > right.x) continue;
    const span = right.x - left.x;
    const weight = span > 0 ? (xNorm - left.x) / span : 0;
    rows[column] = left.y + weight * (right.y - left.y);
  }
  return rows;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 255) return 255;
  return Math.round(value);
}

/** Draw the photograph. Same spec in, byte-identical image out. */
export function renderSkylinePhoto(spec: SkylinePhotoSpec): RgbaImage {
  const { widthPx, heightPx } = spec;
  if (!Number.isInteger(widthPx) || !Number.isInteger(heightPx) || widthPx <= 0 || heightPx <= 0) {
    throw new RangeError(`photo dimensions must be positive integers, got ${widthPx}×${heightPx}`);
  }
  const noise01 = spec.noise01 ?? 0;
  if (noise01 > 0 && spec.seed === undefined) {
    throw new RangeError('noise01 > 0 requires an explicit seed — this module never invents one');
  }

  const skyTop = spec.skyTop ?? DEFAULT_SKY_TOP;
  const skyHorizon = spec.skyHorizon ?? DEFAULT_SKY_HORIZON;
  const rockTop = spec.rockTop ?? DEFAULT_ROCK_TOP;
  const rockBottom = spec.rockBottom ?? DEFAULT_ROCK_BOTTOM;
  const fogColour = spec.fogColour ?? DEFAULT_FOG;

  const ridge = projectRidgeRows(spec.pose, spec.profile, widthPx);
  const random = seededRandom(spec.seed ?? 1);
  const data = new Uint8Array(widthPx * heightPx * 4);

  for (let row = 0; row < heightPx; row += 1) {
    const yNorm = (row + 0.5) / heightPx;
    for (let column = 0; column < widthPx; column += 1) {
      const xNorm = (column + 0.5) / widthPx;
      const ridgeY = ridge[column];
      const isRock = ridgeY !== undefined && yNorm >= ridgeY;

      let colour: Rgb;
      if (isRock) {
        const depth = ridgeY === undefined ? 0 : (yNorm - ridgeY) / Math.max(1e-6, 1 - ridgeY);
        colour = mix(rockTop, rockBottom, Math.min(1, depth));
        if (spec.snowRowNorm !== undefined && yNorm < spec.snowRowNorm) {
          colour = spec.snowColour ?? { r: 250, g: 250, b: 248 };
        }
      } else {
        // Sky darkens with height; the pale haze band sits at the skyline,
        // which is the worst possible place for a luminance threshold and
        // therefore the right place to put it in a test image.
        const skyDepth = ridgeY === undefined ? yNorm : yNorm / Math.max(1e-6, ridgeY);
        colour = mix(skyTop, skyHorizon, Math.min(1, Math.max(0, skyDepth)) ** 0.7);
      }

      for (const cloud of spec.clouds ?? []) {
        const dx = (xNorm - cloud.xNorm) / cloud.radiusNorm;
        const dy = (yNorm - cloud.yNorm) / cloud.radiusNorm;
        const falloff = Math.exp(-2 * (dx * dx + dy * dy));
        if (falloff < 0.01) continue;
        const target: Rgb =
          cloud.strength >= 0 ? { r: 255, g: 255, b: 252 } : { r: 40, g: 44, b: 52 };
        colour = mix(colour, target, falloff * Math.abs(cloud.strength));
      }

      if (spec.sun !== undefined) {
        const dx = (xNorm - spec.sun.xNorm) / spec.sun.radiusNorm;
        const dy = (yNorm - spec.sun.yNorm) / spec.sun.radiusNorm;
        const falloff = Math.exp(-1.5 * (dx * dx + dy * dy));
        colour = mix(colour, { r: 255, g: 252, b: 235 }, Math.min(0.98, falloff));
      }

      for (const band of spec.fogBands ?? []) {
        const [from, to] = band;
        if (xNorm >= from && xNorm <= to) colour = fogColour;
      }

      const jitter = noise01 > 0 ? (random() - 0.5) * 2 * noise01 * 255 : 0;
      const index = (row * widthPx + column) * 4;
      data[index] = clampByte(colour.r + jitter);
      data[index + 1] = clampByte(colour.g + jitter);
      data[index + 2] = clampByte(colour.b + jitter);
      data[index + 3] = 255;
    }
  }

  return { width: widthPx, height: heightPx, data };
}

/** A frame of flat fog with noise and no skyline whatsoever. */
export function renderFog(
  widthPx: number,
  heightPx: number,
  seed: number,
  noise01 = 0.02,
): RgbaImage {
  const random = seededRandom(seed);
  const data = new Uint8Array(widthPx * heightPx * 4);
  for (let index = 0; index < widthPx * heightPx; index += 1) {
    const jitter = (random() - 0.5) * 2 * noise01 * 255;
    data[index * 4] = clampByte(DEFAULT_FOG.r + jitter);
    data[index * 4 + 1] = clampByte(DEFAULT_FOG.g + jitter);
    data[index * 4 + 2] = clampByte(DEFAULT_FOG.b + jitter);
    data[index * 4 + 3] = 255;
  }
  return { width: widthPx, height: heightPx, data };
}
