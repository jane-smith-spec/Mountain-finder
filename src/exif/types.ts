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
  /**
   * FocalLengthIn35mmFormat. Yields a field of view once the frame's shape is
   * known — see `fovDegFromFocalLength35mm` in fov.ts for which axis the
   * 35 mm gate's 36 mm side is attributed to, and why that is a convention.
   */
  focalLength35mmMm?: number;
  /**
   * EXIF Orientation as stored, 1–8. 1 is "as recorded"; 6 and 8 are the
   * quarter turns a phone writes when it is held upright. Values outside 1–8
   * are dropped rather than reported.
   */
  orientation?: number;
  /**
   * DISPLAYED pixel dimensions — Orientation already applied, so a photo stored
   * 4032x3024 with Orientation 6 reports 3024x4032. That is the frame the user
   * sees, the frame the browser decodes, and the frame the field of view and
   * the overlay projection are about. The raw stored pair is not reported: two
   * pixel dimensions that mean different things would be a trap.
   */
  imageWidthPx?: number;
  imageHeightPx?: number;
  /**
   * Derived from `focalLength35mmMm` AND the displayed dimensions — both are
   * needed, because the 36 mm gate angle belongs to the longer displayed axis
   * and nothing in a focal length says which that is. Absent if either is.
   */
  hFovDeg?: number;
  /** The other half of the same derivation; present exactly when `hFovDeg` is. */
  vFovDeg?: number;
  /**
   * Set when the file is a container we RECOGNISE but could not read metadata
   * out of — never when the file simply carries none.
   *
   * This exists because those two cases were indistinguishable, and the
   * difference is the whole product. A photograph whose GPS a share sheet
   * stripped and a photograph whose GPS is sitting in the file unread both
   * arrive here as `{}`, and the app then asks the user to type in a position
   * it is holding in memory. See heif.ts for the specific library limit that
   * made this a live failure on ordinary iPhone HDR photographs rather than a
   * theoretical one.
   *
   * A caller that wants to say "this photo has no location" must check this is
   * absent first. `resolvePose` reports it in the field's `note`.
   */
  unreadable?: ExifUnreadableReason;
}

/** Why a recognised container yielded no metadata. Never "it carries none". */
export interface ExifUnreadableReason {
  /** Container family, e.g. `'heif'`. */
  readonly container: string;
  /** Machine-readable cause, from the container reader. */
  readonly cause: string;
  /** What was seen — brands, sizes — so a bug report needs no second run. */
  readonly detail: string;
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
  | 'out-of-range'
  /**
   * The file's metadata was never READ — a container this app recognises whose
   * contents it could not follow (see `PhotoExif.unreadable`). Kept separate
   * from 'absent-from-exif' because the two demand opposite things of a UI: a
   * stripped photo genuinely needs the user to type a position in, while this
   * one is a defect, and telling someone their photo has no location when it
   * has one is the failure this distinction exists to prevent.
   */
  | 'container-unreadable';

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
