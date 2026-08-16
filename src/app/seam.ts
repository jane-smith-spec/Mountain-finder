/**
 * THE SEAM — where the app hands off to the pipeline and the renderer.
 *
 * ## Why this file exists
 *
 * P5.1 (this app) was built in parallel with P4 (renderer) and the pipeline, so
 * it imports NOTHING from `src/render` or `src/pipeline`. Instead it states, in
 * types, exactly what it will call and exactly what it expects back. Everything
 * the app needs from the rest of the system passes through the two function
 * types below, and both arrive as props on `<App>` — see `App.tsx`. There is no
 * hidden coupling and no fake data anywhere behind this line.
 *
 * ## Wiring it up (TODO.md Q1) is mechanical
 *
 * 1. Implement `OverlayBuilder` in `src/pipeline` — it is the whole pipeline
 *    behind one async call:
 *
 *        observer + pose + frame
 *          → sample terrain (local .hgt tiles)      src/providers
 *          → buildHorizonProfile                     src/core/horizon
 *          → peaks in view + filterVisiblePeaks      src/core/visibility
 *          → layoutOverlay / buildOverlaySvg         src/render
 *          → { svgMarkup, peakNames }
 *
 *    `OverlayRequest` deliberately carries the same three things
 *    `OverlayScene` (src/render/types.ts) needs minus `horizon` and `peaks`,
 *    which are precisely what the pipeline computes: `widthPx`/`heightPx` are
 *    named identically, and `pose` is a `CameraPose` from `src/core/types` with
 *    the trim ALREADY APPLIED. Nothing needs reshaping at the boundary.
 *
 * 2. Implement `PngExporter` in `src/render/composite` (P4.2). It receives the
 *    photo as an object URL plus the SVG string the builder returned, and gives
 *    back a PNG blob at the photo's natural pixel size.
 *
 * 3. In `main.tsx`, pass them in:
 *        <App overlayBuilder={buildOverlay} pngExporter={compositePng} />
 *
 * Until step 3 happens the app runs exactly as it does now: the photo displays
 * with an obviously-labelled placeholder region, the effective pose is shown in
 * full, and the export button is disabled with the honest reason that there is
 * nothing to export. No stand-in peaks are ever drawn, because a plausible fake
 * summit is the one thing that could be mistaken for a working pipeline.
 */

import type { CameraPose, Observer } from '../core/types';

/** The photograph's pixel size. Field names match `OverlayScene`. */
export interface PhotoFrame {
  widthPx: number;
  heightPx: number;
}

/** Everything the pipeline needs to produce an overlay for one photo. */
export interface OverlayRequest {
  readonly frame: PhotoFrame;
  /** Where the camera stood. All four fields resolved — never partial. */
  readonly observer: Observer;
  /** Orientation and optics, WITH the trim sliders already applied. */
  readonly pose: CameraPose;
  /**
   * Draw summits that are self-occluded — hidden behind a shoulder of their own
   * hill — de-emphasised (decision D8). The builder passes the flag straight
   * through to the renderer as `OverlayPeak.visibility`; when false those peaks
   * are simply left out of the scene.
   *
   * There is no flag for foreground-occluded peaks and there must not be one:
   * the pipeline never offers them, because a label on a mountain that is
   * behind a different hill is a fabrication, not a display option.
   */
  readonly showObscuredPeaks: boolean;
  /** Aborted when the pose changes again before the previous run finishes. */
  readonly signal?: AbortSignal;
}

/** What comes back: an SVG overlay sized to the frame, plus what it labelled. */
export interface OverlayResult {
  /**
   * A complete `<svg>` document string whose viewBox is
   * `0 0 frame.widthPx frame.heightPx` — i.e. exactly what `buildOverlaySvg`
   * already returns. The app scales it over the photo with CSS.
   */
  readonly svgMarkup: string;
  /** Names of the peaks labelled, in the order drawn. May be empty. */
  readonly peakNames: readonly string[];
}

/** The pipeline call. Rejects rather than returning a partial overlay. */
export type OverlayBuilder = (request: OverlayRequest) => Promise<OverlayResult>;

/** What the PNG compositor (P4.2) needs to flatten photo + overlay. */
export interface ExportRequest {
  /** Object URL (or data URL) of the photo as loaded into the page. */
  readonly photoUrl: string;
  /** The overlay to composite over it — `OverlayResult.svgMarkup`. */
  readonly svgMarkup: string;
  /** Output size; the photo's natural pixel size. */
  readonly frame: PhotoFrame;
}

/** The compositor call: photo + overlay in, PNG blob out. */
export type PngExporter = (request: ExportRequest) => Promise<Blob>;

/** Suggested download filename: "photo.jpg" → "photo-annotated.png". */
export function annotatedFileName(sourceName: string): string {
  const stem = sourceName.replace(/\.[^./\\]+$/, '');
  return `${stem === '' ? 'photo' : stem}-annotated.png`;
}
