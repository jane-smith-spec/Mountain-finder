/**
 * P3.2 self-check — "EXIF-stripped fixture -> all fields flagged; override
 * merge precedence tested".
 *
 * Expectations are hand-derived from the authored fixture values:
 *   chamonix   altitude 1035.5 m, eye height 1.6 m -> ground 1033.9 m
 *   aconcagua  direction 250.5 magnetic, declination +2.5 -> 253.0 true
 *   dead-sea   altitude -424.5 m, eye height 1.6 m -> ground -426.1 m
 */

import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import { extractPhotoExif } from './extract';
import { resolvePose, STANDARD_DEFAULTS } from './resolve';
import { photoFixture } from './testing/fixtures';
import { fixturePhotoPath } from './testing/paths';
import {
  POSE_FIELDS,
  type FieldSource,
  type MissingReason,
  type PhotoExif,
  type ResolvedField,
} from './types';

async function loadExif(fileName: string): Promise<PhotoExif> {
  const bytes = new Uint8Array(readFileSync(fixturePhotoPath(photoFixture(fileName))));
  return extractPhotoExif(bytes);
}

function expectResolved(
  field: ResolvedField,
  value: number,
  source: FieldSource,
  precision = 9,
): void {
  expect(field.status).toBe('resolved');
  if (field.status !== 'resolved') return;
  expect(field.value).toBeCloseTo(value, precision);
  expect(field.source).toBe(source);
}

function expectNeedsManual(field: ResolvedField, reason: MissingReason): void {
  expect(field.status).toBe('needs-manual');
  if (field.status !== 'needs-manual') return;
  expect(field.reason).toBe(reason);
}

let chamonix: PhotoExif;
let aconcagua: PhotoExif;
let deadSea: PhotoExif;
let stripped: PhotoExif;

beforeAll(async () => {
  chamonix = await loadExif('chamonix-north-east.jpg');
  aconcagua = await loadExif('aconcagua-south-west.jpg');
  deadSea = await loadExif('dead-sea-below-sea-level.jpg');
  stripped = await loadExif('stripped-no-exif.jpg');
});

describe('resolvePose — stripped photo', () => {
  it('flags every pose field as needing manual input', () => {
    const resolution = resolvePose(stripped);

    expect(resolution.complete).toBe(false);
    expect([...resolution.missing]).toEqual([...POSE_FIELDS]);
    for (const name of POSE_FIELDS) {
      expectNeedsManual(resolution.fields[name], 'absent-from-exif');
    }
    expect(resolution.observer).toBeUndefined();
    expect(resolution.cameraPose).toBeUndefined();
    expect(resolution.gpsAltitudeM).toBeUndefined();
  });

  it('becomes complete once a human supplies all nine values', () => {
    const resolution = resolvePose(stripped, {
      lat: 46.5,
      lon: 8.25,
      groundElevationM: 1900,
      eyeHeightM: 1.7,
      headingDeg: 212.5,
      pitchDeg: -2,
      rollDeg: 0.5,
      hFovDeg: 65,
      vFovDeg: 48,
    });

    expect(resolution.missing).toEqual([]);
    expect(resolution.complete).toBe(true);
    expect(resolution.observer).toEqual({
      lat: 46.5,
      lon: 8.25,
      groundElevationM: 1900,
      eyeHeightM: 1.7,
    });
    expect(resolution.cameraPose).toEqual({
      headingDeg: 212.5,
      pitchDeg: -2,
      rollDeg: 0.5,
      hFovDeg: 65,
      vFovDeg: 48,
    });
  });

  it('still needs the vertical field of view when only hFov is typed in', () => {
    const resolution = resolvePose(stripped, { hFovDeg: 65 });

    expectResolved(resolution.fields.hFovDeg, 65, 'user');
    expectNeedsManual(resolution.fields.vFovDeg, 'image-dimensions-unknown');
  });

  it('derives vFov once the caller supplies the decoded image size', () => {
    // The photo is 800x600 but says so nowhere in metadata; the app knows it
    // from the decoded bitmap. hFov 60 -> tan(30 deg)*0.75 = 0.43301270
    //                                 -> vFov = 2*atan(0.43301270) = 46.826449 deg
    const resolution = resolvePose(stripped, {
      hFovDeg: 60,
      imageWidthPx: 800,
      imageHeightPx: 600,
    });

    expectResolved(resolution.fields.vFovDeg, 46.826449, 'user', 6);
    expect(resolution.imageWidthPx).toBe(800);
    expect(resolution.imageHeightPx).toBe(600);
  });
});

describe('resolvePose — complete photo with standard assumptions', () => {
  it('produces an Observer and a CameraPose with honest provenance', () => {
    const resolution = resolvePose(chamonix, {}, { defaults: STANDARD_DEFAULTS });

    expect(resolution.missing).toEqual([]);
    expect(resolution.complete).toBe(true);

    expectResolved(resolution.fields.lat, 45.9237, 'exif');
    expectResolved(resolution.fields.lon, 6.8694, 'exif');
    // GPS altitude is the camera's altitude: 1035.5 - 1.6 = 1033.9 m of terrain.
    expectResolved(resolution.fields.groundElevationM, 1033.9, 'exif');
    expectResolved(resolution.fields.eyeHeightM, 1.6, 'default');
    expectResolved(resolution.fields.headingDeg, 137.25, 'exif');
    expectResolved(resolution.fields.pitchDeg, 0, 'default');
    expectResolved(resolution.fields.rollDeg, 0, 'default');
    expectResolved(resolution.fields.hFovDeg, 69.390307, 'exif', 6);
    expectResolved(resolution.fields.vFovDeg, 54.879456, 'exif', 6);

    expect(resolution.observer?.lat).toBeCloseTo(45.9237, 9);
    expect(resolution.observer?.groundElevationM).toBeCloseTo(1033.9, 9);
    expect(resolution.observer?.eyeHeightM).toBe(1.6);
    expect(resolution.cameraPose?.headingDeg).toBe(137.25);
    expect(resolution.gpsAltitudeM).toBe(1035.5);
  });

  it('applies no assumptions at all unless the caller opts in', () => {
    const resolution = resolvePose(chamonix);

    expect(resolution.complete).toBe(false);
    expectNeedsManual(resolution.fields.eyeHeightM, 'absent-from-exif');
    expectNeedsManual(resolution.fields.pitchDeg, 'absent-from-exif');
    expectNeedsManual(resolution.fields.rollDeg, 'absent-from-exif');
    // Without an eye height the camera's GPS altitude cannot be split into
    // terrain height plus eye height.
    expectNeedsManual(resolution.fields.groundElevationM, 'eye-height-required');
    // Everything EXIF really does carry still resolves.
    expectResolved(resolution.fields.headingDeg, 137.25, 'exif');
    expectResolved(resolution.fields.hFovDeg, 69.390307, 'exif', 6);
  });
});

describe('resolvePose — magnetic north is never passed off as true north', () => {
  it('refuses a magnetic heading until a declination is supplied', () => {
    const resolution = resolvePose(aconcagua, {}, { defaults: STANDARD_DEFAULTS });

    expectNeedsManual(resolution.fields.headingDeg, 'magnetic-declination-required');
    expect(resolution.missing).toContain('headingDeg');
    expect(resolution.cameraPose).toBeUndefined();
  });

  it('converts magnetic to true with the caller-supplied declination', () => {
    // 250.5 magnetic + 2.5 east declination = 253.0 true.
    const resolution = resolvePose(aconcagua, {}, { magneticDeclinationDeg: 2.5 });

    expectResolved(resolution.fields.headingDeg, 253, 'exif');
  });

  it('wraps the converted heading through north in both directions', () => {
    // 250.5 + 120 = 370.5 -> 10.5
    expectResolved(
      resolvePose(aconcagua, {}, { magneticDeclinationDeg: 120 }).fields.headingDeg,
      10.5,
      'exif',
    );
    // 250.5 - 260.5 = -10 -> 350
    expectResolved(
      resolvePose(aconcagua, {}, { magneticDeclinationDeg: -260.5 }).fields.headingDeg,
      350,
      'exif',
    );
  });

  it('lets a user-typed TRUE heading bypass the declination requirement', () => {
    const resolution = resolvePose(aconcagua, { headingDeg: 305 });

    expectResolved(resolution.fields.headingDeg, 305, 'user');
  });

  it('reports the missing 35 mm equivalent distinctly from an absent tag', () => {
    const resolution = resolvePose(aconcagua, {}, { magneticDeclinationDeg: 2.5 });

    // The photo has FocalLength 24 mm but no FocalLengthIn35mmFormat.
    expectNeedsManual(resolution.fields.hFovDeg, 'no-35mm-equivalent-focal-length');
    expectNeedsManual(resolution.fields.vFovDeg, 'no-35mm-equivalent-focal-length');
    expectNeedsManual(resolution.fields.groundElevationM, 'absent-from-exif');
  });

  it('asks for the image size, not the focal length, when only the shape is unknown', () => {
    // A 35 mm equivalent WITH no pixel dimensions: the angle is known, the axis
    // it spans is not, and assuming landscape is exactly what review 2's
    // finding 3 was about. Naming 'no-35mm-equivalent-focal-length' here would
    // send the user off to find a number the photo already carries.
    const resolution = resolvePose({ focalLength35mmMm: 26, focalLengthMm: 4.2 });

    expectNeedsManual(resolution.fields.hFovDeg, 'image-dimensions-unknown');
    expectNeedsManual(resolution.fields.vFovDeg, 'image-dimensions-unknown');
  });

  it('derives both angles once the decoded size arrives, portrait included', () => {
    // Supplying the dimensions as overrides is what the app does after
    // decoding the bitmap. 600x800 portrait, f35 = 26:
    //   vFov = 2*atan(9/13) = 69.390307 deg (the long side is the height)
    //   hFov = 2*atan((9/13)*0.75) = 54.879456 deg
    const resolution = resolvePose(
      { focalLength35mmMm: 26, hFovDeg: 54.87945589639861, imageWidthPx: 600, imageHeightPx: 800 },
      { imageWidthPx: 600, imageHeightPx: 800 },
    );

    expectResolved(resolution.fields.hFovDeg, 54.879456, 'exif', 6);
    expectResolved(resolution.fields.vFovDeg, 69.390307, 'exif', 6);
  });

  it('keeps the southern/western signs through to the Observer', () => {
    const resolution = resolvePose(
      aconcagua,
      { groundElevationM: 4300, hFovDeg: 65, eyeHeightM: 1.6, pitchDeg: 0, rollDeg: 0 },
      { magneticDeclinationDeg: 2.5 },
    );

    expect(resolution.complete).toBe(true);
    expect(resolution.observer?.lat).toBeCloseTo(-32.6535, 9);
    expect(resolution.observer?.lon).toBeCloseTo(-70.011, 9);
  });
});

describe('resolvePose — direction with no reference tag', () => {
  it('refuses to guess whether the direction is true or magnetic', () => {
    const resolution = resolvePose(deadSea, {}, { defaults: STANDARD_DEFAULTS });

    expectNeedsManual(resolution.fields.headingDeg, 'direction-reference-unknown');
  });

  it('honours an explicit assumption about the missing reference', () => {
    const asTrue = resolvePose(deadSea, {}, { assumeDirectionRefWhenMissing: 'T' });
    expectResolved(asTrue.fields.headingDeg, 95.5, 'exif');

    // 95.5 magnetic + 4.5 = 100.0 true.
    const asMagnetic = resolvePose(
      deadSea,
      {},
      { assumeDirectionRefWhenMissing: 'M', magneticDeclinationDeg: 4.5 },
    );
    expectResolved(asMagnetic.fields.headingDeg, 100, 'exif');

    // Assuming magnetic without a declination is still not enough.
    const unusable = resolvePose(deadSea, {}, { assumeDirectionRefWhenMissing: 'M' });
    expectNeedsManual(unusable.fields.headingDeg, 'magnetic-declination-required');
  });
});

describe('resolvePose — below-sea-level altitude', () => {
  it('carries the negative altitude into the ground elevation', () => {
    // -424.5 m camera altitude - 1.6 m eye height = -426.1 m of terrain.
    const resolution = resolvePose(deadSea, {}, { defaults: STANDARD_DEFAULTS });

    expectResolved(resolution.fields.groundElevationM, -426.1, 'exif');
    expect(resolution.gpsAltitudeM).toBe(-424.5);
  });

  it('lets a terrain-elevation lookup override the unreliable GPS altitude', () => {
    // The provider (group B) returns the real terrain height; the caller passes
    // it in as an override and it beats the EXIF-derived value.
    const resolution = resolvePose(deadSea, { groundElevationM: -430 }, {
      defaults: STANDARD_DEFAULTS,
    });

    expectResolved(resolution.fields.groundElevationM, -430, 'user');
    // The raw EXIF reading stays visible for comparison.
    expect(resolution.gpsAltitudeM).toBe(-424.5);
  });
});

describe('resolvePose — override precedence', () => {
  const defaults = {
    lat: -20,
    lon: -30,
    groundElevationM: 500,
    eyeHeightM: 1.6,
    headingDeg: 300,
    pitchDeg: 0,
    rollDeg: 0,
    hFovDeg: 80,
  };

  it('ranks user above exif above default, field by field', () => {
    const resolution = resolvePose(
      chamonix,
      { lat: 10, headingDeg: 200, pitchDeg: -3 },
      { defaults },
    );

    // user beats both exif and default
    expectResolved(resolution.fields.lat, 10, 'user');
    expectResolved(resolution.fields.headingDeg, 200, 'user');
    // user beats default where exif has nothing to say
    expectResolved(resolution.fields.pitchDeg, -3, 'user');
    // exif beats default
    expectResolved(resolution.fields.lon, 6.8694, 'exif');
    expectResolved(resolution.fields.hFovDeg, 69.390307, 'exif', 6);
    expectResolved(resolution.fields.groundElevationM, 1033.9, 'exif');
    // default applies only where neither user nor exif does
    expectResolved(resolution.fields.eyeHeightM, 1.6, 'default');
    expectResolved(resolution.fields.rollDeg, 0, 'default');
  });

  it('recomputes vFov from an overridden hFov instead of keeping the EXIF one', () => {
    // 800x600 photo, hFov overridden to 60 -> vFov = 2*atan(tan(30)*0.75)
    //                                             = 46.826449 deg, not 54.879456.
    const resolution = resolvePose(chamonix, { hFovDeg: 60 }, { defaults: STANDARD_DEFAULTS });

    expectResolved(resolution.fields.hFovDeg, 60, 'user');
    expectResolved(resolution.fields.vFovDeg, 46.826449, 'user', 6);
  });

  it('lets vFov itself be overridden independently of hFov', () => {
    const resolution = resolvePose(
      chamonix,
      { vFovDeg: 41.5 },
      { defaults: STANDARD_DEFAULTS },
    );

    expectResolved(resolution.fields.hFovDeg, 69.390307, 'exif', 6);
    expectResolved(resolution.fields.vFovDeg, 41.5, 'user');
  });

  it('normalises a user heading into [0, 360)', () => {
    expectResolved(resolvePose(stripped, { headingDeg: 725 }).fields.headingDeg, 5, 'user');
    expectResolved(resolvePose(stripped, { headingDeg: -45 }).fields.headingDeg, 315, 'user');
  });

  it('treats a NaN override as no value at all, and falls through', () => {
    // NaN is what an empty (or half-typed) input box parses to, i.e. "nothing
    // supplied yet" — distinct from a number that was supplied and cannot be
    // true. Falling through to EXIF is right for the former only.
    const resolution = resolvePose(chamonix, { lon: Number.NaN }, { defaults });

    expectResolved(resolution.fields.lon, 6.8694, 'exif');
  });

  it('refuses an out-of-range override instead of falling through to EXIF', () => {
    // 475 is a plausible fat-finger for 47.5. Falling through to EXIF hands
    // back a complete: true pose at a coordinate 165 km away, marked
    // source: 'exif' — the app inventing a location the user did not give it.
    const resolution = resolvePose(chamonix, { lat: 475 }, { defaults });

    expectNeedsManual(resolution.fields.lat, 'out-of-range');
    expect(resolution.missing).toContain('lat');
    expect(resolution.complete).toBe(false);
    expect(resolution.observer).toBeUndefined();
    // Every other field still resolves — one bad box does not blank the panel.
    expectResolved(resolution.fields.lon, 6.8694, 'exif');
  });

  it('lets an image-size override drive the aspect ratio for vFov', () => {
    // Same photo re-cropped to 1:1 by the app: vFov must equal hFov.
    const resolution = resolvePose(
      chamonix,
      { imageWidthPx: 900, imageHeightPx: 900 },
      { defaults: STANDARD_DEFAULTS },
    );

    expectResolved(resolution.fields.vFovDeg, 69.390307, 'exif', 6);
  });
});

/**
 * RANGE CHECKS — a value that cannot be true is never quietly swapped for
 * another one.
 *
 * `inRange` used to return `undefined` for an out-of-range value, which made it
 * indistinguishable from "not supplied", so the merge fell through to the next
 * layer and recorded nothing. That breaks the app's central promise: it means a
 * user who typed 475 for latitude gets a confident pose at the EXIF coordinate
 * instead of being told the number is impossible.
 *
 * The rule now: an explicitly supplied FINITE value that lies outside a field's
 * domain is a rejection, reported as `needs-manual` / `'out-of-range'`, and a
 * user-layer rejection never falls through. NaN is not a rejection — it is what
 * an empty input box parses to, i.e. no value at all.
 *
 * Domains (documented in resolve.ts): lat ±90, lon ±180, eyeHeightM ≥ 0,
 * hFovDeg and vFovDeg strictly inside (0, 180).
 */
describe('resolvePose — out-of-range values are rejected, not replaced', () => {
  const defaults = { lat: -20, lon: -30, eyeHeightM: 1.6, hFovDeg: 80 };

  it('rejects an out-of-range user latitude and longitude', () => {
    const resolution = resolvePose({ lat: 45, lon: 7 }, { lat: 475, lon: -181 }, { defaults });

    expectNeedsManual(resolution.fields.lat, 'out-of-range');
    expectNeedsManual(resolution.fields.lon, 'out-of-range');
    expect(resolution.observer).toBeUndefined();
  });

  it('accepts the exact boundaries — a pole and the antimeridian are real places', () => {
    const resolution = resolvePose({}, { lat: 90, lon: 180, eyeHeightM: 0 });

    expectResolved(resolution.fields.lat, 90, 'user');
    expectResolved(resolution.fields.lon, 180, 'user');
    expectResolved(resolution.fields.eyeHeightM, 0, 'user');
    expect(resolvePose({}, { lat: -90, lon: -180 }).fields.lat.status).toBe('resolved');
  });

  it('rejects a NEGATIVE eye height, which would put the eye below the terrain', () => {
    // Observer.eyeHeightM is the camera ABOVE the ground under it. A negative
    // one buries the eye, inverting every clearance the pipeline computes:
    // src/core's own flatTerrainHorizon* throw on it rather than answer.
    const resolution = resolvePose({ gpsAltitudeM: 1035.5 }, { eyeHeightM: -1.7 }, { defaults });

    expectNeedsManual(resolution.fields.eyeHeightM, 'out-of-range');
    // And the GPS-altitude split, which needs an eye height, stays blocked
    // rather than subtracting a negative and inflating the terrain height.
    expectNeedsManual(resolution.fields.groundElevationM, 'eye-height-required');
    expect(resolution.observer).toBeUndefined();
  });

  it('rejects an impossible field of view instead of throwing', () => {
    // vFovDegFromHFov throws outside (0, 180); an hFov override of 200 used to
    // take resolvePose down with it, which no UI can recover from.
    const wide = resolvePose({}, { hFovDeg: 200, imageWidthPx: 800, imageHeightPx: 600 });
    expectNeedsManual(wide.fields.hFovDeg, 'out-of-range');
    expectNeedsManual(wide.fields.vFovDeg, 'out-of-range');

    const zero = resolvePose({}, { hFovDeg: 0, imageWidthPx: 800, imageHeightPx: 600 });
    expectNeedsManual(zero.fields.hFovDeg, 'out-of-range');

    const negativeVertical = resolvePose({}, { vFovDeg: -10 });
    expectNeedsManual(negativeVertical.fields.vFovDeg, 'out-of-range');
  });

  it('lets an out-of-range EXIF reading fall through, but says why when nothing catches it', () => {
    // EXIF is not a person typing; a corrupt tag falling through to a default
    // the caller opted into is the right precedence. With no default there is
    // nothing to fall through to, and 'out-of-range' is more honest than
    // 'absent-from-exif' — the tag was there, it was garbage.
    const withDefault = resolvePose({ lat: 200 }, {}, { defaults });
    expectResolved(withDefault.fields.lat, -20, 'default');

    const bare = resolvePose({ lat: 200 });
    expectNeedsManual(bare.fields.lat, 'out-of-range');
  });

  it('reports an out-of-range default as out-of-range, not as an absent tag', () => {
    const resolution = resolvePose({}, {}, { defaults: { eyeHeightM: -2 } });
    expectNeedsManual(resolution.fields.eyeHeightM, 'out-of-range');
  });

  it('leaves the wrapping fields alone — no bearing is ever out of range', () => {
    // Heading and roll wrap; 725° is 5°, not an error. Rejecting them would be
    // a different bug in the same family.
    expectResolved(resolvePose({}, { headingDeg: 725 }).fields.headingDeg, 5, 'user');
    expectResolved(resolvePose({}, { rollDeg: -400 }).fields.rollDeg, -400, 'user');
  });
});
