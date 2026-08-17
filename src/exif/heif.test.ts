/**
 * The HEIF container reader — unit tests.
 *
 * Two halves, and the split matters:
 *
 *   1. **Real committed photographs.** These prove the reader works on files a
 *      phone actually wrote, including the ones exifr refuses. The expected
 *      values are not captured from this code — the four Railroad Ridge and
 *      lookout-family files are ALSO readable by exifr's own HEIC path, and
 *      `extract.test.ts` has been reading them that way since before this
 *      module existed. Agreement between two independent readers is the check.
 *      For the two HDR files exifr cannot read at all, the expectations are the
 *      documented ones from `docs/REAL-PHOTO-POSE.md`.
 *   2. **Hand-built containers**, byte by byte, for the paths a real file will
 *      not take: a truncated extent, an unsupported construction method, a
 *      declared TIFF offset that points at nothing. Each must produce a NAMED
 *      failure. A silent `{}` here is the bug this module was written to kill,
 *      so "returns nothing" is never an acceptable answer to any of them.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractPhotoExif } from './extract';
import { findHeifExif, heifBrands, isHeif } from './heif';

const REAL = fileURLToPath(new URL('../../fixtures/photos/real/', import.meta.url));
const bytesOf = (name: string): Uint8Array => new Uint8Array(readFileSync(REAL + name));

/* ══════════════════════════════════════════════════════════════════════════
 * Real photographs
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the committed HEIC originals', () => {
  // ftyp sizes measured from the files: 44 bytes for the three Railroad Ridge
  // frames, 52 for the two HDR ones. exifr's HEIF detection rejects anything
  // over 50, which is exactly the line the last two fall on the wrong side of.
  const cases = [
    { file: 'railroad-ridge-48mm.heic', ftypSize: 44, heading: 174.08944701476096, focal35: 48 },
    { file: 'railroad-ridge-24mm.heic', ftypSize: 44, heading: 173.1506958250497, focal35: 24 },
    { file: 'railroad-ridge-14mm.heic', ftypSize: 44, heading: 203.61083984375, focal35: 14 },
    { file: 'hdr-gainmap-7270.heic', ftypSize: 52, heading: 280.33596801190254, focal35: 24 },
    { file: 'hdr-gainmap-6594.heic', ftypSize: 52, heading: 253.04632587859425, focal35: 24 },
    { file: 'idaho-6812-14mm.heic', ftypSize: 52, heading: 298.2954559354168, focal35: 14 },
    { file: 'idaho-6815-24mm.heic', ftypSize: 52, heading: 76.80279542566709, focal35: 24 },
    { file: 'idaho-6750-480mm.heic', ftypSize: 52, heading: 17.166229248046875, focal35: 480 },
  ] as const;

  it.each(cases)('reads $file, whose ftyp box is $ftypSize bytes', async (testCase) => {
    const bytes = bytesOf(testCase.file);

    // The size that decides whether exifr will look at this file at all.
    const declaredFtypSize =
      ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
    expect(declaredFtypSize).toBe(testCase.ftypSize);

    expect(isHeif(bytes)).toBe(true);
    const located = findHeifExif(bytes);
    expect(located.failure).toBeUndefined();
    expect(located.tiff).toBeDefined();

    // A TIFF block starts with a byte-order mark and the answer 42. Checked
    // here rather than trusted, because handing a parser the wrong slice is
    // how you get plausible values out of the wrong bytes.
    const tiff = located.tiff ?? new Uint8Array();
    const mark = String.fromCharCode(tiff[0] ?? 0, tiff[1] ?? 0);
    expect(['II', 'MM']).toContain(mark);
    expect(tiff.length).toBeGreaterThan(100);

    const exif = await extractPhotoExif(bytes);
    expect(exif.imgDirectionDeg).toBe(testCase.heading);
    expect(exif.imgDirectionRef).toBe('T');
    expect(exif.focalLength35mmMm).toBe(testCase.focal35);
    expect(exif.unreadable).toBeUndefined();
  });

  it('agrees with exifr on every file exifr is willing to read', async () => {
    // The independence check. exifr's own HEIC path and this module's reader
    // are unrelated implementations; where both will answer, they must agree
    // exactly. If this ever fails, one of the two is slicing the wrong bytes.
    const { default: exifr } = await import('exifr');
    for (const testCase of cases.filter((entry) => entry.ftypSize <= 50)) {
      const bytes = bytesOf(testCase.file);
      const theirs = (await exifr.parse(bytes, {
        tiff: true,
        ifd0: {},
        exif: true,
        gps: true,
        translateValues: false,
        mergeOutput: true,
      })) as Record<string, unknown>;
      const ours = await extractPhotoExif(bytes);
      expect(ours.imgDirectionDeg).toBe(theirs['GPSImgDirection']);
      expect(ours.lat).toBe(theirs['latitude']);
      expect(ours.lon).toBe(theirs['longitude']);
      expect(ours.focalLength35mmMm).toBe(theirs['FocalLengthIn35mmFormat']);
    }
  });

  it('is the ONLY reader for the HDR files — exifr refuses them outright', async () => {
    // The finding, as an executable claim. If a future exifr fixes its ftyp
    // cap this test fails, and that is the correct outcome: it means the
    // reason this module exists has changed and somebody should read why.
    const { default: exifr } = await import('exifr');
    for (const testCase of cases.filter((entry) => entry.ftypSize > 50)) {
      const bytes = bytesOf(testCase.file);
      await expect(exifr.parse(bytes, { tiff: true, gps: true })).rejects.toThrow(
        /unknown file format/i,
      );
      const ours = await extractPhotoExif(bytes);
      expect(ours.lat).toBeDefined();
      expect(ours.imgDirectionDeg).toBeDefined();
    }
  });

  it('reads the lookout original, a 52-byte ftyp that carries a lens and NO GPS', async () => {
    // The case that shows why "exifr refused it" and "the file has nothing"
    // had to be told apart. This file is refused by exifr for its ftyp size,
    // exactly like the two above — and when it IS read, it turns out to carry
    // a lens and genuinely no position. Had the refusal stood, the absence
    // would have looked identical and been believed for the wrong reason.
    const bytes = bytesOf('lookout-snow-haze.heic');
    const declared =
      ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
    expect(declared).toBe(52);

    const exif = await extractPhotoExif(bytes);
    expect(exif.unreadable).toBeUndefined();
    expect(exif.focalLength35mmMm).toBe(24);
    expect(exif.imageWidthPx).toBe(5712);
    // Never geotagged — not stripped in transit. Asserted, because it is the
    // fact that closes the question rather than leaving it open.
    expect(exif.lat).toBeUndefined();
    expect(exif.lon).toBeUndefined();
    expect(exif.imgDirectionDeg).toBeUndefined();
  });

  it('reports the HDR files’ gain-map brands, which is what trips exifr up', () => {
    const brands = heifBrands(bytesOf('hdr-gainmap-7270.heic'));
    expect(brands[0]).toBe('heic');
    // `MiHA` is the gain-map brand; its presence is why the box is 52 bytes.
    expect(brands).toContain('MiHA');
    expect(brands).toContain('heix');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Hand-built containers — every refusal must be NAMED
 * ══════════════════════════════════════════════════════════════════════════ */

/** A big-endian box: 4-byte size, 4-char type, payload. */
function box(type: string, payload: readonly number[]): number[] {
  const size = 8 + payload.length;
  return [
    (size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff,
    ...[...type].map((character) => character.charCodeAt(0)),
    ...payload,
  ];
}

const chars = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
const u32be = (value: number): number[] => [
  (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff,
];

/** `ftyp` with `heic` major brand and however many compatible brands are given. */
function ftyp(compatible: readonly string[]): number[] {
  return box('ftyp', [
    ...chars('heic'), 0, 0, 0, 0,
    ...compatible.flatMap((brand) => chars(brand)),
  ]);
}

/** An `infe` v2 declaring one item id with one four-character type. */
function infe(itemId: number, itemType: string): number[] {
  return box('infe', [
    2, 0, 0, 0,                       // version 2, flags
    (itemId >> 8) & 0xff, itemId & 0xff,
    0, 0,                             // item_protection_index
    ...chars(itemType),
    0,                                // item_name, empty
  ]);
}

/** An `iloc` v1 with 4-byte offsets and lengths, one extent for one item. */
function iloc(
  itemId: number,
  offset: number,
  length: number,
  constructionMethod = 0,
): number[] {
  return box('iloc', [
    1, 0, 0, 0,                       // version 1, flags
    0x44,                             // offset_size 4, length_size 4
    0x00,                             // base_offset_size 0, index_size 0
    0, 1,                             // item_count
    (itemId >> 8) & 0xff, itemId & 0xff,
    0, constructionMethod,            // reserved + construction_method
    0, 0,                             // data_reference_index
    0, 1,                             // extent_count
    ...u32be(offset), ...u32be(length),
  ]);
}

/**
 * Assemble a container. `exifPayload` is placed after the boxes and the `iloc`
 * offset is patched to point at it, so the file is internally consistent.
 */
function container(options: {
  readonly compatible?: readonly string[];
  readonly itemType?: string;
  readonly exifPayload?: readonly number[];
  readonly constructionMethod?: number;
  /** Declare a length longer than the payload actually is. */
  readonly overstateLengthBy?: number;
  readonly omit?: 'meta' | 'iinf' | 'iloc';
}): Uint8Array {
  const payload = options.exifPayload ?? [
    ...u32be(0),                      // ExifDataBlock: TIFF starts immediately
    ...chars('II'), 0x2a, 0x00,       // little-endian TIFF, answer 42
    ...u32be(8),
    0, 0,                             // zero IFD entries
    ...u32be(0),
    ...new Array<number>(64).fill(0), // padding so length checks have room
  ];

  const inner = [
    ...(options.omit === 'iinf' ? [] : box('iinf', [0, 0, 0, 0, 0, 1, ...infe(1, options.itemType ?? 'Exif')])),
    ...(options.omit === 'iloc' ? [] : iloc(1, 0, payload.length + (options.overstateLengthBy ?? 0), options.constructionMethod ?? 0)),
  ];
  const meta = box('meta', [0, 0, 0, 0, ...inner]);
  const head = [...ftyp(options.compatible ?? ['mif1', 'MiHB', 'MiHA', 'heix']), ...(options.omit === 'meta' ? [] : meta)];

  // Patch the iloc extent offset now that the header length is known.
  const bytes = new Uint8Array([...head, ...payload]);
  if (options.omit !== 'meta' && options.omit !== 'iloc') {
    for (let index = 0; index + 4 <= bytes.length; index += 1) {
      if (String.fromCharCode(...bytes.subarray(index, index + 4)) !== 'iloc') continue;
      // Content offsets inside the iloc payload, which starts 4 bytes past
      // the type: version+flags 0..3, sizes 4, baseSizes 5, item_count 6..7,
      // item_ID 8..9, reserved+construction_method 10..11,
      // data_reference_index 12..13, extent_count 14..15, extent_offset 16.
      bytes.set(u32be(head.length), index + 4 + 16);
      break;
    }
  }
  return bytes;
}

describe('refusals are named, never silent', () => {
  it('accepts the hand-built container, so the negatives below mean something', async () => {
    const bytes = container({});
    expect(isHeif(bytes)).toBe(true);
    const located = findHeifExif(bytes);
    expect(located.failure).toBeUndefined();
    expect(String.fromCharCode(...(located.tiff ?? new Uint8Array()).subarray(0, 2))).toBe('II');
  });

  it('a 52-byte ftyp is accepted — the whole point of this module', () => {
    // A ftyp box is 8 (head) + 4 (major brand) + 4 (reserved) + 4 per
    // compatible brand, so nine compatible brands gives exactly the 52 bytes
    // the real HDR files carry — two over exifr's limit of 50.
    const bytes = container({
      compatible: ['mif1', 'MiHB', 'MiHA', 'heix', 'miaf', 'MiPr', 'miHB', 'unif', 'heic'],
    });
    const declared = (bytes[0] ?? 0) * 16777216 + (bytes[1] ?? 0) * 65536 + (bytes[2] ?? 0) * 256 + (bytes[3] ?? 0);
    expect(declared).toBeGreaterThan(50);
    expect(findHeifExif(bytes).failure).toBeUndefined();
  });

  it('names a missing meta box', () => {
    expect(findHeifExif(container({ omit: 'meta' })).failure).toBe('no-meta-box');
  });

  it('names a missing item-info box', () => {
    expect(findHeifExif(container({ omit: 'iinf' })).failure).toBe('no-item-info');
  });

  it('names a container that holds items but no Exif item', () => {
    expect(findHeifExif(container({ itemType: 'hvc1' })).failure).toBe('no-exif-item');
  });

  it('names a missing item-location box', () => {
    expect(findHeifExif(container({ omit: 'iloc' })).failure).toBe('no-item-location');
  });

  it('refuses a construction method it cannot follow rather than reading the file offset anyway', () => {
    // Method 1 means the bytes live in `idat`, so the same number means a
    // different place. Following it as a file offset would slice real bytes
    // from the wrong location — the failure with no symptoms.
    expect(findHeifExif(container({ constructionMethod: 1 })).failure).toBe(
      'unsupported-construction-method',
    );
  });

  it('refuses an extent that runs past the end of the file', () => {
    expect(findHeifExif(container({ overstateLengthBy: 4096 })).failure).toBe(
      'extent-out-of-bounds',
    );
  });

  it('refuses a payload that is not a TIFF, rather than handing over 60 arbitrary bytes', () => {
    const notTiff = [...u32be(0), ...new Array<number>(80).fill(0x5a)];
    expect(findHeifExif(container({ exifPayload: notTiff })).failure).toBe('not-tiff');
  });

  it('finds the TIFF when the declared offset is the Exif\\0\\0 form', () => {
    // Offset 6, skipping "Exif\0\0" — legal, and written by some encoders.
    const withPrefix = [
      ...u32be(6), ...chars('Exif'), 0, 0,
      ...chars('II'), 0x2a, 0x00, ...u32be(8), 0, 0, ...u32be(0),
      ...new Array<number>(64).fill(0),
    ];
    const located = findHeifExif(container({ exifPayload: withPrefix }));
    expect(located.failure).toBeUndefined();
    expect(String.fromCharCode(...(located.tiff ?? new Uint8Array()).subarray(0, 2))).toBe('II');
  });

  it('recovers when the declared offset is WRONG but a TIFF is there', () => {
    // A lie in the offset field must not become a slice from the wrong place:
    // the reader searches a bounded window for the byte-order mark and uses
    // that, or refuses. Here the offset claims 40 and the TIFF is at 0.
    const lying = [
      ...u32be(40),
      ...chars('II'), 0x2a, 0x00, ...u32be(8), 0, 0, ...u32be(0),
      ...new Array<number>(64).fill(0),
    ];
    const located = findHeifExif(container({ exifPayload: lying }));
    expect(located.failure).toBeUndefined();
    expect(String.fromCharCode(...(located.tiff ?? new Uint8Array()).subarray(0, 2))).toBe('II');
  });
});

describe('isHeif and heifBrands', () => {
  it('says no to a JPEG — including one named .HEIC', () => {
    // IMG_1371.HEIC in the supplied set was a JPEG with a HEIC extension. The
    // extension is not evidence; the ftyp box is.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...chars('JFIF'), 0]);
    expect(isHeif(jpeg)).toBe(false);
    expect(heifBrands(jpeg)).toEqual([]);
    expect(findHeifExif(jpeg).failure).toBe('not-heif');
  });

  it('says no to bytes too short to hold a box header', () => {
    expect(isHeif(new Uint8Array([0, 0, 0]))).toBe(false);
    expect(isHeif(new Uint8Array(0))).toBe(false);
  });

  it('says no to a ftyp whose declared size runs past the file', () => {
    const lying = new Uint8Array([0xff, 0xff, 0xff, 0xff, ...chars('ftyp'), ...chars('heic')]);
    expect(heifBrands(lying)).toEqual([]);
  });

  it('reads the major brand first, then the compatible brands in order', () => {
    expect(heifBrands(container({ compatible: ['mif1', 'heix'] }))).toEqual([
      'heic',
      'mif1',
      'heix',
    ]);
  });
});

describe('extractPhotoExif on an unreadable container', () => {
  it('reports WHY rather than an empty result a caller would read as "no metadata"', async () => {
    const exif = await extractPhotoExif(container({ itemType: 'hvc1' }));
    expect(exif.unreadable).toBeDefined();
    expect(exif.unreadable?.container).toBe('heif');
    expect(exif.unreadable?.cause).toBe('no-exif-item');
    // The detail has to be enough to diagnose without re-running anything.
    expect(exif.unreadable?.detail).toContain('heic');
    // …and it must not fabricate any pose field alongside the complaint.
    expect(exif.lat).toBeUndefined();
    expect(exif.imgDirectionDeg).toBeUndefined();
  });

  it('leaves `unreadable` absent for a file that genuinely carries no EXIF', async () => {
    // The distinction this field exists for. A stripped JPEG is not
    // "unreadable" — it was read, and there was nothing in it.
    const exif = await extractPhotoExif(new Uint8Array(readFileSync(REAL + 'tundra-blue-sky.jpeg')));
    expect(exif.unreadable).toBeUndefined();
    expect(exif.lat).toBeUndefined();
    expect(exif.imageWidthPx).toBe(4032);
  });
});
