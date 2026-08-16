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

  it('ignores impossible overrides rather than corrupting the pose', () => {
    const resolution = resolvePose(chamonix, { lat: 120, lon: Number.NaN }, { defaults });

    // Out-of-range latitude and NaN longitude both fall through to EXIF.
    expectResolved(resolution.fields.lat, 45.9237, 'exif');
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
