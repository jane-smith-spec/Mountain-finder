/**
 * The seam between the CV aligner and the rest of the pipeline — and nothing
 * else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * Phase 7 builds the aligner and proves it. Wiring it into the app — replacing
 * the manual trim sliders of P5.1 with an automatic correction — is a separate
 * step, on purpose: the trim sliders are a control the user can see and undo,
 * and swapping them for an automatic one is only an improvement once the
 * automatic one's quality on *real photographs* is known. It is not yet (see
 * `src/cv/real-photo.test.ts`: this repository contains no photograph of a
 * mountain to measure it on).
 *
 * So this file is one small pure function plus the shape a caller would use. It
 * is not exported from `src/pipeline/index.ts`, nothing in `src/app` imports
 * it, and no existing pipeline file was touched to add it. When integration
 * happens, the changes are:
 *
 *   1. `src/app` decodes the dropped photograph to RGBA it already has in a
 *      canvas, and calls {@link alignSceneToPhoto} with the scene the pipeline
 *      just produced.
 *   2. On `'aligned'`, the trim sliders are *pre-set* to the recovered offsets
 *      and labelled as auto-detected — not hidden. On `'low-confidence'` the
 *      offsets are offered as a suggestion the user applies. On `'failed'` the
 *      sliders behave exactly as they do today and the reason is shown.
 *   3. Nothing about the scene is recomputed silently: the corrected pose is a
 *      new pose, and re-running the pipeline with it is the caller's decision.
 *
 * The reason step 2 is written down here rather than left to taste: an
 * automatic correction that cannot be seen or undone is strictly worse than a
 * manual one, because when it is wrong the user has no way to know it moved
 * anything.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PURITY
 * ═══════════════════════════════════════════════════════════════════════════
 * Unlike the rest of `src/pipeline` this module awaits nothing and injects
 * nothing: it is as pure as `src/cv` itself. Decoding the JPEG to pixels is the
 * caller's job, which is what keeps an image codec out of the pipeline's
 * dependency graph and lets the identical call run in Node and in a browser.
 */

import type { CameraPose, HorizonProfile } from '../core/types.js';
import { alignSkyline, type AlignOptions } from '../cv/align.js';
import { extractSkyline, type SkylineOptions } from '../cv/skyline.js';
import type { RgbaImage, Skyline, SkylineAlignment } from '../cv/types.js';

/** What the aligner needs from a scene. Structurally satisfied by `AnnotatedScene`. */
export interface AlignableScene {
  /** The pose the scene was computed with — the one suspected of being wrong. */
  readonly camera: CameraPose;
  /** The terrain skyline the same run produced. */
  readonly horizon: HorizonProfile;
}

export interface SceneAlignmentRequest {
  /** The photograph, decoded. `jpeg-js` and `getImageData` both produce this. */
  readonly image: RgbaImage;
  readonly scene: AlignableScene;
  readonly skyline?: SkylineOptions;
  readonly align?: AlignOptions;
}

export interface SceneAlignmentResult {
  /** What the extractor read off the photograph, kept for diagnostics and overlays. */
  readonly skyline: Skyline;
  readonly alignment: SkylineAlignment;
  /**
   * The pose to re-run the pipeline with, or `undefined` when the alignment
   * failed. Present for `'low-confidence'` too — the caller decides whether to
   * offer or apply it, and `alignment.status` is how it decides.
   */
  readonly correctedCamera: CameraPose | undefined;
}

/**
 * Extract the photograph's skyline and align the scene's terrain profile to it.
 *
 * Pure and synchronous. Returns data, never a mutated scene: correcting a pose
 * means re-running the pipeline, and doing that behind the caller's back is how
 * a system ends up with two poses and no idea which one drew the labels.
 */
export function alignSceneToPhoto(request: SceneAlignmentRequest): SceneAlignmentResult {
  const skyline = extractSkyline(request.image, request.skyline);
  const alignment = alignSkyline(
    skyline,
    request.scene.camera,
    request.scene.horizon,
    request.align,
  );
  return {
    skyline,
    alignment,
    correctedCamera: alignment.status === 'failed' ? undefined : alignment.correctedCamera,
  };
}

/**
 * A one-line summary for a UI or a log: what happened, and how sure.
 *
 * Exists so that "failed" is never rendered as an empty string somewhere and
 * read as "fine". Every branch says something.
 */
export function describeAlignment(alignment: SkylineAlignment): string {
  if (alignment.status === 'failed') {
    return `no alignment (${alignment.reason}): ${alignment.detail}`;
  }
  const heading = alignment.headingOffsetDeg.toFixed(2);
  const pitch = alignment.pitchOffsetDeg.toFixed(2);
  const confidence = (100 * alignment.confidence01).toFixed(0);
  if (alignment.status === 'low-confidence') {
    return (
      `tentative: heading ${heading}°, pitch ${pitch}° (confidence ${confidence} %, ` +
      `concerns: ${alignment.concerns.join(', ')})`
    );
  }
  return `heading ${heading}°, pitch ${pitch}° (confidence ${confidence} %)`;
}
