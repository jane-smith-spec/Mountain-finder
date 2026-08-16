/**
 * THE WIRING — app → pipeline → renderer (TODO.md Q1).
 *
 * `seam.ts` states what the app will call and what it expects back. This module
 * is the implementation of that contract, and it is the ONLY place where the
 * three halves of the system meet:
 *
 *     OverlayRequest (frame, observer, pose, showObscuredPeaks)
 *       → coverage check          src/providers/http-terrain-store
 *       → annotateScene           src/pipeline
 *       → layoutOverlay + SVG     src/render
 *       → OverlayResult (svgMarkup, peakNames, notes)
 *
 * It is pure in the sense that matters: every outside dependency — the terrain
 * source, the peak source, the tolerances — is injected, so this file is
 * exercised in `npm run check` against an analytic plane with no browser, no
 * server and no tiles, exactly as the pipeline is.
 *
 * ── WHY THE COVERAGE CHECK COMES FIRST ─────────────────────────────────────
 * A photograph taken where the app holds no elevation data must not produce an
 * empty overlay. An empty overlay reads as "no peaks are visible from here",
 * which is a claim, and it would be a fabricated one. So coverage is settled
 * BEFORE the pipeline runs, and its absence is raised as an error the UI shows
 * verbatim — naming the position, the tile that is missing and the command that
 * fetches it. That is the same discipline `src/exif/resolve.ts` applies to a
 * missing pose field: unknown is a state with a reason, never a zero.
 */

import type { CameraPose, LatLng, PeakVisibility } from '../core/types';
import { annotateScene } from '../pipeline/annotate';
import type { PeakSource, PipelineConfig, SweepConfig } from '../pipeline/types';
import type { ElevationProvider } from '../providers/elevation';
import type { TerrainCoverage } from '../providers/http-terrain-store';
import { buildOverlaySvgFromLayout, layoutOverlay } from '../render';
import type { OverlayLayout, OverlayOptions, OverlayScene } from '../render/types';
import type { OverlayBuilder, OverlayRequest, OverlayResult } from './seam';

/**
 * Terrain, as the app needs it: something to sample, and something that can say
 * whether a coordinate is covered at all without downloading a tile to find out.
 * `HttpTerrainStore` + `TileElevationProvider` satisfy this; so does a fake.
 */
export interface TerrainSource {
  readonly elevation: ElevationProvider;
  coverage(lat: number, lon: number): Promise<TerrainCoverage>;
}

export interface OverlayBuilderDeps {
  readonly terrain: TerrainSource;
  readonly peaks: PeakSource;
  /** Overrides merged over the defaults below. `sweep` is merged field-wise. */
  readonly config?: PipelineConfig;
  readonly overlayOptions?: OverlayOptions;
}

/**
 * How far the terrain walk goes, and how finely.
 *
 * 30 km covers the ridges that actually occlude: an occluder is nearly always
 * much closer than the summit it hides (Queen Anne Hill at 0.5 km hides Mount
 * Baker at 134 km). 90 m steps are three SRTM1 postings — enough to catch a
 * ridge crest, cheap enough that a 130° sector costs ~90 000 reads, which is
 * milliseconds against tiles already in memory.
 */
export const APP_SWEEP: Pick<SweepConfig, 'bearingStepDeg' | 'rangeStepM' | 'maxRangeKm'> = {
  bearingStepDeg: 0.5,
  rangeStepM: 90,
  maxRangeKm: 30,
};

/**
 * How far out summits are looked for.
 *
 * Larger than `APP_SWEEP.maxRangeKm` on purpose, and no longer a silent
 * over-claim (review 2, finding 2): the pipeline refuses a verdict on any peak
 * whose sightline it did not measure to the end, so a summit at 97 km comes
 * back in `scene.unmeasured` and is reported by `buildNotes` below rather than
 * drawn. Looking wide and refusing out loud is the useful half of the
 * asymmetry — it turns "the app has no terrain out there" into a note the user
 * can act on, where a narrow radius would simply never mention the mountain.
 *
 * The sweep stays at 30 km rather than growing to match: past that the app
 * would be sampling tiles it does not serve, which converts an honest refusal
 * into a ray full of holes and buys no answers. A deployment that does hold
 * 200 km of tiles raises `maxRangeKm` and gets real verdicts automatically,
 * because the refusal is keyed to terrain that was MEASURED, not to this number.
 */
export const APP_PEAK_RADIUS_KM = 200;

/** Raised when the app holds no elevation data where the photo was taken. */
export class TerrainUnavailableError extends Error {
  readonly coverage: TerrainCoverage;

  constructor(message: string, coverage: TerrainCoverage) {
    super(message);
    this.name = 'TerrainUnavailableError';
    this.coverage = coverage;
  }
}

function normaliseBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * The sector of terrain one photograph needs.
 *
 * Twice the horizontal field of view, centred on the heading. Sweeping the full
 * circle would spend three quarters of the work on terrain behind the camera;
 * sweeping exactly the field of view would leave the overlay's own horizon line
 * — which is drawn across 1.5 × hFOV — running off the end of the profile.
 * Double is the smallest simple rule that covers the drawn line with margin for
 * a trim slider nudge.
 */
export function sweepForPose(pose: CameraPose): Pick<SweepConfig, 'spanDeg' | 'startBearingDeg'> {
  const spanDeg = Math.min(360, pose.hFovDeg * 2);
  return {
    spanDeg,
    startBearingDeg: normaliseBearing(pose.headingDeg - spanDeg / 2),
  };
}

/**
 * Which peaks the overlay is entitled to draw.
 *
 * `labelled` is the pipeline's own answer to that question (visible plus
 * self-occluded, decision D8); the switch only ever narrows it to `visible`.
 * Foreground-occluded summits appear in neither list, so this function cannot
 * leak one however it is called.
 */
export function selectOverlayPeaks<T extends { readonly visibility?: PeakVisibility }>(
  scene: { readonly visible: readonly T[]; readonly labelled: readonly T[] },
  showObscuredPeaks: boolean,
): readonly T[] {
  return showObscuredPeaks ? scene.labelled : scene.visible;
}

/** Up to `limit` names, then "and N more" — for a one-line note. */
function nameList(names: readonly string[], limit = 4): string {
  if (names.length <= limit) return names.join(', ');
  return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`;
}

/**
 * The message shown when the app has no terrain for a photograph.
 *
 * Written to be actionable rather than apologetic: where the photo is, which
 * tile that needs, what the app does hold, and the command that closes the gap.
 * It also states plainly that nothing was drawn, because the failure mode being
 * guarded against is a blank overlay being read as "no peaks are visible".
 */
export function noTerrainMessage(coverage: TerrainCoverage, at: LatLng): string {
  const held =
    coverage.available.length === 0
      ? 'It is serving no terrain at all.'
      : `It is serving: ${nameList(coverage.available, 6)}.`;
  return (
    `No terrain data for ${at.lat.toFixed(5)}, ${at.lon.toFixed(5)}. ` +
    `That position needs SRTM tile ${coverage.tileName}, which this app does not have. ` +
    `${held} ` +
    `Run "npm run fetch:tiles -- ${coverage.tileName}" and serve data/tiles/ at /terrain/. ` +
    'Until then there is no horizon and no visibility verdict here, so nothing is drawn — ' +
    'an empty overlay would look like "no peaks are visible", which is a different claim.'
  );
}

function buildNotes(
  scene: {
    readonly peaks: readonly { readonly name: string }[];
    readonly foregroundOccluded: readonly { readonly name: string }[];
    readonly unmeasured: readonly { readonly name: string }[];
    readonly sweep: { readonly raysRequested: number; readonly raysWithTerrain: number };
    readonly config: { readonly peakRadiusKm: number; readonly sweep: { readonly maxRangeKm: number } };
  },
  layout: OverlayLayout,
  at: LatLng,
): string[] {
  const notes: string[] = [];

  if (scene.peaks.length === 0) {
    notes.push(
      `The bundled peak database holds no summit within ${scene.config.peakRadiusKm} km of ` +
        `${at.lat.toFixed(4)}, ${at.lon.toFixed(4)}, so nothing can be labelled here — that is ` +
        'a gap in the database, not a view without mountains.',
    );
  }
  if (layout.offFramePeaks.length > 0) {
    notes.push(
      `${layout.offFramePeaks.length} summit${layout.offFramePeaks.length === 1 ? '' : 's'} ` +
        `outside this frame (or behind the camera), not drawn: ` +
        `${nameList(layout.offFramePeaks.map((peak) => peak.name))}.`,
    );
  }
  if (scene.foregroundOccluded.length > 0) {
    notes.push(
      `${scene.foregroundOccluded.length} summit${scene.foregroundOccluded.length === 1 ? ' is' : 's are'} ` +
        `hidden behind nearer, different hills and ${scene.foregroundOccluded.length === 1 ? 'is' : 'are'} ` +
        `never labelled: ${nameList(scene.foregroundOccluded.map((peak) => peak.name))}.`,
    );
  }
  if (scene.unmeasured.length > 0) {
    // Not drawn and not claimed either way. Saying so is the point: these are
    // the long-range summits the app used to label off a fraction of their
    // sightline, and a user who sees the name can widen the terrain rather than
    // wonder why a mountain they can see is missing.
    notes.push(
      `${scene.unmeasured.length} summit${scene.unmeasured.length === 1 ? '' : 's'} stand ` +
        `farther out than the ${scene.config.sweep.maxRangeKm} km terrain sweep measured, so ` +
        `${scene.unmeasured.length === 1 ? 'it is' : 'they are'} neither labelled nor ruled out: ` +
        `${nameList(scene.unmeasured.map((peak) => peak.name))}.`,
    );
  }
  const blindRays = scene.sweep.raysRequested - scene.sweep.raysWithTerrain;
  if (blindRays > 0) {
    notes.push(
      `${blindRays} of ${scene.sweep.raysRequested} sampled bearings had no elevation data; ` +
        'the horizon line is interpolated across them and a summit there could be wrong.',
    );
  }
  return notes;
}

/** Build the app's `OverlayBuilder` over injected terrain and peak sources. */
export function createOverlayBuilder(deps: OverlayBuilderDeps): OverlayBuilder {
  return async (request: OverlayRequest): Promise<OverlayResult> => {
    const { observer, pose, frame } = request;

    const coverage = await deps.terrain.coverage(observer.lat, observer.lon);
    if (!coverage.covered) {
      throw new TerrainUnavailableError(noTerrainMessage(coverage, observer), coverage);
    }

    const config: PipelineConfig = {
      peakRadiusKm: APP_PEAK_RADIUS_KM,
      ...deps.config,
      sweep: { ...APP_SWEEP, ...sweepForPose(pose), ...deps.config?.sweep },
    };

    const scene = await annotateScene({
      // Every field is already resolved — `deriveSession` only builds an
      // `OverlayRequest` once `resolvePose` reports a complete pose — so the
      // pipeline is told the ground height rather than asked to look it up.
      observer: {
        lat: observer.lat,
        lon: observer.lon,
        eyeHeightM: observer.eyeHeightM,
        groundElevationM: observer.groundElevationM,
      },
      camera: pose,
      elevation: deps.terrain.elevation,
      peaks: deps.peaks,
      config,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });

    const overlayScene: OverlayScene = {
      widthPx: frame.widthPx,
      heightPx: frame.heightPx,
      pose,
      horizon: scene.horizon,
      peaks: selectOverlayPeaks(scene, request.showObscuredPeaks),
    };

    const layout = layoutOverlay(overlayScene, deps.overlayOptions ?? {});
    const notes = buildNotes(scene, layout, observer);

    return {
      svgMarkup: buildOverlaySvgFromLayout(layout),
      // The names actually DRAWN, read back off the layout rather than off the
      // scene: a peak the renderer dropped must not be announced as labelled.
      peakNames: layout.markers.map((marker) => marker.peak.name),
      ...(notes.length === 0 ? {} : { notes }),
    };
  };
}
