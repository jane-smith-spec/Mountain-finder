/**
 * Photo ingestion boundary: EXIF in, `Observer` + `CameraPose` out.
 *
 * Two steps, deliberately separate:
 *
 *   extractPhotoExif(photo)          what the file actually claims (P3.1)
 *   resolvePose(exif, overrides, …)  merged with user input, gaps named (P3.2)
 *
 * This is the only place magnetic bearings exist. Core receives true-north
 * headings or nothing at all.
 */

export { extractPhotoExif, normaliseBearingDeg, photoExifFromTags, type ExifInput } from './extract';
export { FULL_FRAME_WIDTH_MM, hFovDegFromFocalLength35mm, vFovDegFromHFov } from './fov';
export { resolvePose, STANDARD_DEFAULTS, type PoseResolution } from './resolve';
export {
  POSE_FIELDS,
  type DirectionRef,
  type FieldSource,
  type MissingReason,
  type PhotoExif,
  type PoseField,
  type PoseInputs,
  type ResolveOptions,
  type ResolvedField,
} from './types';
