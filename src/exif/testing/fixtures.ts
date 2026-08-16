/**
 * The authored fixture photos.
 *
 * This file is the *input* side of the P3.1/P3.2 self-checks: it states, in
 * degrees/minutes/seconds and raw EXIF rationals, exactly what each fixture
 * photo claims about itself. The *expected* extractor output is written out by
 * hand in the test files from these authored values — never by running the
 * extractor and copying its answer.
 *
 * Coverage, by design:
 *   chamonix        northern + eastern hemisphere, complete metadata, TRUE north
 *   aconcagua       southern + western hemisphere, MAGNETIC north, no altitude,
 *                   no 35 mm-equivalent focal length
 *   dead-sea        altitude BELOW sea level (GPSAltitudeRef = 1), portrait
 *                   aspect, direction with no reference tag
 *   stripped        a valid JPEG with no EXIF whatsoever (the messaging-app case)
 */

import { decimalRational, encodeJpeg, rational, type JpegSpec, type TiffField } from './jpeg';

const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_ORIENTATION = 0x0112;

const TAG_FOCAL_LENGTH = 0x920a;
const TAG_PIXEL_X_DIMENSION = 0xa002;
const TAG_PIXEL_Y_DIMENSION = 0xa003;
const TAG_FOCAL_LENGTH_35MM = 0xa405;

const TAG_GPS_VERSION_ID = 0x0000;
const TAG_GPS_LATITUDE_REF = 0x0001;
const TAG_GPS_LATITUDE = 0x0002;
const TAG_GPS_LONGITUDE_REF = 0x0003;
const TAG_GPS_LONGITUDE = 0x0004;
const TAG_GPS_ALTITUDE_REF = 0x0005;
const TAG_GPS_ALTITUDE = 0x0006;
const TAG_GPS_IMG_DIRECTION_REF = 0x0010;
const TAG_GPS_IMG_DIRECTION = 0x0011;

const ascii = (tag: number, value: string): TiffField => ({
  tag,
  value: { type: 'ASCII', value },
});
const short = (tag: number, value: number): TiffField => ({
  tag,
  value: { type: 'SHORT', values: [value] },
});
const long = (tag: number, value: number): TiffField => ({
  tag,
  value: { type: 'LONG', values: [value] },
});
const byte = (tag: number, ...values: readonly number[]): TiffField => ({
  tag,
  value: { type: 'BYTE', values: [...values] },
});

/**
 * A coordinate exactly as EXIF stores it: three unsigned rationals plus a
 * hemisphere letter. Nothing here is signed — the sign lives in the ref, which
 * is precisely what the southern/western fixtures exist to prove.
 */
interface Dms {
  readonly deg: number;
  readonly min: number;
  /** Whole or fractional; written as a rational with `secondDecimals` digits. */
  readonly sec: number;
  readonly secondDecimals?: number;
}

function dmsField(tag: number, { deg, min, sec, secondDecimals = 2 }: Dms): TiffField {
  return {
    tag,
    value: {
      type: 'RATIONAL',
      values: [rational(deg), rational(min), decimalRational(sec, secondDecimals)],
    },
  };
}

export interface PhotoFixture {
  /** File name under fixtures/photos/. */
  readonly fileName: string;
  /** One-line summary of what this fixture is for. */
  readonly description: string;
  /** Human-readable statement of every authored value, for fixtures/photos/README.md. */
  readonly authoredNotes: readonly string[];
  readonly spec: JpegSpec;
}

const CHAMONIX: PhotoFixture = {
  fileName: 'chamonix-north-east.jpg',
  description:
    'Complete phone-style metadata in the northern and eastern hemispheres, TRUE-north direction.',
  authoredNotes: [
    'GPSLatitude  45 deg 55 min 25.32 sec, GPSLatitudeRef N',
    'GPSLongitude  6 deg 52 min  9.84 sec, GPSLongitudeRef E',
    'GPSAltitude 1035.5 m, GPSAltitudeRef 0 (above sea level)',
    'GPSImgDirection 137.25, GPSImgDirectionRef T (true north)',
    'FocalLength 4.2 mm, FocalLengthIn35mmFormat 26 mm',
    'PixelXDimension 800, PixelYDimension 600 (4:3 landscape)',
  ],
  spec: {
    widthPx: 800,
    heightPx: 600,
    exif: {
      ifd0: [
        ascii(TAG_MAKE, 'MountainFinder'),
        ascii(TAG_MODEL, 'Fixture Camera'),
        short(TAG_ORIENTATION, 1),
      ],
      exif: [
        { tag: TAG_FOCAL_LENGTH, value: { type: 'RATIONAL', values: [rational(42, 10)] } },
        long(TAG_PIXEL_X_DIMENSION, 800),
        long(TAG_PIXEL_Y_DIMENSION, 600),
        short(TAG_FOCAL_LENGTH_35MM, 26),
      ],
      gps: [
        byte(TAG_GPS_VERSION_ID, 2, 3, 0, 0),
        ascii(TAG_GPS_LATITUDE_REF, 'N'),
        dmsField(TAG_GPS_LATITUDE, { deg: 45, min: 55, sec: 25.32 }),
        ascii(TAG_GPS_LONGITUDE_REF, 'E'),
        dmsField(TAG_GPS_LONGITUDE, { deg: 6, min: 52, sec: 9.84 }),
        byte(TAG_GPS_ALTITUDE_REF, 0),
        { tag: TAG_GPS_ALTITUDE, value: { type: 'RATIONAL', values: [rational(20710, 20)] } },
        ascii(TAG_GPS_IMG_DIRECTION_REF, 'T'),
        {
          tag: TAG_GPS_IMG_DIRECTION,
          value: { type: 'RATIONAL', values: [decimalRational(137.25, 2)] },
        },
      ],
    },
  },
};

const ACONCAGUA: PhotoFixture = {
  fileName: 'aconcagua-south-west.jpg',
  description:
    'Southern and western hemispheres, MAGNETIC-north direction, no GPS altitude, no 35 mm equivalent.',
  authoredNotes: [
    'GPSLatitude  32 deg 39 min 12.60 sec, GPSLatitudeRef S  (must come out negative)',
    'GPSLongitude 70 deg  0 min 39.60 sec, GPSLongitudeRef W (must come out negative)',
    'GPSAltitude absent entirely',
    'GPSImgDirection 250.5, GPSImgDirectionRef M (magnetic north)',
    'FocalLength 24 mm, FocalLengthIn35mmFormat absent (no field of view derivable)',
    'PixelXDimension 900, PixelYDimension 600 (3:2 landscape)',
  ],
  spec: {
    widthPx: 900,
    heightPx: 600,
    exif: {
      ifd0: [ascii(TAG_MAKE, 'MountainFinder'), short(TAG_ORIENTATION, 1)],
      exif: [
        { tag: TAG_FOCAL_LENGTH, value: { type: 'RATIONAL', values: [rational(24)] } },
        long(TAG_PIXEL_X_DIMENSION, 900),
        long(TAG_PIXEL_Y_DIMENSION, 600),
      ],
      gps: [
        byte(TAG_GPS_VERSION_ID, 2, 3, 0, 0),
        ascii(TAG_GPS_LATITUDE_REF, 'S'),
        dmsField(TAG_GPS_LATITUDE, { deg: 32, min: 39, sec: 12.6 }),
        ascii(TAG_GPS_LONGITUDE_REF, 'W'),
        dmsField(TAG_GPS_LONGITUDE, { deg: 70, min: 0, sec: 39.6 }),
        ascii(TAG_GPS_IMG_DIRECTION_REF, 'M'),
        {
          tag: TAG_GPS_IMG_DIRECTION,
          value: { type: 'RATIONAL', values: [decimalRational(250.5, 1)] },
        },
      ],
    },
  },
};

const DEAD_SEA: PhotoFixture = {
  fileName: 'dead-sea-below-sea-level.jpg',
  description:
    'Altitude below sea level (GPSAltitudeRef 1), portrait aspect, direction with no reference tag.',
  authoredNotes: [
    'GPSLatitude  31 deg 30 min 36 sec, GPSLatitudeRef N',
    'GPSLongitude 35 deg 28 min 48 sec, GPSLongitudeRef E',
    'GPSAltitude 424.5 m with GPSAltitudeRef 1 -> BELOW sea level, i.e. -424.5 m',
    'GPSImgDirection 95.5 with NO GPSImgDirectionRef (true or magnetic is unknowable)',
    'FocalLength 26 mm, FocalLengthIn35mmFormat 50 mm',
    'PixelXDimension 600, PixelYDimension 800 (3:4 portrait)',
  ],
  spec: {
    widthPx: 600,
    heightPx: 800,
    exif: {
      ifd0: [ascii(TAG_MAKE, 'MountainFinder'), short(TAG_ORIENTATION, 1)],
      exif: [
        { tag: TAG_FOCAL_LENGTH, value: { type: 'RATIONAL', values: [rational(26)] } },
        long(TAG_PIXEL_X_DIMENSION, 600),
        long(TAG_PIXEL_Y_DIMENSION, 800),
        short(TAG_FOCAL_LENGTH_35MM, 50),
      ],
      gps: [
        byte(TAG_GPS_VERSION_ID, 2, 3, 0, 0),
        ascii(TAG_GPS_LATITUDE_REF, 'N'),
        dmsField(TAG_GPS_LATITUDE, { deg: 31, min: 30, sec: 36 }),
        ascii(TAG_GPS_LONGITUDE_REF, 'E'),
        dmsField(TAG_GPS_LONGITUDE, { deg: 35, min: 28, sec: 48 }),
        byte(TAG_GPS_ALTITUDE_REF, 1),
        { tag: TAG_GPS_ALTITUDE, value: { type: 'RATIONAL', values: [rational(8490, 20)] } },
        {
          tag: TAG_GPS_IMG_DIRECTION,
          value: { type: 'RATIONAL', values: [decimalRational(95.5, 1)] },
        },
      ],
    },
  },
};

const STRIPPED: PhotoFixture = {
  fileName: 'stripped-no-exif.jpg',
  description: 'A valid JPEG with no EXIF at all — what a messaging app hands you.',
  authoredNotes: [
    'No APP1 segment: no GPS, no direction, no focal length, no pixel dimensions in metadata.',
    'The image is 800x600, but only the JPEG frame header says so — EXIF does not.',
  ],
  spec: { widthPx: 800, heightPx: 600 },
};

export const PHOTO_FIXTURES: readonly PhotoFixture[] = [
  CHAMONIX,
  ACONCAGUA,
  DEAD_SEA,
  STRIPPED,
] as const;

/** Look a fixture up by file name. Throws rather than returning undefined. */
export function photoFixture(fileName: string): PhotoFixture {
  const found = PHOTO_FIXTURES.find((fixture) => fixture.fileName === fileName);
  if (found === undefined) throw new Error(`no photo fixture named ${fileName}`);
  return found;
}

/** Encode a fixture to JPEG bytes. Deterministic: same fixture, same bytes. */
export function encodeFixture(fixture: PhotoFixture): Uint8Array {
  return encodeJpeg(fixture.spec);
}
