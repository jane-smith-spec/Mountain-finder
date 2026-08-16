/**
 * The pipeline's data contract: what goes in, what comes out.
 *
 * The pipeline is the only layer that knows about all the others. It is
 * deliberately NOT pure — it awaits an elevation source and a peak source — but
 * every one of those is INJECTED, so the whole thing runs offline against
 * fixtures with no network, no filesystem and no clock of its own.
 *
 * It returns data, never pixels. Rendering is `src/render`'s job, and the
 * horizon profile travels in the result precisely so the renderer can draw the
 * same skyline the visibility filter judged against.
 *
 * Naming follows src/core/types.ts, which is frozen: heights end in `M`, angles
 * end in `Deg`, `elevationM` is never an angle.
 */

import type {
  CameraPose,
  HorizonProfile,
  ImagePoint,
  LatLng,
  Observer,
  Peak,
  VisiblePeak,
} from '../core/types.js';
import type { SightlineOptions } from '../core/sightline.js';
import type { ElevationProvider } from '../providers/elevation.js';

/**
 * Where named summits come from. Narrower than `PeaksProvider`: the pipeline
 * only ever asks "what is near here", and it needs heights that are already
 * resolved, because a peak with no height cannot be sighted.
 *
 * `LocalPeakStore` implements both this and `PeaksProvider`.
 */
export interface PeakSource {
  peaksWithin(center: LatLng, radiusKm: number): Promise<readonly Peak[]>;
}

/** How the terrain is walked to build the horizon. */
export interface SweepConfig {
  /** Angular spacing of the sampling rays. */
  readonly bearingStepDeg: number;
  /** Spacing of samples along each ray, metres of ground distance. */
  readonly rangeStepM: number;
  /** Longest ground distance sampled along a ray. */
  readonly maxRangeKm: number;
  /** First ray's bearing. Default 0. */
  readonly startBearingDeg: number;
  /**
   * Angular width of the sweep. 360 (the default) is a full circle; a smaller
   * span sweeps only a sector, which is how a single-photo run avoids paying
   * for terrain behind the camera.
   */
  readonly spanDeg: number;
}

/** Everything tunable, all of it injected — including the clock. */
export interface PipelineConfig {
  readonly sweep?: Partial<SweepConfig>;
  /** Earth radius and refraction coefficient. Defaults to core's k = 0.13. */
  readonly sightline?: SightlineOptions;
  /**
   * Slack granted to a peak that falls below the modelled ridge line, degrees.
   * Default 0 — a peak must genuinely clear the terrain in front of it.
   */
  readonly toleranceDeg?: number;
  /**
   * How far out to ask the peak source for summits. Independent of the sweep:
   * Mount Rainier is 97 km from Kerry Park while the terrain that decides its
   * visibility is in the first kilometre. Default 200 km.
   */
  readonly peakRadiusKm?: number;
  /**
   * Peaks closer than this are dropped as "you are standing on it": their
   * bearing is meaningless and their altitude angle runs to ±90°. Default
   * 0.05 km. Dropped peaks are reported in `warnings`, never silently.
   */
  readonly minPeakDistanceKm?: number;
  /** Source of the timestamp on the result. Default `() => new Date()`. */
  readonly clock?: () => Date;
}

/** The fully defaulted configuration a run actually used. */
export interface ResolvedPipelineConfig {
  readonly sweep: SweepConfig;
  readonly sightline: SightlineOptions;
  readonly toleranceDeg: number;
  readonly peakRadiusKm: number;
  readonly minPeakDistanceKm: number;
}

/**
 * Where the camera stands.
 *
 * `groundElevationM` is optional on purpose: for most real viewpoints nobody
 * knows it, and the correct answer is to read it off the terrain tiles. That
 * IS the right use of SRTM — valley floors and broad terrain are accurate
 * (Zermatt reads its true 1608 m) — as opposed to summit heights, which must
 * come from the peak database.
 */
export interface ObserverRequest extends LatLng {
  readonly eyeHeightM: number;
  /** Skip the terrain lookup and use this. */
  readonly groundElevationM?: number;
  /** Used only if the terrain lookup returns no data. */
  readonly fallbackGroundElevationM?: number;
}

/** How the observer's ground height was settled. */
export type GroundElevationSource = 'supplied' | 'terrain' | 'fallback';

export interface ObserverResolution {
  readonly observer: Observer;
  readonly groundElevationSource: GroundElevationSource;
  /** Present when the terrain was consulted: which tile answered, and how. */
  readonly terrainNote?: string;
}

/** One peak carried all the way through the pipeline, verdict attached. */
export interface AnnotatedPeak extends VisiblePeak {
  /** Did it clear the terrain standing in front of it? */
  readonly visible: boolean;
  /**
   * Where it lands on the photograph, normalised. Computed for occluded peaks
   * too — a renderer showing "what you would see if the ridge were not there"
   * needs it, and `ImagePoint.inFrame` already says whether it is on-image.
   */
  readonly image: ImagePoint;
  /**
   * The nearest terrain step that reaches this peak's altitude angle, when one
   * does. Absent for a visible peak. This is what turns "not labelled" into
   * "hidden by a 250 m shoulder 1.2 km away".
   */
  readonly occludedBy?: OccluderNote;
}

/** The piece of terrain that hides a peak. */
export interface OccluderNote {
  readonly distanceKm: number;
  readonly elevationM: number;
  readonly altitudeDeg: number;
  /** Bearing of the profile ray this step was read from. */
  readonly rayBearingDeg: number;
}

/** What the terrain walk actually managed to sample. */
export interface SweepReport {
  readonly raysRequested: number;
  /** Rays that produced at least one usable elevation, hence a profile point. */
  readonly raysWithTerrain: number;
  readonly samplesRequested: number;
  readonly samplesWithElevation: number;
  /** Distinct reasons points came back empty, e.g. `missing-tile`. */
  readonly gaps: readonly string[];
}

/** The pipeline's output: an annotated scene, not an image. */
export interface AnnotatedScene {
  readonly observer: Observer;
  readonly observerResolution: ObserverResolution;
  readonly camera: CameraPose;
  /** The skyline, for the renderer to draw and the filter to judge against. */
  readonly horizon: HorizonProfile;
  readonly sweep: SweepReport;
  /** Every peak considered, nearest first, each with its verdict. */
  readonly peaks: readonly AnnotatedPeak[];
  /** The subset that cleared the terrain in front of it, in the same order. */
  readonly visible: readonly AnnotatedPeak[];
  /** The subset that did not. */
  readonly occluded: readonly AnnotatedPeak[];
  /** Anything the caller should know: missing tiles, dropped peaks, empty rays. */
  readonly warnings: readonly string[];
  readonly config: ResolvedPipelineConfig;
  /** From the injected clock, so a test run is reproducible. */
  readonly generatedAt: Date;
}

/** One end-to-end run. */
export interface AnnotateSceneRequest {
  readonly observer: ObserverRequest;
  readonly camera: CameraPose;
  readonly elevation: ElevationProvider;
  readonly peaks: PeakSource;
  readonly config?: PipelineConfig;
  readonly signal?: AbortSignal;
}
