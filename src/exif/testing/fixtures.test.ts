/**
 * Guards the fixture photos themselves.
 *
 * The committed JPEGs under fixtures/photos/ must be exactly what the fixture
 * definitions describe — otherwise every "authored EXIF" expectation elsewhere
 * is checking a stale file. The JPEG structure is inspected here by walking the
 * marker segments per the JPEG spec, independently of the encoder's own logic.
 */

import { existsSync, readFileSync } from 'node:fs';

import { decode as decodeJpeg } from 'jpeg-js';
import { describe, expect, it } from 'vitest';

import { encodeFixture, PHOTO_FIXTURES } from './fixtures';
import { fixturePhotoPath } from './paths';

/** Markers that stand alone, carrying no length field. */
const STANDALONE_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);

interface JpegStructure {
  readonly markers: readonly number[];
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly app1Identifier?: string;
}

/** Walk the JPEG segment chain up to the start of scan. */
function readJpegStructure(bytes: Uint8Array): JpegStructure {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint16(0, false)).toBe(0xffd8); // SOI

  const markers: number[] = [];
  let widthPx: number | undefined;
  let heightPx: number | undefined;
  let app1Identifier: string | undefined;

  let at = 2;
  while (at + 1 < bytes.byteLength) {
    if (view.getUint8(at) !== 0xff) throw new Error(`expected a marker at offset ${String(at)}`);
    const marker = view.getUint8(at + 1);
    markers.push(marker);
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan
    if (STANDALONE_MARKERS.has(marker)) {
      at += 2;
      continue;
    }
    const length = view.getUint16(at + 2, false);
    const payloadAt = at + 4;
    if (marker === 0xc0) {
      heightPx = view.getUint16(payloadAt + 1, false);
      widthPx = view.getUint16(payloadAt + 3, false);
    }
    if (marker === 0xe1) {
      app1Identifier = [0, 1, 2, 3]
        .map((i) => String.fromCharCode(view.getUint8(payloadAt + i)))
        .join('');
    }
    at += 2 + length;
  }

  const structure: JpegStructure = { markers };
  return {
    ...structure,
    ...(widthPx === undefined ? {} : { widthPx }),
    ...(heightPx === undefined ? {} : { heightPx }),
    ...(app1Identifier === undefined ? {} : { app1Identifier }),
  };
}

describe.each(PHOTO_FIXTURES.map((fixture) => [fixture.fileName, fixture] as const))(
  'fixture photo %s',
  (_fileName, fixture) => {
    it('is committed to fixtures/photos/', () => {
      expect(existsSync(fixturePhotoPath(fixture))).toBe(true);
    });

    it('matches the fixture definition byte for byte', () => {
      const onDisk = new Uint8Array(readFileSync(fixturePhotoPath(fixture)));
      const regenerated = encodeFixture(fixture);
      // If this fails, re-run: npx tsx src/exif/testing/generate.ts
      expect(onDisk.byteLength).toBe(regenerated.byteLength);
      expect(Buffer.compare(Buffer.from(onDisk), Buffer.from(regenerated))).toBe(0);
    });

    it('is a well-formed JPEG declaring the authored pixel dimensions', () => {
      const bytes = new Uint8Array(readFileSync(fixturePhotoPath(fixture)));
      const structure = readJpegStructure(bytes);

      expect(structure.widthPx).toBe(fixture.spec.widthPx);
      expect(structure.heightPx).toBe(fixture.spec.heightPx);
      expect(structure.markers).toContain(0xda); // reached the scan
      // Trailer: end of image.
      expect([...bytes.slice(-2)]).toEqual([0xff, 0xd9]);
    });

    it('decodes as a real image in an independent JPEG decoder', () => {
      // `jpeg-js` is a third-party baseline decoder: it knows nothing about the
      // encoder in jpeg.ts, so this proves the fixtures are genuine JPEGs and
      // not merely EXIF containers with a plausible header.
      //
      // Every block is authored with a zero DC coefficient and no AC terms, so
      // after the JPEG level shift each sample is 128 — a uniform mid-grey,
      // Y = Cb = Cr = 128, which is R = G = B = 128.
      const bytes = new Uint8Array(readFileSync(fixturePhotoPath(fixture)));
      const image = decodeJpeg(bytes, { useTArray: true });

      expect(image.width).toBe(fixture.spec.widthPx);
      expect(image.height).toBe(fixture.spec.heightPx);

      const samplePixels = [
        0,
        image.width - 1,
        (image.height >> 1) * image.width + (image.width >> 1),
        image.width * image.height - 1,
      ];
      for (const pixel of samplePixels) {
        expect([...image.data.slice(pixel * 4, pixel * 4 + 4)]).toEqual([128, 128, 128, 255]);
      }
    });

    it('carries an EXIF APP1 segment only when the fixture defines EXIF', () => {
      const bytes = new Uint8Array(readFileSync(fixturePhotoPath(fixture)));
      const structure = readJpegStructure(bytes);

      if (fixture.spec.exif === undefined) {
        expect(structure.markers).not.toContain(0xe1);
        expect(structure.app1Identifier).toBeUndefined();
      } else {
        expect(structure.markers).toContain(0xe1);
        expect(structure.app1Identifier).toBe('Exif');
      }
    });
  },
);

describe('fixture set', () => {
  it('covers both hemispheres and the stripped case', () => {
    const names = PHOTO_FIXTURES.map((fixture) => fixture.fileName);
    expect(names).toContain('aconcagua-south-west.jpg'); // southern + western
    expect(names).toContain('chamonix-north-east.jpg'); // northern + eastern
    expect(names).toContain('stripped-no-exif.jpg');
  });

  it('encodes deterministically', () => {
    for (const fixture of PHOTO_FIXTURES) {
      expect(Buffer.compare(Buffer.from(encodeFixture(fixture)), Buffer.from(encodeFixture(fixture)))).toBe(0);
    }
  });
});
