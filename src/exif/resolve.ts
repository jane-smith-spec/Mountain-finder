/**
 * P3.2 — Fallback model and override merge.
 *
 * Real photos arrive incomplete: messaging apps strip EXIF wholesale, most
 * cameras have no compass, and GPS altitude is missing or wrong as often as
 * not. Every pose field is therefore resolved into one of two explicit states —
 * `resolved` (with provenance) or `needs-manual` (with a reason a UI can act
 * on). Nothing is ever silently defaulted.
 *
 * Precedence, highest first:
 *
 *   1. user      — values typed into the override panel
 *   2. exif      — values read from (or derived from) the photo
 *   3. default   — documented assumptions the caller opted into
 *
 * A pose only exists once all nine fields resolve; until then the caller knows
 * exactly which inputs to ask for.
 */

import type { CameraPose, Observer } from '../core/types';

import { normaliseBearingDeg } from './extract';
import { vFovDegFromHFov } from './fov';
import {
  POSE_FIELDS,
  type MissingReason,
  type PhotoExif,
  type PoseField,
  type PoseInputs,
  type ResolveOptions,
  type ResolvedField,
} from './types';

/**
 * Conventional assumptions, offered as `defaults` rather than applied
 * automatically: a handheld photo is taken at about eye height, and most
 * photographers hold the camera roughly level and upright.
 *
 * Pass them in explicitly (`{ defaults: STANDARD_DEFAULTS }`) so that "assumed"
 * stays visible in the resolved provenance.
 */
export const STANDARD_DEFAULTS: PoseInputs = {
  eyeHeightM: 1.6,
  pitchDeg: 0,
  rollDeg: 0,
};

/** The outcome of merging EXIF, user overrides and defaults. */
export interface PoseResolution {
  /** Every pose field, resolved or explicitly flagged for manual input. */
  readonly fields: Readonly<Record<PoseField, ResolvedField>>;
  /** The fields still needing manual input, in `POSE_FIELDS` order. */
  readonly missing: readonly PoseField[];
  /** True iff `missing` is empty, i.e. `observer` and `cameraPose` are both present. */
  readonly complete: boolean;
  /** Present iff the four observer fields resolved. */
  readonly observer?: Observer;
  /** Present iff the five camera fields resolved. */
  readonly cameraPose?: CameraPose;
  /**
   * Raw camera altitude above sea level from EXIF, if any. Surfaced separately
   * because it is notoriously unreliable: a caller holding a terrain-elevation
   * provider should normally override `groundElevationM` with a real lookup.
   */
  readonly gpsAltitudeM?: number;
  /** Pixel dimensions in effect (override, else EXIF, else default). */
  readonly imageWidthPx?: number;
  readonly imageHeightPx?: number;
}

/**
 * One field's raw material: a value if that layer could supply one, or the
 * reason the layer had the data but could not turn it into a value.
 */
interface Candidate {
  readonly value?: number;
  readonly blockedReason?: MissingReason;
}

const finite = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

function firstFinite(...candidates: readonly (number | undefined)[]): number | undefined {
  for (const candidate of candidates) {
    const usable = finite(candidate);
    if (usable !== undefined) return usable;
  }
  return undefined;
}

/** Merge the three precedence layers into a single field state. */
function merge(
  user: number | undefined,
  exif: Candidate,
  fallback: number | undefined,
): ResolvedField {
  const userValue = finite(user);
  if (userValue !== undefined) return { status: 'resolved', value: userValue, source: 'user' };

  const exifValue = finite(exif.value);
  if (exifValue !== undefined) return { status: 'resolved', value: exifValue, source: 'exif' };

  const defaultValue = finite(fallback);
  if (defaultValue !== undefined) {
    return { status: 'resolved', value: defaultValue, source: 'default' };
  }

  return { status: 'needs-manual', reason: exif.blockedReason ?? 'absent-from-exif' };
}

const resolvedValue = (field: ResolvedField): number | undefined =>
  field.status === 'resolved' ? field.value : undefined;

const inRange = (value: number | undefined, limit: number): number | undefined =>
  value !== undefined && Math.abs(value) <= limit ? value : undefined;

/**
 * Turn the EXIF direction into a TRUE-north heading, or explain why it cannot
 * be done. This is the magnetic/true boundary: core never sees a magnetic
 * bearing, and a magnetic reading is never passed off as a true one.
 */
function headingCandidateFromExif(exif: PhotoExif, options: ResolveOptions): Candidate {
  const direction = finite(exif.imgDirectionDeg);
  if (direction === undefined) return { blockedReason: 'absent-from-exif' };

  const ref = exif.imgDirectionRef ?? options.assumeDirectionRefWhenMissing;
  if (ref === undefined) return { blockedReason: 'direction-reference-unknown' };
  if (ref === 'T') return { value: normaliseBearingDeg(direction) };

  const declination = finite(options.magneticDeclinationDeg);
  if (declination === undefined) return { blockedReason: 'magnetic-declination-required' };
  return { value: normaliseBearingDeg(direction + declination) };
}

/**
 * GPS altitude is the altitude of the camera, i.e. of the observer's eye.
 * `Observer.groundElevationM` is the terrain under it, so the eye height has to
 * come off first — which means the eye height must itself be known.
 */
function groundElevationCandidateFromExif(
  exif: PhotoExif,
  eyeHeightM: number | undefined,
): Candidate {
  const cameraAltitudeM = finite(exif.gpsAltitudeM);
  if (cameraAltitudeM === undefined) return { blockedReason: 'absent-from-exif' };
  if (eyeHeightM === undefined) return { blockedReason: 'eye-height-required' };
  return { value: cameraAltitudeM - eyeHeightM };
}

function hFovCandidateFromExif(exif: PhotoExif): Candidate {
  const hFovDeg = finite(exif.hFovDeg);
  if (hFovDeg !== undefined) return { value: hFovDeg };
  return {
    blockedReason:
      exif.focalLengthMm !== undefined ? 'no-35mm-equivalent-focal-length' : 'absent-from-exif',
  };
}

/**
 * Merge EXIF metadata with user overrides and optional defaults.
 *
 * @param exif      what `extractPhotoExif` found (`{}` for a stripped photo)
 * @param overrides values a human supplied; these always win
 * @param options   magnetic declination, direction-ref assumption, defaults
 */
export function resolvePose(
  exif: PhotoExif,
  overrides: PoseInputs = {},
  options: ResolveOptions = {},
): PoseResolution {
  const defaults = options.defaults ?? {};

  const imageWidthPx = firstFinite(
    overrides.imageWidthPx,
    exif.imageWidthPx,
    defaults.imageWidthPx,
  );
  const imageHeightPx = firstFinite(
    overrides.imageHeightPx,
    exif.imageHeightPx,
    defaults.imageHeightPx,
  );
  const aspectKnown =
    imageWidthPx !== undefined &&
    imageHeightPx !== undefined &&
    imageWidthPx > 0 &&
    imageHeightPx > 0;

  const lat = merge(
    inRange(overrides.lat, 90),
    { value: inRange(exif.lat, 90) },
    inRange(defaults.lat, 90),
  );
  const lon = merge(
    inRange(overrides.lon, 180),
    { value: inRange(exif.lon, 180) },
    inRange(defaults.lon, 180),
  );

  // Eye height first: the GPS-altitude split below depends on it.
  const eyeHeightM = merge(overrides.eyeHeightM, {}, defaults.eyeHeightM);
  const groundElevationM = merge(
    overrides.groundElevationM,
    groundElevationCandidateFromExif(exif, resolvedValue(eyeHeightM)),
    defaults.groundElevationM,
  );

  const headingDeg = merge(
    overrides.headingDeg,
    headingCandidateFromExif(exif, options),
    defaults.headingDeg,
  );
  const pitchDeg = merge(overrides.pitchDeg, {}, defaults.pitchDeg);
  const rollDeg = merge(overrides.rollDeg, {}, defaults.rollDeg);

  const hFovDeg = merge(overrides.hFovDeg, hFovCandidateFromExif(exif), defaults.hFovDeg);

  // vFov is a consequence of the hFov actually in effect and the image aspect
  // ratio — recomputed here so that an overridden hFov drags vFov with it.
  const effectiveHFov = resolvedValue(hFovDeg);
  let vFovCandidate: Candidate;
  if (effectiveHFov === undefined) {
    vFovCandidate = {
      blockedReason: hFovDeg.status === 'needs-manual' ? hFovDeg.reason : 'absent-from-exif',
    };
  } else if (!aspectKnown || imageWidthPx === undefined || imageHeightPx === undefined) {
    vFovCandidate = { blockedReason: 'image-dimensions-unknown' };
  } else {
    vFovCandidate = { value: vFovDegFromHFov(effectiveHFov, imageWidthPx, imageHeightPx) };
  }
  const derivedVFov = merge(overrides.vFovDeg, vFovCandidate, defaults.vFovDeg);
  // A derived vFov inherits the provenance of the hFov it came from.
  const vFovDeg: ResolvedField =
    derivedVFov.status === 'resolved' &&
    derivedVFov.source === 'exif' &&
    hFovDeg.status === 'resolved'
      ? { status: 'resolved', value: derivedVFov.value, source: hFovDeg.source }
      : derivedVFov;

  const fields: Record<PoseField, ResolvedField> = {
    lat,
    lon,
    groundElevationM,
    eyeHeightM,
    headingDeg: normaliseHeadingField(headingDeg),
    pitchDeg,
    rollDeg,
    hFovDeg,
    vFovDeg,
  };

  const missing = POSE_FIELDS.filter((name) => fields[name].status === 'needs-manual');

  const resolution: {
    fields: Record<PoseField, ResolvedField>;
    missing: PoseField[];
    complete: boolean;
    observer?: Observer;
    cameraPose?: CameraPose;
    gpsAltitudeM?: number;
    imageWidthPx?: number;
    imageHeightPx?: number;
  } = { fields, missing, complete: missing.length === 0 };

  if (exif.gpsAltitudeM !== undefined) resolution.gpsAltitudeM = exif.gpsAltitudeM;
  if (imageWidthPx !== undefined) resolution.imageWidthPx = imageWidthPx;
  if (imageHeightPx !== undefined) resolution.imageHeightPx = imageHeightPx;

  const observer = buildObserver(fields);
  if (observer !== undefined) resolution.observer = observer;
  const cameraPose = buildCameraPose(fields);
  if (cameraPose !== undefined) resolution.cameraPose = cameraPose;

  return resolution;
}

/** Any heading, whatever its source, is stored wrapped into [0, 360). */
function normaliseHeadingField(field: ResolvedField): ResolvedField {
  if (field.status !== 'resolved') return field;
  return { status: 'resolved', value: normaliseBearingDeg(field.value), source: field.source };
}

function buildObserver(fields: Readonly<Record<PoseField, ResolvedField>>): Observer | undefined {
  const lat = resolvedValue(fields.lat);
  const lon = resolvedValue(fields.lon);
  const groundElevationM = resolvedValue(fields.groundElevationM);
  const eyeHeightM = resolvedValue(fields.eyeHeightM);
  if (
    lat === undefined ||
    lon === undefined ||
    groundElevationM === undefined ||
    eyeHeightM === undefined
  ) {
    return undefined;
  }
  return { lat, lon, groundElevationM, eyeHeightM };
}

function buildCameraPose(
  fields: Readonly<Record<PoseField, ResolvedField>>,
): CameraPose | undefined {
  const headingDeg = resolvedValue(fields.headingDeg);
  const pitchDeg = resolvedValue(fields.pitchDeg);
  const rollDeg = resolvedValue(fields.rollDeg);
  const hFovDeg = resolvedValue(fields.hFovDeg);
  const vFovDeg = resolvedValue(fields.vFovDeg);
  if (
    headingDeg === undefined ||
    pitchDeg === undefined ||
    rollDeg === undefined ||
    hFovDeg === undefined ||
    vFovDeg === undefined
  ) {
    return undefined;
  }
  return { headingDeg, pitchDeg, rollDeg, hFovDeg, vFovDeg };
}
