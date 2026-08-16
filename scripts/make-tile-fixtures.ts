/**
 * Regenerate `fixtures/tiles/` — the committed, offline test data for the tile
 * reader. Reproducible: delete the directory, run `npm run fixtures:tiles`, and
 * the bytes come back identical.
 *
 * It writes two kinds of fixture, because they prove different things:
 *
 * 1. REAL DATA (`*-window.i16be` + `*-window.json`). A rectangle cut out of an
 *    actual SRTM tile, byte-for-byte, with a sidecar recording the source URL,
 *    the tile, the exact row/column offsets of the cut, and the resulting
 *    geometry. Tests therefore run against genuine SRTM bytes in the genuine
 *    format without a 25 MB binary in git. Requires the source tile in
 *    `data/tiles/` (gitignored) — fetch it with `npm run fetch:tiles`.
 *
 * 2. SYNTHETIC TILES (`*.hgt`, `*.hgt.gz`). Whole small tiles whose terrain is a
 *    closed-form function, so every sample and every interpolated value has an
 *    independently computable expectation. They also cover what the real cut
 *    cannot: southern/western hemisphere tile names, gzip, and VOIDS.
 *
 * ON VOIDS — verified 2026-08-16, and the reason the void fixture is synthetic:
 *    the AWS `elevation-tiles-prod/skadi` mirror is VOID-FILLED. N45E007,
 *    N46E007, N27E086 and N28E086 were downloaded and scanned: 0 void samples in
 *    51 868 804 samples. The `.hgt` format still defines −32768 as "no data" and
 *    other SRTM distributions (notably the pre-v3 USGS releases) are full of
 *    them, so the reader must handle voids — but no honest REAL fixture from
 *    this source can contain one. Fabricating voids into real data would be
 *    worse than useless, so the void path is proven on synthetic tiles instead.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

import {
  BYTES_PER_SAMPLE,
  VOID_SAMPLE,
  decodeBigEndianInt16,
  encodeBigEndianInt16,
  gridSizeForByteLength,
} from '../src/providers/hgt-tile.js';
import { parseTileName } from '../src/providers/tile-store.js';
import {
  bilinearTerrain,
  buildSyntheticHgtBytes,
  coneTerrain,
  constantTerrain,
  withVoidBlock,
  type SyntheticTileSpec,
} from '../src/providers/synthetic-tile.js';

const FIXTURE_DIR = 'fixtures/tiles';
const TILE_DIR = 'data/tiles';
const S3_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/skadi';

/* ------------------------------------------------------------------ *
 * 1. Real-data window
 * ------------------------------------------------------------------ */

/**
 * The cut. Offsets are in SOURCE TILE sample indices (row 0 = north edge of
 * N45E007 = lat 46, col 0 = west edge = lon 7), chosen to contain the Matterhorn
 * massif with several kilometres of its ridges around it.
 *
 * Two facts worth keeping straight, both visible in these bytes:
 *   * the surveyed summit (45.97639 N, 7.65861 E) falls on source row 85,
 *     col 2371, which reads 3567 m — that posting is already down the steep
 *     east side;
 *   * the highest posting of the massif is 4230 m at source row 88, col 2357
 *     (45.97556 N, 7.65472 E), about 320 m WSW of the surveyed position.
 * So SRTM both under-reads a sharp summit (4230 vs 4478 m) and displaces it.
 */
interface WindowSpec {
  readonly name: string;
  readonly tile: string;
  readonly row0: number;
  readonly col0: number;
  readonly rows: number;
  readonly cols: number;
  readonly description: string;
}

const WINDOWS: readonly WindowSpec[] = [
  {
    name: 'matterhorn-window',
    tile: 'N45E007',
    row0: 64,
    col0: 2240,
    rows: 256,
    cols: 256,
    description:
      'A 256×256 rectangle of real SRTM1 data around the Matterhorn, cut byte-for-byte out ' +
      'of the source tile. Same format as a .hgt file, but a window rather than a whole ' +
      'degree, so its geometry is written down here instead of derived from the file length.',
  },
  {
    /**
     * Zermatt village itself, from the tile NORTH of the Matterhorn's: the
     * village sits at 46.0207 N, which is above the 46° line, so it belongs to
     * N46E007 and not to N45E007. That is the tile-naming floor rule in the
     * field — a window "around Zermatt" cut from N45E007 would read somewhere
     * else entirely.
     *
     * Source row 3525, col 2697 is the posting nearest the village centre.
     */
    name: 'zermatt-window',
    tile: 'N46E007',
    row0: 3494,
    col0: 2665,
    rows: 64,
    cols: 64,
    description:
      'A 64×64 rectangle of real SRTM1 data over Zermatt village, cut byte-for-byte out of ' +
      'N46E007. Committed as the offline evidence that this mirror is void-filled: the ' +
      'valley floor reads a real elevation here, not the −32768 void marker.',
  },
];

async function writeRealWindow(WINDOW: WindowSpec): Promise<void> {
  const sourcePath = join(TILE_DIR, `${WINDOW.tile}.hgt`);
  const raw = await readFile(sourcePath).catch(() => {
    throw new Error(
      `${sourcePath} is missing. It is gitignored on purpose (25 MB). Fetch it with:\n` +
        `  npm run fetch:tiles -- ${WINDOW.tile}`,
    );
  });

  const size = gridSizeForByteLength(raw.length, WINDOW.tile);
  const corner = parseTileName(WINDOW.tile);
  if (corner === null) throw new Error(`${WINDOW.tile} is not a tile name`);
  if (WINDOW.row0 + WINDOW.rows > size || WINDOW.col0 + WINDOW.cols > size) {
    throw new Error(`Window falls outside the ${size}×${size} source tile`);
  }

  const source = decodeBigEndianInt16(raw, WINDOW.tile);
  const cut = new Int16Array(WINDOW.rows * WINDOW.cols);
  for (let r = 0; r < WINDOW.rows; r += 1) {
    for (let c = 0; c < WINDOW.cols; c += 1) {
      const value = source[(WINDOW.row0 + r) * size + (WINDOW.col0 + c)];
      if (value === undefined) throw new Error(`Source sample (${r}, ${c}) missing`);
      cut[r * WINDOW.cols + c] = value;
    }
  }

  const step = 1 / (size - 1);
  const northLat = corner.southLat + 1 - WINDOW.row0 * step;
  const westLon = corner.westLon + WINDOW.col0 * step;

  let voids = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let maxIndex = -1;
  for (let i = 0; i < cut.length; i += 1) {
    const value = cut[i];
    if (value === undefined) continue;
    if (value === VOID_SAMPLE) {
      voids += 1;
      continue;
    }
    if (value < min) min = value;
    if (value > max) {
      max = value;
      maxIndex = i;
    }
  }
  const maxRow = Math.floor(maxIndex / WINDOW.cols);
  const maxCol = maxIndex % WINDOW.cols;

  const dataName = `${WINDOW.name}.i16be`;
  await writeFile(join(FIXTURE_DIR, dataName), encodeBigEndianInt16(cut));

  const meta = {
    name: WINDOW.name,
    data: dataName,
    format: 'int16-be-row-major-north-first',
    description: WINDOW.description,
    source: {
      tile: WINDOW.tile,
      url: `${S3_BASE}/${WINDOW.tile.slice(0, 3)}/${WINDOW.tile}.hgt.gz`,
      dataset: 'SRTM1 (1 arc-second) via the AWS elevation-tiles-prod "skadi" mirror',
      sourceGridSize: size,
      extractedFromRow: WINDOW.row0,
      extractedFromCol: WINDOW.col0,
      extractedOn: '2026-08-16',
      license: 'SRTM is public domain (NASA/USGS); the AWS mirror is a public dataset.',
    },
    geometry: {
      northLat,
      westLon,
      rows: WINDOW.rows,
      cols: WINDOW.cols,
      latStepDeg: step,
      lonStepDeg: step,
    },
    bounds: {
      north: northLat,
      south: northLat - (WINDOW.rows - 1) * step,
      west: westLon,
      east: westLon + (WINDOW.cols - 1) * step,
    },
    statistics: {
      voidSamples: voids,
      minElevationM: min,
      maxElevationM: max,
      maxAt: { row: maxRow, col: maxCol, lat: northLat - maxRow * step, lon: westLon + maxCol * step },
      note:
        'voidSamples is 0 because the skadi mirror is void-filled — verified across ' +
        'N45E007, N46E007, N27E086, N28E086 (0 voids in 51 868 804 samples). The void ' +
        'code path is covered by the synthetic fixtures instead.',
    },
    accuracyCaveat:
      'SRTM under-reads AND displaces sharp summits. In N45E007 the Matterhorn tops out at ' +
      '4230 m against a surveyed 4478 m, and that posting sits ~320 m WSW of the surveyed ' +
      'summit position (which itself reads 3567 m, already down the east side); Dent ' +
      "d'Hérens 3835 vs 4171 m; the broad Grand Combin 4287 vs 4314 m. Use these tiles for " +
      "the terrain horizon; take summit heights from the peak database's ele tag.",
  };
  await writeFile(join(FIXTURE_DIR, `${WINDOW.name}.json`), `${JSON.stringify(meta, null, 2)}\n`);

  process.stdout.write(
    `  ${dataName}: ${WINDOW.rows}×${WINDOW.cols} from ${WINDOW.tile} ` +
      `(${cut.length * BYTES_PER_SAMPLE} bytes), ${voids} voids, ` +
      `min ${min} m, max ${max} m at row ${maxRow} col ${maxCol}\n`,
  );
}

/* ------------------------------------------------------------------ *
 * 2. Synthetic tiles
 * ------------------------------------------------------------------ */

/**
 * The shared terrain of the N00E000 / N01E000 pair.
 *
 *   h(lat, lon) = 500 + 300·lat + 200·lon + 400·lat·lon      metres
 *
 * A bilinear surface, so bilinear interpolation reproduces it exactly. The
 * coefficients are chosen so that every sample of a 21 × 21 grid (0.05° spacing)
 * is a whole number: 300·0.05 = 15, 200·0.05 = 10, 400·0.05·0.05 = 1.
 * Both tiles use the SAME function, which is what makes their shared boundary
 * line (lat = 1) a real test of edge duplication.
 */
const SHARED_SURFACE = bilinearTerrain({
  originLat: 0,
  originLon: 0,
  baseM: 500,
  perLatDegM: 300,
  perLonDegM: 200,
  crossM: 400,
});

/** Apex, plain and slope of the cone tile — see `coneTerrain`. */
const CONE = { apexLat: 10.5, apexLon: -9.5, apexM: 3000, plainM: 500, slopeMPerDeg: 6000 } as const;

/**
 * The void block on the cone tile, given as sample-line coordinates of the
 * 41 × 41 grid (step 0.025°): rows 8…10 × cols 8…10, a 3 × 3 patch.
 */
const CONE_VOID_BLOCK = { north: 10.8, south: 10.75, west: -9.8, east: -9.75 } as const;

interface SyntheticFixture extends SyntheticTileSpec {
  readonly gzip?: boolean;
  readonly formula: string;
}

const SYNTHETIC: readonly SyntheticFixture[] = [
  {
    name: 'N00E000',
    gridSize: 21,
    terrain: SHARED_SURFACE,
    formula: 'h = 500 + 300·lat + 200·lon + 400·lat·lon (bilinear surface, exact at 0.05° spacing)',
  },
  {
    name: 'N01E000',
    gridSize: 21,
    terrain: SHARED_SURFACE,
    formula: 'same surface as N00E000 — the two share the lat = 1 boundary line',
  },
  {
    name: 'S01W001',
    gridSize: 11,
    terrain: constantTerrain(1234),
    formula: 'h = 1234 everywhere; southern + western hemisphere naming',
  },
  {
    name: 'S02W002',
    gridSize: 11,
    terrain: constantTerrain(777),
    gzip: true,
    formula: 'h = 777 everywhere, stored gzipped to exercise the .hgt.gz path',
  },
  {
    name: 'N10W010',
    gridSize: 41,
    terrain: withVoidBlock(
      coneTerrain(CONE),
      CONE_VOID_BLOCK,
    ),
    formula:
      `h = max(${CONE.plainM}, ${CONE.apexM} − ${CONE.slopeMPerDeg}·√((lat−${CONE.apexLat})² + (lon−${CONE.apexLon})²)), ` +
      `with rows 8…10 × cols 8…10 written as voids (−32768)`,
  },
];

async function writeSynthetic(): Promise<Record<string, unknown>[]> {
  const manifest: Record<string, unknown>[] = [];
  for (const spec of SYNTHETIC) {
    const bytes = buildSyntheticHgtBytes(spec);
    const samples = decodeBigEndianInt16(bytes, spec.name);
    let voids = 0;
    for (const value of samples) if (value === VOID_SAMPLE) voids += 1;

    const file = spec.gzip === true ? `${spec.name}.hgt.gz` : `${spec.name}.hgt`;
    await writeFile(join(FIXTURE_DIR, file), spec.gzip === true ? gzipSync(bytes, { level: 9 }) : bytes);

    manifest.push({
      file,
      tile: spec.name,
      gridSize: spec.gridSize,
      sampleSpacingDeg: 1 / (spec.gridSize - 1),
      rawBytes: bytes.length,
      voidSamples: voids,
      formula: spec.formula,
    });
    process.stdout.write(
      `  ${file}: ${spec.gridSize}×${spec.gridSize}, ${bytes.length} raw bytes, ${voids} voids\n`,
    );
  }
  return manifest;
}

async function main(): Promise<void> {
  await mkdir(FIXTURE_DIR, { recursive: true });
  process.stdout.write(`Writing ${FIXTURE_DIR}\n`);
  for (const window of WINDOWS) await writeRealWindow(window);
  const synthetic = await writeSynthetic();
  await writeFile(
    join(FIXTURE_DIR, 'synthetic-manifest.json'),
    `${JSON.stringify(
      {
        generatedBy: 'npm run fixtures:tiles (scripts/make-tile-fixtures.ts)',
        format: 'Plain .hgt: big-endian int16, row-major, row 0 = north, n² samples, n from file length.',
        note:
          'Grid sizes here are not real SRTM sizes (1201/3601) on purpose — the reader ' +
          'must derive n from the file length rather than assume it.',
        tiles: synthetic,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write('Done.\n');
}

await main();
