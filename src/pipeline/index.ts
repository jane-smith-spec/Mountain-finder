/**
 * The orchestration layer (BUILD 2).
 *
 * One entry point per input shape:
 *
 *   annotateScene(request)   a stated viewpoint + camera pose
 *   annotatePhoto(request)   a photograph's EXIF, with overrides and a terrain
 *                            lookup for the ground height
 *
 * Both return an {@link AnnotatedScene}: observer, horizon profile, peaks with
 * verdicts, and each peak's normalised image position. Data, not pixels —
 * `src/render` turns it into an overlay.
 *
 * Node-only helpers for loading committed terrain windows live in
 * `./testing/case-terrain.js` and are imported separately, exactly as
 * `tile-directory.js` is on the provider side.
 */

export { annotateScene, resolveConfig, DEFAULT_PEAK_RADIUS_KM, DEFAULT_MIN_PEAK_DISTANCE_KM } from './annotate.js';
export { annotatePhoto } from './photo.js';
export type { AnnotatePhotoRequest, AnnotatePhotoResult } from './photo.js';

export { PipelineError, isPipelineError, throwIfAborted } from './errors.js';
export type { PipelineErrorCode } from './errors.js';

export { eyeElevationM, resolveObserver } from './observer.js';

export {
  DEFAULT_SWEEP,
  buildTerrainRays,
  rayPoints,
  resolveSweep,
  sweepBearingsDeg,
  sweepRangesM,
} from './terrain.js';
export type { TerrainSweepResult } from './terrain.js';

export {
  classifyPeakOcclusion,
  describeOccluder,
  nearestProfilePoint,
  nearestRay,
} from './occlusion.js';

export type {
  AnnotateSceneRequest,
  AnnotatedPeak,
  AnnotatedScene,
  GroundElevationSource,
  ObserverRequest,
  ObserverResolution,
  OccluderNote,
  PeakSource,
  PipelineConfig,
  ResolvedPipelineConfig,
  SweepConfig,
  SweepReport,
} from './types.js';
