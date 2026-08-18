/**
 * P3.1 — EXIF extraction.
 *
 * Reads one photo's metadata with `exifr` and normalises it into `PhotoExif`.
 * This module does exactly three things beyond reading tags:
 *   1. applies GPSAltitudeRef so a below-sea-level altitude comes out negative;
 *   2. applies Orientation, so the reported pixel dimensions are the ones the
 *      picture is DISPLAYED at rather than the ones it happens to be stored at;
 *   3. derives hFov/vFov from the 35 mm-equivalent focal length, giving the
 *      36 mm gate angle to the longer displayed axis (see fov.ts).
 *
 * It deliberately does NOT resolve magnetic headings, invent defaults, or fall
 * back to terrain elevation — that is resolve.ts and the caller's providers.
 */

// Default import on purpose: exifr ships a UMD/CommonJS `main` and an ESM
// `module`, and only the default export exists in both. Named imports break
// under plain Node ESM.
import exifr from 'exifr';

import { normaliseBearingDeg } from './bearing';
import { fovDegFromFocalLength35mm } from './fov';
import { findHeifExif, isHeif } from './heif';
import type { DirectionRef, PhotoExif } from './types';

/** Anything exifr can read. `string` is a filesystem path (Node) or URL (browser). */
export type ExifInput = ArrayBuffer | Uint8Array | DataView | Blob | string;

/**
 * The input as bytes, when it is something we already hold.
 *
 * A `string` is a path or URL and reading it would put filesystem or network
 * I/O into a module that runs in both, so it is left to exifr. Everything the
 * app and the scripts actually pass — a `File` from an input element, a
 * `Uint8Array` from `readFile` — is covered. See {@link extractPhotoExif}.
 */
async function bytesOf(input: ExifInput): Promise<Uint8Array | undefined> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof DataView !== 'undefined' && input instanceof DataView) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  return undefined;
}

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

// Moved to ./bearing.ts so consumers that want the angle arithmetic without a
// JPEG parser can have it; re-exported here so every existing import stands.
export { bearingDeltaDeg, normaliseBearingDeg } from './bearing';

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
 * EXIF Orientation values that rotate the frame a quarter turn — 5 through 8 —
 * so the displayed picture is the stored one transposed.
 *
 * The eight values pair a rotation with an optional mirror (1 = as stored,
 * 3 = 180°, 6 = 90° CW, 8 = 90° CCW, and 2/4/5/7 are those with a flip). Only
 * the quarter turns change which axis is which, and only that matters here: a
 * mirror leaves both dimensions and both fields of view exactly where they are.
 */
const TRANSPOSING_ORIENTATIONS: ReadonlySet<number> = new Set([5, 6, 7, 8]);

/** Whether this Orientation value swaps the frame's width and height. */
export function orientationTransposes(orientation: number | undefined): boolean {
  return orientation !== undefined && TRANSPOSING_ORIENTATIONS.has(orientation);
}

/**
 * Pull the pose-relevant EXIF out of a photo.
 *
 * Missing tags come back as absent properties, never as zeros or guesses.
 * A photo with no EXIF at all yields `{}`.
 */
export async function extractPhotoExif(input: ExifInput): Promise<PhotoExif> {
  const bytes = await bytesOf(input);

  // HEIF goes through our own container reader rather than exifr's. Not a
  // preference: exifr refuses any HEIF file whose `ftyp` box exceeds 50 bytes,
  // which is every iPhone photograph carrying an HDR gain map — three of the
  // seven supplied to this project — and it refuses them by reporting no
  // metadata at all. heif.ts explains the measurement. Once the TIFF block is
  // located, exifr parses it: the tag decoding was never the problem.
  if (bytes !== undefined && isHeif(bytes)) {
    const located = findHeifExif(bytes);
    if (located.tiff === undefined) {
      return {
        unreadable: {
          container: 'heif',
          cause: located.failure ?? 'unknown',
          detail: `brands [${located.brands.join(' ')}], ${bytes.length} bytes`,
        },
      };
    }
    const parsedTiff: unknown = await exifr.parse(located.tiff, EXIFR_OPTIONS);
    return photoExifFromTags(isRecord(parsedTiff) ? parsedTiff : {});
  }

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

  // Orientation is an IFD0 SHORT in 1..8. Anything outside that range is not a
  // value the standard defines, so it is dropped rather than acted on — a
  // corrupt tag must not silently transpose a photograph.
  const orientation = asNumber(bag['Orientation']);
  if (orientation !== undefined && Number.isInteger(orientation)) {
    if (orientation >= 1 && orientation <= 8) result.orientation = orientation;
  }

  // PixelXDimension / PixelYDimension. ImageWidth / ImageHeight in IFD0 is the
  // second-best source: many cameras leave it describing the thumbnail.
  //
  // Both describe the STORED frame. What every consumer here wants is the
  // DISPLAYED frame — the aspect ratio of the picture on screen, which is what
  // the field of view and the overlay's projection are about — so a
  // quarter-turn Orientation swaps them. A browser decoding the same file
  // reports the displayed dimensions too (`image-orientation: from-image` is
  // the default), so the two agree instead of contradicting each other.
  const storedWidthPx = asNumber(bag['ExifImageWidth']) ?? asNumber(bag['ImageWidth']);
  const storedHeightPx = asNumber(bag['ExifImageHeight']) ?? asNumber(bag['ImageHeight']);
  const transposed = orientationTransposes(result.orientation);
  const widthPx = transposed ? storedHeightPx : storedWidthPx;
  const heightPx = transposed ? storedWidthPx : storedHeightPx;
  if (widthPx !== undefined && widthPx > 0) result.imageWidthPx = widthPx;
  if (heightPx !== undefined && heightPx > 0) result.imageHeightPx = heightPx;

  if (result.focalLength35mmMm !== undefined) {
    if (result.imageWidthPx !== undefined && result.imageHeightPx !== undefined) {
      // Both angles together: which one gets the 36 mm gate angle depends on
      // which displayed axis is longer, so they cannot be derived separately.
      const fov = fovDegFromFocalLength35mm(
        result.focalLength35mmMm,
        result.imageWidthPx,
        result.imageHeightPx,
      );
      result.hFovDeg = fov.hFovDeg;
      result.vFovDeg = fov.vFovDeg;
    }
    // With no dimensions there is no way to know which axis the 36 mm angle
    // belongs to, and guessing "landscape" is what produced the bug this
    // module was rewritten to fix. The focal length is still reported, so a
    // caller who learns the dimensions elsewhere — the app decodes the image —
    // can derive the pair itself.
  }

  return result;
}
