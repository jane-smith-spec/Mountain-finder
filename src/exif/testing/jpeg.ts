/**
 * Minimal JPEG + EXIF *writer*, used only to author test fixtures.
 *
 * `exifr` reads EXIF but cannot write it, and this environment has no
 * `exiftool`, so fixture photos are built here from first principles. Two
 * pieces, both deliberately tiny:
 *
 *   1. a TIFF/EXIF serialiser (APP1 segment: IFD0 + Exif SubIFD + GPS IFD);
 *   2. a baseline JPEG carrying a uniform mid-grey image of chosen dimensions.
 *
 * The image itself is irrelevant to the tests — what matters is that the file
 * is a genuinely well-formed JPEG whose EXIF says exactly what we authored, so
 * that the extractor is exercised against real bytes rather than a stub.
 *
 * Everything is deterministic: the same spec always produces the same bytes.
 */

const LITTLE_ENDIAN = true;
const TIFF_HEADER_SIZE = 8;

/** EXIF stores non-integers as a numerator/denominator pair. */
export interface Rational {
  readonly num: number;
  readonly den: number;
}

export const rational = (num: number, den = 1): Rational => ({ num, den });

/**
 * Express a decimal with `decimals` digits exactly as an EXIF rational,
 * e.g. `decimalRational(137.25, 2)` → 13725/100.
 */
export function decimalRational(value: number, decimals: number): Rational {
  const den = 10 ** decimals;
  return { num: Math.round(value * den), den };
}

export type TiffFieldValue =
  | { readonly type: 'BYTE'; readonly values: readonly number[] }
  | { readonly type: 'ASCII'; readonly value: string }
  | { readonly type: 'SHORT'; readonly values: readonly number[] }
  | { readonly type: 'LONG'; readonly values: readonly number[] }
  | { readonly type: 'RATIONAL'; readonly values: readonly Rational[] };

export interface TiffField {
  readonly tag: number;
  readonly value: TiffFieldValue;
}

/** The three IFDs a photo's APP1 segment normally carries. */
export interface ExifSpec {
  readonly ifd0?: readonly TiffField[];
  readonly exif?: readonly TiffField[];
  readonly gps?: readonly TiffField[];
}

const TYPE_CODES: Readonly<Record<TiffFieldValue['type'], number>> = {
  BYTE: 1,
  ASCII: 2,
  SHORT: 3,
  LONG: 4,
  RATIONAL: 5,
};

const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_GPS_IFD_POINTER = 0x8825;

function componentCount(value: TiffFieldValue): number {
  switch (value.type) {
    case 'ASCII':
      return value.value.length + 1; // NUL terminator counts
    case 'BYTE':
    case 'SHORT':
    case 'LONG':
    case 'RATIONAL':
      return value.values.length;
  }
}

function encodePayload(value: TiffFieldValue): Uint8Array {
  switch (value.type) {
    case 'BYTE': {
      const out = new Uint8Array(value.values.length);
      value.values.forEach((n, i) => {
        out[i] = n & 0xff;
      });
      return out;
    }
    case 'ASCII': {
      const out = new Uint8Array(value.value.length + 1);
      for (let i = 0; i < value.value.length; i += 1) {
        out[i] = value.value.charCodeAt(i) & 0x7f;
      }
      return out; // final byte stays 0: the NUL terminator
    }
    case 'SHORT': {
      const out = new Uint8Array(value.values.length * 2);
      const view = new DataView(out.buffer);
      value.values.forEach((n, i) => {
        view.setUint16(i * 2, n, LITTLE_ENDIAN);
      });
      return out;
    }
    case 'LONG': {
      const out = new Uint8Array(value.values.length * 4);
      const view = new DataView(out.buffer);
      value.values.forEach((n, i) => {
        view.setUint32(i * 4, n, LITTLE_ENDIAN);
      });
      return out;
    }
    case 'RATIONAL': {
      const out = new Uint8Array(value.values.length * 8);
      const view = new DataView(out.buffer);
      value.values.forEach((r, i) => {
        view.setUint32(i * 8, r.num, LITTLE_ENDIAN);
        view.setUint32(i * 8 + 4, r.den, LITTLE_ENDIAN);
      });
      return out;
    }
  }
}

/**
 * Serialise one IFD. Payloads of four bytes or fewer live inline in the entry;
 * longer ones go into a data area straight after the entry table, referenced by
 * an offset measured from the start of the TIFF header — hence `ifdOffset`.
 */
function serialiseIfd(fields: readonly TiffField[], ifdOffset: number): Uint8Array {
  const entries = [...fields]
    .sort((a, b) => a.tag - b.tag) // TIFF requires ascending tag order
    .map((field) => ({ field, payload: encodePayload(field.value) }));

  const tableSize = 2 + 12 * entries.length + 4;
  const dataSize = entries
    .map(({ payload }) => (payload.length > 4 ? payload.length + (payload.length % 2) : 0))
    .reduce((total, size) => total + size, 0);

  const out = new Uint8Array(tableSize + dataSize);
  const view = new DataView(out.buffer);
  view.setUint16(0, entries.length, LITTLE_ENDIAN);

  let dataCursor = tableSize;
  for (const [index, { field, payload }] of entries.entries()) {
    const entryAt = 2 + 12 * index;
    view.setUint16(entryAt, field.tag, LITTLE_ENDIAN);
    view.setUint16(entryAt + 2, TYPE_CODES[field.value.type], LITTLE_ENDIAN);
    view.setUint32(entryAt + 4, componentCount(field.value), LITTLE_ENDIAN);
    if (payload.length <= 4) {
      out.set(payload, entryAt + 8);
    } else {
      view.setUint32(entryAt + 8, ifdOffset + dataCursor, LITTLE_ENDIAN);
      out.set(payload, dataCursor);
      dataCursor += payload.length + (payload.length % 2);
    }
  }
  // The "next IFD offset" longword after the table stays 0: no IFD1/thumbnail.
  return out;
}

const longField = (tag: number, value: number): TiffField => ({
  tag,
  value: { type: 'LONG', values: [value] },
});

/** Build the TIFF structure that sits inside an APP1 segment. */
export function buildExifTiff(spec: ExifSpec): Uint8Array {
  const exifFields = spec.exif ?? [];
  const gpsFields = spec.gps ?? [];

  const ifd0Fields: TiffField[] = [...(spec.ifd0 ?? [])];
  if (exifFields.length > 0) ifd0Fields.push(longField(TAG_EXIF_IFD_POINTER, 0));
  if (gpsFields.length > 0) ifd0Fields.push(longField(TAG_GPS_IFD_POINTER, 0));

  // Pointer entries are LONGs, so they are stored inline and filling in the
  // real offsets cannot change any IFD's size — one measuring pass suffices.
  const ifd0Size = serialiseIfd(ifd0Fields, TIFF_HEADER_SIZE).length;
  const exifOffset = TIFF_HEADER_SIZE + ifd0Size;
  const exifSize = exifFields.length > 0 ? serialiseIfd(exifFields, exifOffset).length : 0;
  const gpsOffset = exifOffset + exifSize;

  const resolvedIfd0 = ifd0Fields.map((field) => {
    if (field.tag === TAG_EXIF_IFD_POINTER) return longField(field.tag, exifOffset);
    if (field.tag === TAG_GPS_IFD_POINTER) return longField(field.tag, gpsOffset);
    return field;
  });

  const header = new Uint8Array(TIFF_HEADER_SIZE);
  const headerView = new DataView(header.buffer);
  header[0] = 0x49; // 'I'
  header[1] = 0x49; // 'I' — little-endian byte order
  headerView.setUint16(2, 42, LITTLE_ENDIAN); // TIFF magic
  headerView.setUint32(4, TIFF_HEADER_SIZE, LITTLE_ENDIAN); // offset of IFD0

  return concat([
    header,
    serialiseIfd(resolvedIfd0, TIFF_HEADER_SIZE),
    exifFields.length > 0 ? serialiseIfd(exifFields, exifOffset) : new Uint8Array(0),
    gpsFields.length > 0 ? serialiseIfd(gpsFields, gpsOffset) : new Uint8Array(0),
  ]);
}

const EXIF_IDENTIFIER = Uint8Array.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"

function marker(byte2: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  if (length > 0xffff) throw new RangeError(`JPEG segment too large: ${String(length)} bytes`);
  const head = Uint8Array.from([0xff, byte2, (length >> 8) & 0xff, length & 0xff]);
  return concat([head, payload]);
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Flat quantisation table; the value is irrelevant for a DC-only image. */
function quantisationTable(destination: number): Uint8Array {
  const payload = new Uint8Array(65);
  payload[0] = destination & 0x0f; // 8-bit precision, table id
  payload.fill(16, 1);
  return marker(0xdb, payload);
}

/**
 * A two-code canonical Huffman table: codes '00' -> symbol 0, '01' -> symbol 1.
 * Symbol 0 means "DC difference category 0" in a DC table and "end of block"
 * in an AC table, which is all a uniform image ever needs.
 */
function huffmanTable(tableClass: number, destination: number): Uint8Array {
  const bits = new Uint8Array(16);
  bits[1] = 2; // two codes of length 2
  return marker(
    0xc4,
    concat([Uint8Array.from([((tableClass & 0x0f) << 4) | (destination & 0x0f)]), bits, Uint8Array.from([0x00, 0x01])]),
  );
}

function startOfFrame(widthPx: number, heightPx: number): Uint8Array {
  const payload = new Uint8Array(6 + 3 * 3);
  const view = new DataView(payload.buffer);
  payload[0] = 8; // sample precision
  view.setUint16(1, heightPx, false); // JPEG is big-endian
  view.setUint16(3, widthPx, false);
  payload[5] = 3; // three components (Y, Cb, Cr)
  const components: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [2, 1],
    [3, 1],
  ];
  components.forEach(([id, quantTable], i) => {
    const at = 6 + i * 3;
    payload[at] = id;
    payload[at + 1] = 0x11; // 1x1 sampling: no chroma subsampling
    payload[at + 2] = quantTable;
  });
  return marker(0xc0, payload);
}

function startOfScan(): Uint8Array {
  const payload = Uint8Array.from([
    3, // components in scan
    1,
    0x00, // Y  -> DC table 0, AC table 0
    2,
    0x11, // Cb -> DC table 1, AC table 1
    3,
    0x11, // Cr -> DC table 1, AC table 1
    0,
    63,
    0, // Ss, Se, Ah/Al — baseline sequential
  ]);
  return marker(0xda, payload);
}

/**
 * Entropy-coded data for a uniform mid-grey image.
 *
 * Every block is "DC difference 0, then end of block" = code '00' twice = four
 * zero bits; three blocks per 8x8 MCU makes twelve zero bits per MCU. The
 * stream is therefore all zero bytes, so no 0xFF byte stuffing can arise. The
 * final byte is padded with 1 bits as the standard requires.
 */
function entropyData(widthPx: number, heightPx: number): Uint8Array {
  const mcuCount = Math.ceil(widthPx / 8) * Math.ceil(heightPx / 8);
  const bitCount = mcuCount * 12;
  const byteCount = Math.ceil(bitCount / 8);
  const out = new Uint8Array(byteCount);
  const spareBits = byteCount * 8 - bitCount;
  if (spareBits > 0) {
    const lastIndex = byteCount - 1;
    const padding = (1 << spareBits) - 1;
    out[lastIndex] = padding;
  }
  return out;
}

export interface JpegSpec {
  readonly widthPx: number;
  readonly heightPx: number;
  /** Omit entirely to produce a photo with no EXIF at all (a "stripped" photo). */
  readonly exif?: ExifSpec;
}

/**
 * Encode a uniform mid-grey baseline JPEG of the given pixel dimensions, with
 * the given EXIF (if any) in its APP1 segment.
 */
export function encodeJpeg(spec: JpegSpec): Uint8Array {
  const { widthPx, heightPx } = spec;
  if (!Number.isInteger(widthPx) || !Number.isInteger(heightPx) || widthPx < 1 || heightPx < 1) {
    throw new RangeError(
      `JPEG dimensions must be positive integers, got ${String(widthPx)}x${String(heightPx)}`,
    );
  }

  const app1 =
    spec.exif === undefined
      ? new Uint8Array(0)
      : marker(0xe1, concat([EXIF_IDENTIFIER, buildExifTiff(spec.exif)]));

  return concat([
    Uint8Array.from([0xff, 0xd8]), // SOI
    app1,
    quantisationTable(0),
    quantisationTable(1),
    startOfFrame(widthPx, heightPx),
    huffmanTable(0, 0), // DC table 0
    huffmanTable(1, 0), // AC table 0
    huffmanTable(0, 1), // DC table 1
    huffmanTable(1, 1), // AC table 1
    startOfScan(),
    entropyData(widthPx, heightPx),
    Uint8Array.from([0xff, 0xd9]), // EOI
  ]);
}
