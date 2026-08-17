/**
 * Types for `heic-decode`, which ships none.
 *
 * Written from the package's documented API and verified against its actual
 * return value on the committed HEICs, not guessed: `width`, `height` and an
 * RGBA `data` buffer, which is the same shape `jpeg-js` produces and therefore
 * the same shape `RgbaImage` wants.
 *
 * Scoped to scripts/ deliberately. Decoding HEIC PIXELS is a developer-tool
 * concern; reading a HEIC's METADATA needs no decoder and lives in
 * src/exif/heif.ts with no dependency at all.
 */
declare module 'heic-decode' {
  interface DecodeInput {
    readonly buffer: Uint8Array;
  }
  interface DecodedImage {
    readonly width: number;
    readonly height: number;
    /** RGBA, 4 bytes per pixel, row-major from the top left. */
    readonly data: Uint8ClampedArray;
  }
  export default function decode(input: DecodeInput): Promise<DecodedImage>;
}
