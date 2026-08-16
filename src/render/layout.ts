/**
 * The layout pass: scene → pixel geometry, with no strings involved.
 *
 * Splitting layout from serialisation is what makes the hard part of P4.1
 * testable. A test that wants to know where the Matterhorn's flag lands asks
 * {@link layoutOverlay} for a number and compares it against a hand-computed
 * one; it does not go fishing for a substring in an SVG document. The SVG
 * builder on the other side of this boundary has no geometry left in it worth
 * getting wrong.
 *
 * ## Label collision avoidance
 *
 * On a real skyline peaks cluster. A 60° frame over the Pennine Alps can put
 * six named summits inside 200 px, and the naive overlay — every label pinned
 * the same distance above its dot — renders them as one illegible smear. So
 * overlap is the default outcome, and avoiding it is a designed behaviour with
 * a stated rule rather than a lucky one:
 *
 * 1. Markers are placed in a **deterministic order**: left to right by
 *    projected summit x, ties broken by peak id. Deterministic ordering is the
 *    whole game — the same scene must lay out identically every run, or a
 *    snapshot test is worthless and a rendered PNG is unreproducible.
 * 2. Each marker gets a **reserved box**: the label's estimated extent plus
 *    padding, centred on its pole and clamped inside the frame margins.
 * 3. A marker takes the **first free candidate placement** from a fixed list:
 *    pole lengths increasing by one `stackStepPx` at a time, first upward
 *    (levels 0…N−1), then downward. Upward is preferred because summits sit
 *    against sky and the space above them is usually empty; downward exists so
 *    that a peak near the top edge of the frame, where there is no room above,
 *    still gets a legible label instead of one jammed against the border.
 * 4. `stackStepPx` defaults to a full label height plus padding, so a level
 *    bump clears a neighbour **whose summit sits at the same height**. It does
 *    not clear every neighbour unconditionally: each pole is measured from its
 *    own summit, so where summits differ in y a bump can still land a label
 *    partly across a lower peak's. That is why step 3 tests the actual boxes
 *    instead of trusting the arithmetic — the search simply moves to the next
 *    level, and a level can be skipped. What is guaranteed is the *outcome*
 *    (disjoint boxes), never a particular level index.
 * 5. If nothing is free, the marker is placed at its first in-frame candidate
 *    and flagged `overlapped`. The overlay never drops a peak to keep itself
 *    tidy — losing a summit would be a lie about what is in the photograph —
 *    it reports the crowding instead.
 *
 * The consequence is a visible signature that tests assert on directly: a
 * cluster of near-collinear peaks comes out as a staircase of pole lengths
 * (with the occasional skipped rung), and two peaks far apart in x both stay
 * at level 0.
 */

import { interpolateHorizonAltitudeDeg } from '../core/horizon';
import { cameraAxes, projectToImage } from '../core/projection';
import type { VisiblePeak } from '../core/types';
import { clipPolylineToFrame, isInFrontOfCamera } from './geometry';
import { estimateTextWidthPx } from './text-metrics';
import type {
  LabelDirection,
  OverlayLayout,
  OverlayOptions,
  OverlayScene,
  PeakMarker,
  PointPx,
  RectPx,
  ResolvedOverlayOptions,
} from './types';

/** Line height as a multiple of font size. */
const LINE_HEIGHT_EM = 1.15;
/** Baseline offset from the top of a line, as a multiple of font size. */
const BASELINE_EM = 0.9;

/**
 * Half-width of the bearing window swept for the horizon line, as a multiple of
 * the horizontal field of view.
 *
 * Bigger than the obvious 0.5 because the frame's horizontal extent is only the
 * hFOV along the optical axis. Tilt the camera up and the top corners reach
 * *outside* that bearing range — a rectilinear frame is a rectangle on a plane,
 * not a wedge of bearings — so sweeping exactly the hFOV would leave the
 * skyline stopping short of the corners on any pitched shot. Sweeping half as
 * wide again and clipping to the frame costs a few dozen samples and removes
 * the whole class of problem.
 */
const HORIZON_SWEEP_FACTOR = 0.75;

/** Hard cap on the sweep half-width. Beyond this the tangent blows up. */
const HORIZON_SWEEP_MAX_HALF_DEG = 85;

/** Height of a label's reserved box for the given fonts and padding. */
export function labelBlockHeightPx(
  nameFontPx: number,
  detailFontPx: number,
  labelPaddingPx: number,
): number {
  return 2 * labelPaddingPx + LINE_HEIGHT_EM * (nameFontPx + detailFontPx);
}

/**
 * Fill in every unset option. Defaults scale with the image so a 1200 px
 * preview and a 4000 px export are the same picture at different sizes.
 */
export function resolveOverlayOptions(
  scene: OverlayScene,
  options: OverlayOptions = {},
): ResolvedOverlayOptions {
  const nameFontPx = options.nameFontPx ?? Math.max(12, Math.round(scene.heightPx * 0.022));
  const detailFontPx = options.detailFontPx ?? Math.max(9, Math.round(nameFontPx * 0.72));
  const labelPaddingPx = options.labelPaddingPx ?? Math.max(2, Math.round(nameFontPx * 0.35));
  const blockHeightPx = labelBlockHeightPx(nameFontPx, detailFontPx, labelPaddingPx);

  return {
    horizonSampleCount: options.horizonSampleCount ?? 240,
    showHorizon: options.showHorizon ?? true,
    nameFontPx,
    detailFontPx,
    basePoleLengthPx:
      options.basePoleLengthPx ?? Math.max(18, Math.round(scene.heightPx * 0.06)),
    // One whole label plus padding: a level bump is guaranteed to clear a
    // same-column neighbour rather than merely nudge it.
    stackStepPx: options.stackStepPx ?? Math.round(blockHeightPx + labelPaddingPx),
    maxStackLevels: options.maxStackLevels ?? 6,
    labelPaddingPx,
    labelGapPx: options.labelGapPx ?? 3,
    frameMarginPx: options.frameMarginPx ?? Math.max(2, Math.round(scene.widthPx * 0.01)),
    summitDotRadiusPx: options.summitDotRadiusPx ?? Math.max(2.5, nameFontPx * 0.13),
  };
}

/** Elevation and distance, the second line of a label. */
export function formatPeakDetail(peak: VisiblePeak): string {
  return `${Math.round(peak.elevationM)} m · ${peak.distanceKm.toFixed(1)} km`;
}

/** Strict rectangle intersection: rectangles that merely touch do not overlap. */
export function rectsOverlap(a: RectPx, b: RectPx): boolean {
  return (
    a.xPx < b.xPx + b.widthPx &&
    b.xPx < a.xPx + a.widthPx &&
    a.yPx < b.yPx + b.heightPx &&
    b.yPx < a.yPx + a.heightPx
  );
}

function clamp(value: number, low: number, high: number): number {
  if (high < low) return low;
  return Math.min(Math.max(value, low), high);
}

/**
 * Sample the terrain skyline across the frame and clip it to the image.
 *
 * The skyline is sampled uniformly in *bearing*, not in image column, because
 * bearing is what the horizon profile is a function of. Under roll or pitch the
 * projected curve is not a function of column at all, so a column-wise sweep
 * would have no well-defined answer to sample; a bearing sweep always does.
 */
export function buildHorizonPolylines(
  scene: OverlayScene,
  options: ResolvedOverlayOptions,
): readonly (readonly PointPx[])[] {
  if (!options.showHorizon || scene.horizon.length === 0) return [];
  const sampleCount = Math.max(2, Math.round(options.horizonSampleCount));

  const axes = cameraAxes(scene.pose);
  const halfWindowDeg = Math.min(
    scene.pose.hFovDeg * HORIZON_SWEEP_FACTOR,
    HORIZON_SWEEP_MAX_HALF_DEG,
  );
  const stepDeg = (2 * halfWindowDeg) / sampleCount;

  const samples: (PointPx | undefined)[] = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const bearingDeg = scene.pose.headingDeg - halfWindowDeg + index * stepDeg;
    const altitudeDeg = interpolateHorizonAltitudeDeg(scene.horizon, bearingDeg);
    if (!isInFrontOfCamera(scene.pose, bearingDeg, altitudeDeg, axes)) {
      samples.push(undefined);
      continue;
    }
    const point = projectToImage(scene.pose, bearingDeg, altitudeDeg);
    samples.push({ xPx: point.x * scene.widthPx, yPx: point.y * scene.heightPx });
  }

  return clipPolylineToFrame(samples, scene.widthPx, scene.heightPx);
}

/** A summit that projected inside the frame, before any label placement. */
interface Sighting {
  peak: VisiblePeak;
  summitPx: PointPx;
  nameText: string;
  detailText: string;
  labelWidthPx: number;
  labelHeightPx: number;
}

/** One placement being considered for a label. */
interface Candidate {
  direction: LabelDirection;
  level: number;
  boxPx: RectPx;
  poleTipPx: PointPx;
  /** False when the box had to be clamped vertically to stay inside the frame. */
  fitsVertically: boolean;
}

function makeCandidate(
  sighting: Sighting,
  direction: LabelDirection,
  level: number,
  scene: OverlayScene,
  options: ResolvedOverlayOptions,
): Candidate {
  const poleLengthPx = options.basePoleLengthPx + level * options.stackStepPx;
  const sign = direction === 'up' ? -1 : 1;
  const desiredTipYPx = sighting.summitPx.yPx + sign * poleLengthPx;

  const desiredBoxTopYPx =
    direction === 'up'
      ? desiredTipYPx - options.labelGapPx - sighting.labelHeightPx
      : desiredTipYPx + options.labelGapPx;

  const minTopYPx = options.frameMarginPx;
  const maxTopYPx = Math.max(
    minTopYPx,
    scene.heightPx - options.frameMarginPx - sighting.labelHeightPx,
  );
  const boxTopYPx = clamp(desiredBoxTopYPx, minTopYPx, maxTopYPx);

  const minLeftXPx = options.frameMarginPx;
  const maxLeftXPx = Math.max(
    minLeftXPx,
    scene.widthPx - options.frameMarginPx - sighting.labelWidthPx,
  );
  const boxLeftXPx = clamp(
    sighting.summitPx.xPx - sighting.labelWidthPx / 2,
    minLeftXPx,
    maxLeftXPx,
  );

  // When the box was clamped, the pole follows the label rather than the other
  // way round, so the flag stays visually attached to what it names.
  const tipYPx =
    direction === 'up'
      ? boxTopYPx + sighting.labelHeightPx + options.labelGapPx
      : boxTopYPx - options.labelGapPx;

  return {
    direction,
    level,
    boxPx: {
      xPx: boxLeftXPx,
      yPx: boxTopYPx,
      widthPx: sighting.labelWidthPx,
      heightPx: sighting.labelHeightPx,
    },
    poleTipPx: { xPx: sighting.summitPx.xPx, yPx: tipYPx },
    fitsVertically: Math.abs(boxTopYPx - desiredBoxTopYPx) < 1e-9,
  };
}

function markerFromCandidate(
  sighting: Sighting,
  candidate: Candidate,
  overlapped: boolean,
  options: ResolvedOverlayOptions,
): PeakMarker {
  const textTopYPx = candidate.boxPx.yPx + options.labelPaddingPx;
  return {
    peak: sighting.peak,
    summitPx: sighting.summitPx,
    poleTipPx: candidate.poleTipPx,
    labelCentreXPx: candidate.boxPx.xPx + candidate.boxPx.widthPx / 2,
    nameBaselineYPx: textTopYPx + BASELINE_EM * options.nameFontPx,
    detailBaselineYPx:
      textTopYPx + LINE_HEIGHT_EM * options.nameFontPx + BASELINE_EM * options.detailFontPx,
    labelBoxPx: candidate.boxPx,
    stackLevel: candidate.level,
    direction: candidate.direction,
    overlapped,
    nameText: sighting.nameText,
    detailText: sighting.detailText,
  };
}

/**
 * Lay a scene out into pixel geometry.
 *
 * Peaks that project outside the frame — or behind the camera, which
 * `projectToImage` also reports as out of frame — are never drawn. They are
 * returned in `offFramePeaks` so the caller can account for them.
 */
export function layoutOverlay(
  scene: OverlayScene,
  options: OverlayOptions = {},
): OverlayLayout {
  const resolved = resolveOverlayOptions(scene, options);

  const sightings: Sighting[] = [];
  const offFramePeaks: VisiblePeak[] = [];

  for (const peak of scene.peaks) {
    const point = projectToImage(scene.pose, peak.bearingDeg, peak.altitudeDeg);
    if (!point.inFrame) {
      offFramePeaks.push(peak);
      continue;
    }
    const nameText = peak.name;
    const detailText = formatPeakDetail(peak);
    const textWidthPx = Math.max(
      estimateTextWidthPx(nameText, resolved.nameFontPx),
      estimateTextWidthPx(detailText, resolved.detailFontPx),
    );
    sightings.push({
      peak,
      summitPx: { xPx: point.x * scene.widthPx, yPx: point.y * scene.heightPx },
      nameText,
      detailText,
      labelWidthPx: textWidthPx + 2 * resolved.labelPaddingPx,
      labelHeightPx: labelBlockHeightPx(
        resolved.nameFontPx,
        resolved.detailFontPx,
        resolved.labelPaddingPx,
      ),
    });
  }

  // Deterministic placement order: left to right, ties broken by id with a
  // plain code-unit comparison (never `localeCompare`, whose ordering depends
  // on the host's locale data and would make the same scene lay out
  // differently on a different machine).
  sightings.sort((a, b) => {
    if (a.summitPx.xPx !== b.summitPx.xPx) return a.summitPx.xPx - b.summitPx.xPx;
    if (a.peak.id < b.peak.id) return -1;
    if (a.peak.id > b.peak.id) return 1;
    return 0;
  });

  const levels = Math.max(1, Math.round(resolved.maxStackLevels));
  const directions: readonly LabelDirection[] = ['up', 'down'];
  const placed: RectPx[] = [];
  const markers: PeakMarker[] = [];

  for (const sighting of sightings) {
    let fallback: Candidate | undefined;
    let chosen: Candidate | undefined;

    for (const direction of directions) {
      for (let level = 0; level < levels && chosen === undefined; level += 1) {
        const candidate = makeCandidate(sighting, direction, level, scene, resolved);
        if (!candidate.fitsVertically) continue;
        fallback ??= candidate;
        if (!placed.some((box) => rectsOverlap(box, candidate.boxPx))) {
          chosen = candidate;
        }
      }
      if (chosen !== undefined) break;
    }

    // Nothing fitted in the frame at all (a label taller than the photo, or
    // margins that swallow it): fall back to the clamped level-0 placement,
    // which is always defined.
    const candidate =
      chosen ?? fallback ?? makeCandidate(sighting, 'up', 0, scene, resolved);
    markers.push(markerFromCandidate(sighting, candidate, chosen === undefined, resolved));
    placed.push(candidate.boxPx);
  }

  return {
    widthPx: scene.widthPx,
    heightPx: scene.heightPx,
    horizonPolylinesPx: buildHorizonPolylines(scene, resolved),
    markers,
    offFramePeaks,
    options: resolved,
  };
}
