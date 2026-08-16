/**
 * The photograph entry point: EXIF in, annotated scene out.
 *
 * `src/exif` already turns a file's tags into nine pose fields, each either
 * resolved (with provenance) or explicitly `needs-manual`. This module is the
 * join between that and the geometry run, and it exists to do exactly one thing
 * that neither side can do alone:
 *
 *   **fill `groundElevationM` from the terrain.**
 *
 * A photo carries GPS latitude and longitude, and sometimes a GPS altitude that
 * is wrong by tens of metres. It never carries the height of the ground under
 * the photographer. That number is the one thing the elevation tiles are
 * genuinely good at (MISSION.md: Zermatt reads its true 1608 m), so when the
 * pose is missing it, this module looks it up and re-resolves the pose with the
 * answer in place.
 *
 * Everything else is left alone. A missing heading stays missing — guessing
 * which way a camera pointed would put every label in the wrong place while
 * looking entirely plausible, which is the failure mode this project exists to
 * avoid. The caller gets `status: 'needs-manual'` and the exact field list.
 *
 * Decoding the JPEG is NOT done here: `extractPhotoExif` takes bytes, and bytes
 * come from a file input or a filesystem, both of which are the app's business.
 * That keeps this module runnable in a browser and in vitest unchanged.
 */

import type { PhotoExif, PoseField, PoseInputs, ResolveOptions } from '../exif/types.js';
import { resolvePose, type PoseResolution } from '../exif/resolve.js';
import type { ElevationProvider } from '../providers/elevation.js';

import { annotateScene } from './annotate.js';
import type { AnnotatedScene, PeakSource, PipelineConfig } from './types.js';

export interface AnnotatePhotoRequest {
  /** What the file claims. Produce it with `extractPhotoExif`. */
  readonly exif: PhotoExif;
  /** Values typed into an override panel. Highest precedence. */
  readonly overrides?: PoseInputs;
  /** Magnetic declination, assumed direction ref, documented defaults. */
  readonly resolveOptions?: ResolveOptions;
  readonly elevation: ElevationProvider;
  readonly peaks: PeakSource;
  readonly config?: PipelineConfig;
  readonly signal?: AbortSignal;
}

/** Either the scene, or the precise list of what the photo could not supply. */
export type AnnotatePhotoResult =
  | {
      readonly status: 'ok';
      readonly pose: PoseResolution;
      readonly scene: AnnotatedScene;
      /** True when the ground height came from the terrain rather than the file. */
      readonly groundElevationFromTerrain: boolean;
    }
  | {
      readonly status: 'needs-manual';
      readonly pose: PoseResolution;
      readonly missing: readonly PoseField[];
    };

/**
 * Resolve a photo's pose — consulting the terrain for the ground height — and
 * run the pipeline if the pose is complete.
 */
export async function annotatePhoto(request: AnnotatePhotoRequest): Promise<AnnotatePhotoResult> {
  const resolveOptions = request.resolveOptions ?? {};
  let pose = resolvePose(request.exif, request.overrides, resolveOptions);
  let groundElevationFromTerrain = false;

  const groundUnknown = pose.missing.includes('groundElevationM');
  const lat = valueOf(pose, 'lat');
  const lon = valueOf(pose, 'lon');

  if (groundUnknown && lat !== undefined && lon !== undefined) {
    const [reading] = await request.elevation.fetchElevations([{ lat, lon }], {
      signal: request.signal,
    });
    if (reading !== undefined && reading.elevationM !== null) {
      // Supplied as a DEFAULT, not as a user value: a figure typed into the
      // override panel must still win over the DEM, and the provenance the UI
      // shows should say "assumed from terrain", not "you told me this".
      pose = resolvePose(request.exif, request.overrides, {
        ...resolveOptions,
        defaults: { ...resolveOptions.defaults, groundElevationM: reading.elevationM },
      });
      groundElevationFromTerrain = true;
    }
  }

  if (!pose.complete || pose.observer === undefined || pose.cameraPose === undefined) {
    return { status: 'needs-manual', pose, missing: pose.missing };
  }

  const scene = await annotateScene({
    observer: {
      lat: pose.observer.lat,
      lon: pose.observer.lon,
      eyeHeightM: pose.observer.eyeHeightM,
      groundElevationM: pose.observer.groundElevationM,
    },
    camera: pose.cameraPose,
    elevation: request.elevation,
    peaks: request.peaks,
    ...(request.config === undefined ? {} : { config: request.config }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });

  return { status: 'ok', pose, scene, groundElevationFromTerrain };
}

function valueOf(pose: PoseResolution, field: PoseField): number | undefined {
  const resolved = pose.fields[field];
  return resolved.status === 'resolved' ? resolved.value : undefined;
}
