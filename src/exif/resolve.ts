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
 *
 * Precedence applies to values that could be true. A value that CANNOT be true —
 * latitude 475, a negative eye height, a 200° field of view — is not a gap for
 * the next layer to fill: it is reported as `needs-manual` / `'out-of-range'`.
 * See {@link Domain} for the domains, and for the fields that deliberately have
 * none.
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

/**
 * Merge the three precedence layers into a single field state.
 *
 * The one asymmetry: a USER value that was supplied and rejected stops here.
 * Every other layer may be fallen through, because a photo's metadata or a
 * caller's default being unusable is a reason to look further down. A person
 * typing a number that cannot be true is not — replacing it with a different
 * number from a lower layer would hand back a confident pose the user never
 * asked for, which is precisely what this module exists to prevent.
 */
function merge(user: Candidate, exif: Candidate, fallback: Candidate): ResolvedField {
  if (user.value !== undefined) return { status: 'resolved', value: user.value, source: 'user' };
  if (user.blockedReason !== undefined) {
    return { status: 'needs-manual', reason: user.blockedReason };
  }

  if (exif.value !== undefined) return { status: 'resolved', value: exif.value, source: 'exif' };
  if (fallback.value !== undefined) {
    return { status: 'resolved', value: fallback.value, source: 'default' };
  }

  return {
    status: 'needs-manual',
    reason: exif.blockedReason ?? fallback.blockedReason ?? 'absent-from-exif',
  };
}

const resolvedValue = (field: ResolvedField): number | undefined =>
  field.status === 'resolved' ? field.value : undefined;

/**
 * The interval a field's value has to lie in for it to mean anything, with the
 * ends included unless a bound says otherwise.
 */
interface Domain {
  readonly min: number;
  readonly max: number;
  /** True when `min`/`max` themselves are illegal (an open interval). */
  readonly exclusive?: boolean;
}

/**
 * The domains this module enforces, and — as importantly — the ones it does
 * not.
 *
 *   lat / lon   The coordinate system's own limits. Both ends are real places:
 *               ±90 is a pole, ±180 the antimeridian.
 *   eyeHeightM  `Observer.eyeHeightM` is the camera ABOVE the ground under it.
 *               Negative buries the eye inside the terrain and inverts every
 *               clearance the pipeline computes; src/core's own
 *               `flatTerrainHorizon*` throw on it. No upper bound is imposed —
 *               a camera on a mast, a drone or a balloon is a legitimate
 *               observer and any ceiling here would be invented.
 *   hFov/vFov   Strictly inside (0, 180): `vFovDegFromHFov` throws outside it,
 *               and a lens with a 0° or 180° field of view is not a lens. This
 *               is also what stops an impossible hFov override taking
 *               `resolvePose` down with a RangeError.
 *
 * NOT range-checked, deliberately: `headingDeg` and `rollDeg` wrap, so 725° is
 * 5° rather than an error; `pitchDeg` is left to the projection to interpret;
 * `groundElevationM` has no defensible bound that would not reject a real
 * place (the Dead Sea shore is −430 m).
 */
const LATITUDE: Domain = { min: -90, max: 90 };
const LONGITUDE: Domain = { min: -180, max: 180 };
const EYE_HEIGHT: Domain = { min: 0, max: Number.POSITIVE_INFINITY };
const FIELD_OF_VIEW: Domain = { min: 0, max: 180, exclusive: true };

/**
 * Turn one layer's raw number into a {@link Candidate}, applying the field's
 * domain if it has one.
 *
 * Three outcomes, and the difference between the last two is the whole point:
 *   - a usable value;
 *   - nothing supplied — `undefined`, or a NaN, which is what an empty or
 *     half-typed input box parses to. The next layer gets its turn.
 *   - a finite value outside the domain: supplied, and impossible. This is
 *     recorded as `'out-of-range'` rather than discarded, so it can be shown to
 *     whoever typed it instead of being silently swapped for another number.
 */
function layer(value: number | undefined, domain?: Domain): Candidate {
  const usable = finite(value);
  if (usable === undefined) return {};
  if (domain === undefined) return { value: usable };
  const inside = domain.exclusive
    ? usable > domain.min && usable < domain.max
    : usable >= domain.min && usable <= domain.max;
  return inside ? { value: usable } : { blockedReason: 'out-of-range' };
}

/** Apply a domain to a candidate that came from one of the EXIF derivations. */
function bounded(candidate: Candidate, domain: Domain): Candidate {
  if (candidate.value === undefined) return candidate;
  return layer(candidate.value, domain);
}

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
  // A 35 mm equivalent with no pixel dimensions is not a missing focal length:
  // the angle is known, but which axis of the photograph it spans is not, and
  // assuming landscape is the bug this stopped doing (review 2, finding 3).
  // Name the thing that is actually absent, so the UI asks for the right one.
  if (exif.focalLength35mmMm !== undefined) return { blockedReason: 'image-dimensions-unknown' };
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
    layer(overrides.lat, LATITUDE),
    layer(exif.lat, LATITUDE),
    layer(defaults.lat, LATITUDE),
  );
  const lon = merge(
    layer(overrides.lon, LONGITUDE),
    layer(exif.lon, LONGITUDE),
    layer(defaults.lon, LONGITUDE),
  );

  // Eye height first: the GPS-altitude split below depends on it.
  const eyeHeightM = merge(
    layer(overrides.eyeHeightM, EYE_HEIGHT),
    {},
    layer(defaults.eyeHeightM, EYE_HEIGHT),
  );
  const groundElevationM = merge(
    layer(overrides.groundElevationM),
    groundElevationCandidateFromExif(exif, resolvedValue(eyeHeightM)),
    layer(defaults.groundElevationM),
  );

  const headingDeg = merge(
    layer(overrides.headingDeg),
    headingCandidateFromExif(exif, options),
    layer(defaults.headingDeg),
  );
  const pitchDeg = merge(layer(overrides.pitchDeg), {}, layer(defaults.pitchDeg));
  const rollDeg = merge(layer(overrides.rollDeg), {}, layer(defaults.rollDeg));

  const hFovDeg = merge(
    layer(overrides.hFovDeg, FIELD_OF_VIEW),
    bounded(hFovCandidateFromExif(exif), FIELD_OF_VIEW),
    layer(defaults.hFovDeg, FIELD_OF_VIEW),
  );

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
  const derivedVFov = merge(
    layer(overrides.vFovDeg, FIELD_OF_VIEW),
    bounded(vFovCandidate, FIELD_OF_VIEW),
    layer(defaults.vFovDeg, FIELD_OF_VIEW),
  );
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
