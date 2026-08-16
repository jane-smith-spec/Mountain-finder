/**
 * P3.1 — EXIF extraction.
 *
 * Reads one photo's metadata with `exifr` and normalises it into `PhotoExif`.
 * This module does exactly two things beyond reading tags:
 *   1. applies GPSAltitudeRef so a below-sea-level altitude comes out negative;
 *   2. derives hFov/vFov from the 35 mm-equivalent focal length.
 *
 * It deliberately does NOT resolve magnetic headings, invent defaults, or fall
 * back to terrain elevation — that is resolve.ts and the caller's providers.
 */

// Default import on purpose: exifr ships a UMD/CommonJS `main` and an ESM
// `module`, and only the default export exists in both. Named imports break
// under plain Node ESM.
import exifr from 'exifr';

import { hFovDegFromFocalLength35mm, vFovDegFromHFov } from './fov';
import type { DirectionRef, PhotoExif } from './types';

/** Anything exifr can read. `string` is a filesystem path (Node) or URL (browser). */
export type ExifInput = ArrayBuffer | Uint8Array | DataView | Blob | string;

/**
 * exifr options. Blocks we do not use are switched off so a corrupt XMP or ICC
 * segment in a real photo cannot fail the parse of the tags we need.
 * `translateValues: false` keeps GPSImgDirectionRef as the raw 'T'/'M' and
 * GPSAltitudeRef as the raw 0/1 rather than prose.
 */
const EXIFR_OPTIONS = {
  tiff: true,
  // IFD0 cannot be switched off in exifr, so it takes format options rather
  // than a boolean; an empty object means "parse it with the defaults".
  ifd0: {},
  exif: true,
  gps: true,
  interop: false,
  ifd1: false,
  jfif: false,
  iptc: false,
  xmp: false,
  icc: false,
  translateKeys: true,
  translateValues: false,
  reviveValues: true,
  sanitize: true,
  mergeOutput: true,
} as const;

/** Tags are read out of an untyped bag; narrow every one before use. */
type ExifBag = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is ExifBag {
  return typeof value === 'object' && value !== null;
}

/**
 * EXIF numeric tags reach us as a number, a numeric string, or a one-element
 * sequence that exifr did not unwrap. GPSAltitudeRef in particular arrives as a
 * one-byte Uint8Array, not a number — verified against the fixture photos.
 */
function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const parsed = Number(trimmed);
    return trimmed !== '' && Number.isFinite(parsed) ? parsed : undefined;
  }
  if (typeof value === 'object' && value !== null) {
    // Arrays and typed arrays alike; anything else simply has no numeric length.
    const sequence = value as { readonly length?: unknown; readonly [index: number]: unknown };
    if (sequence.length === 1) return asNumber(sequence[0]);
  }
  return undefined;
}

/** ASCII tags may carry a trailing NUL or padding whitespace. */
function asAscii(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/\0+$/, '').trim();
  return cleaned === '' ? undefined : cleaned;
}

function asDirectionRef(value: unknown): DirectionRef | undefined {
  const text = asAscii(value)?.toUpperCase();
  if (text === 'T') return 'T';
  if (text === 'M') return 'M';
  return undefined;
}

/** Wrap any bearing into [0, 360). */
export function normaliseBearingDeg(bearingDeg: number): number {
  const wrapped = bearingDeg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * GPSAltitude is an unsigned rational; GPSAltitudeRef carries the sign
 * (0 = above sea level, 1 = below). exifr applies neither, so we do.
 */
function signedAltitudeM(bag: ExifBag): number | undefined {
  const magnitude = asNumber(bag['GPSAltitude']);
  if (magnitude === undefined) return undefined;
  const ref = asNumber(bag['GPSAltitudeRef']);
  return ref === 1 ? -Math.abs(magnitude) : magnitude;
}

/**
 * Pull the pose-relevant EXIF out of a photo.
 *
 * Missing tags come back as absent properties, never as zeros or guesses.
 * A photo with no EXIF at all yields `{}`.
 */
export async function extractPhotoExif(input: ExifInput): Promise<PhotoExif> {
  const parsed: unknown = await exifr.parse(input, EXIFR_OPTIONS);
  return photoExifFromTags(isRecord(parsed) ? parsed : {});
}

/**
 * The pure half of extraction: normalised EXIF tags in, `PhotoExif` out.
 * Exported so the derivation can be exercised without a file.
 */
export function photoExifFromTags(bag: ExifBag): PhotoExif {
  const result: PhotoExif = {};

  // exifr converts the GPSLatitude/GPSLongitude DMS rationals into signed
  // decimal degrees using the N/S/E/W refs and exposes them as latitude /
  // longitude. Both are only set when the coordinate pair is complete.
  const lat = asNumber(bag['latitude']);
  const lon = asNumber(bag['longitude']);
  if (lat !== undefined && lon !== undefined) {
    result.lat = lat;
    result.lon = lon;
  }

  const altitudeM = signedAltitudeM(bag);
  if (altitudeM !== undefined) result.gpsAltitudeM = altitudeM;

  const direction = asNumber(bag['GPSImgDirection']);
  if (direction !== undefined) result.imgDirectionDeg = normaliseBearingDeg(direction);
  const directionRef = asDirectionRef(bag['GPSImgDirectionRef']);
  if (directionRef !== undefined) result.imgDirectionRef = directionRef;

  const focalLengthMm = asNumber(bag['FocalLength']);
  if (focalLengthMm !== undefined && focalLengthMm > 0) result.focalLengthMm = focalLengthMm;

  const focal35 = asNumber(bag['FocalLengthIn35mmFormat']);
  if (focal35 !== undefined && focal35 > 0) result.focalLength35mmMm = focal35;

  // PixelXDimension / PixelYDimension. ImageWidth / ImageHeight in IFD0 is the
  // second-best source: many cameras leave it describing the thumbnail.
  const widthPx = asNumber(bag['ExifImageWidth']) ?? asNumber(bag['ImageWidth']);
  const heightPx = asNumber(bag['ExifImageHeight']) ?? asNumber(bag['ImageHeight']);
  if (widthPx !== undefined && widthPx > 0) result.imageWidthPx = widthPx;
  if (heightPx !== undefined && heightPx > 0) result.imageHeightPx = heightPx;

  if (result.focalLength35mmMm !== undefined) {
    const hFovDeg = hFovDegFromFocalLength35mm(result.focalLength35mmMm);
    result.hFovDeg = hFovDeg;
    if (result.imageWidthPx !== undefined && result.imageHeightPx !== undefined) {
      result.vFovDeg = vFovDegFromHFov(hFovDeg, result.imageWidthPx, result.imageHeightPx);
    }
  }

  return result;
}
