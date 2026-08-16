/**
 * THE SEAM — where the app hands off to the pipeline and the renderer.
 *
 * ## Why this file exists
 *
 * P5.1 (this app) was built in parallel with P4 (renderer) and the pipeline, so
 * the component tree imports NOTHING from `src/render` or `src/pipeline`.
 * Instead it states, in types, exactly what it will call and exactly what it
 * expects back; both implementations arrive as props on `<App>`. That is still
 * true now that they exist, and it is worth keeping: the app can be rendered in
 * a test with no pipeline at all, and there is no hidden coupling anywhere
 * behind this line.
 *
 * ## What is on the other side of it (TODO.md Q1, done)
 *
 *   OverlayBuilder   src/app/overlay-builder.ts
 *                      observer + pose + frame
 *                        → coverage check          src/providers/http-terrain-store
 *                        → annotateScene           src/pipeline
 *                        → layoutOverlay + SVG     src/render
 *                        → { svgMarkup, peakNames, notes }
 *   PngExporter      src/app/composite-export.ts → src/render/composite.ts
 *
 * Both are constructed in `main.tsx`, which is the only file that knows about
 * all three layers at once.
 *
 * `OverlayRequest` deliberately carries the same things `OverlayScene`
 * (src/render/types.ts) needs minus `horizon` and `peaks`, which are precisely
 * what the pipeline computes: `widthPx`/`heightPx` are named identically, and
 * `pose` is a `CameraPose` from `src/core/types` with the trim ALREADY APPLIED.
 * Nothing is reshaped at the boundary.
 *
 * With no builder supplied the app still runs: the photo displays with an
 * obviously-labelled placeholder region, the effective pose is shown in full,
 * and the export button is disabled with the honest reason that there is
 * nothing to export. No stand-in peaks are ever drawn, because a plausible fake
 * summit is the one thing that could be mistaken for a working pipeline.
 *
 * A builder that CANNOT answer rejects, and the app shows the rejection
 * verbatim — see `noTerrainMessage`. Rejecting is not a failure of the seam; it
 * is the seam refusing to let "we have no data here" be drawn as "there is
 * nothing to see here".
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
  /**
   * Anything the viewer needs in order to read an EMPTY or SPARSE overlay
   * correctly: summits that fell outside the frame, summits withheld because a
   * nearer hill hides them, bearings where terrain data ran out, or a peak
   * database with nothing in this region at all.
   *
   * This exists because "no labels" is ambiguous — it can mean "nothing is
   * visible from here" or "we know nothing about here" — and the app must never
   * let the second be read as the first.
   */
  readonly notes?: readonly string[];
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
