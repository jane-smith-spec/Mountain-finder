/**
 * Ingestion-boundary types for photo metadata.
 *
 * Naming follows src/core/types.ts (FROZEN CONTRACT):
 *   ...M    metres / a height        ...Deg  an angle
 *   bearing / heading  = compass angle, TRUE north referenced
 *   altitude           = vertical angle, never a height
 *
 * Everything here is optional-by-default on purpose: real photos arrive with
 * arbitrary subsets of this data, and the pipeline must be able to say
 * "I do not know" rather than invent a value.
 */

/**
 * EXIF GPSImgDirectionRef. 'T' = direction is referenced to true north,
 * 'M' = referenced to magnetic north. Core only ever accepts true bearings, so
 * an 'M' reading is unusable until a magnetic declination is supplied.
 */
export type DirectionRef = 'T' | 'M';

/** Everything the extractor could find in one photo's EXIF. All fields optional. */
export interface PhotoExif {
  /** Signed decimal degrees, negative in the southern hemisphere. */
  lat?: number;
  /** Signed decimal degrees, negative in the western hemisphere. */
  lon?: number;
  /**
   * Camera altitude above sea level, sign already applied from GPSAltitudeRef
   * (ref 1 = below sea level). Phone GPS altitude is frequently absent and
   * routinely tens of metres wrong — treat it as a hint, not a measurement.
   */
  gpsAltitudeM?: number;
  /** GPSImgDirection as stored, normalised to [0, 360). NOT yet true-north referenced. */
  imgDirectionDeg?: number;
  /** Whether `imgDirectionDeg` is true- or magnetic-north referenced. Absent = unknown. */
  imgDirectionRef?: DirectionRef;
  /** Physical focal length in millimetres. Useless for FOV without the sensor size. */
  focalLengthMm?: number;
  /** FocalLengthIn35mmFormat — the one that yields a field of view on its own. */
  focalLength35mmMm?: number;
  imageWidthPx?: number;
  imageHeightPx?: number;
  /** Derived from `focalLength35mmMm`; present only when that was present. */
  hFovDeg?: number;
  /** Derived from `hFovDeg` and the pixel aspect ratio; needs both. */
  vFovDeg?: number;
}

/** The fields that must all be known before a photo can be projected. */
export const POSE_FIELDS = [
  'lat',
  'lon',
  'groundElevationM',
  'eyeHeightM',
  'headingDeg',
  'pitchDeg',
  'rollDeg',
  'hFovDeg',
  'vFovDeg',
] as const;

export type PoseField = (typeof POSE_FIELDS)[number];

/** Where a resolved value came from. Precedence: user > exif > default. */
export type FieldSource = 'user' | 'exif' | 'default';

/** Why a field could not be resolved. Every one of these is a UI prompt. */
export type MissingReason =
  /** The photo simply does not carry this tag (messaging apps strip all of them). */
  | 'absent-from-exif'
  /** GPSImgDirection is magnetic and no magnetic declination was supplied. */
  | 'magnetic-declination-required'
  /** GPSImgDirection present but GPSImgDirectionRef absent — true or magnetic is unknowable. */
  | 'direction-reference-unknown'
  /** Only a physical focal length is known; without the sensor size there is no FOV. */
  | 'no-35mm-equivalent-focal-length'
  /** vFov needs the image aspect ratio and no pixel dimensions are known. */
  | 'image-dimensions-unknown'
  /** GPS altitude is the camera's altitude; splitting it needs an eye height. */
  | 'eye-height-required'
  /**
   * A value WAS supplied and lies outside what the field can mean — latitude
   * 475, a negative eye height, a 200° field of view. Distinct from
   * 'absent-from-exif' on purpose: the app never replaces an impossible value
   * with a plausible one from a lower precedence layer, because that would
   * hand back a confident pose nobody asked for. See resolve.ts for the
   * domains and for why heading, roll, pitch and elevation have none.
   */
  | 'out-of-range';

/** A single pose field: either resolved (with provenance) or explicitly unknown. */
export type ResolvedField =
  | { readonly status: 'resolved'; readonly value: number; readonly source: FieldSource }
  | { readonly status: 'needs-manual'; readonly reason: MissingReason };

/**
 * Values supplied by a human (override panel) or as documented assumptions.
 * Image dimensions are included because a caller that decoded the photo knows
 * them even when EXIF does not.
 */
export interface PoseInputs {
  lat?: number;
  lon?: number;
  groundElevationM?: number;
  eyeHeightM?: number;
  /** TRUE north referenced. Overrides any EXIF direction, magnetic or not. */
  headingDeg?: number;
  pitchDeg?: number;
  rollDeg?: number;
  hFovDeg?: number;
  vFovDeg?: number;
  imageWidthPx?: number;
  imageHeightPx?: number;
}

export interface ResolveOptions {
  /**
   * Magnetic declination in degrees at the shooting location and date
   * (east positive): trueBearing = magneticBearing + declination.
   *
   * Supplying it is the CALLER's job — this module deliberately ships no
   * geomagnetic model. Without it, a magnetic GPSImgDirection stays unusable
   * rather than being silently passed off as true north.
   */
  magneticDeclinationDeg?: number;
  /**
   * What to assume when GPSImgDirectionRef is missing entirely. Unset means
   * "assume nothing" and the heading is flagged for manual input.
   */
  assumeDirectionRefWhenMissing?: DirectionRef;
  /** Lowest-precedence values, recorded with source 'default'. See STANDARD_DEFAULTS. */
  defaults?: PoseInputs;
}
