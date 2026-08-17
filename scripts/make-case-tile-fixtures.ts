/**
 * Regenerate `fixtures/tiles/cases/` — the committed terrain the ground-truth
 * acceptance cases run against.
 *
 *   npm run fixtures:case-tiles                  # all registered cases
 *   npm run fixtures:case-tiles -- gornergrat    # one case
 *
 * Each output is a rectangle cut BYTE-FOR-BYTE out of a real SRTM1 tile, plus a
 * sidecar recording the source tile, the download URL, the exact row/column
 * offsets, the resulting geometry and the statistics of the data. Same format
 * and same schema as `fixtures/tiles/*-window.json`, which the tile reader
 * already parses; this script exists alongside `make-tile-fixtures.ts` rather
 * than inside it because these windows serve the ACCEPTANCE suite and are sized
 * by what each viewpoint's verdicts turn on — see `CASE_TERRAIN` in
 * `src/pipeline/testing/case-terrain.ts`, which is the single definition both
 * this script and the tests read.
 *
 * The source tiles are gitignored (25 MB each). Fetch them first:
 *
 *   npm run fetch:tiles -- N45E007 N37W122 N47W123 N56W006
 *
 * This script is an ACQUISITION-TIME tool. It reads local files only; it never
 * touches the network, and no test ever runs it.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  VOID_SAMPLE,
  decodeBigEndianInt16,
  encodeBigEndianInt16,
  gridSizeForByteLength,
} from '../src/providers/hgt-tile.js';
import { parseTileName } from '../src/providers/tile-store.js';
import {
  CASE_TERRAIN,
  CASE_TILE_FIXTURE_DIR,
  FULL_TILE_DIR,
  windowCut,
  type CaseTerrainSpec,
} from '../src/pipeline/testing/case-terrain.js';

const S3_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/skadi';

async function writeCaseWindow(spec: CaseTerrainSpec): Promise<void> {
  const cut = windowCut(spec);
  const sourcePath = join(FULL_TILE_DIR, `${spec.sourceTile}.hgt`);
  const raw = await readFile(sourcePath).catch(() => {
    throw new Error(
      `${sourcePath} is missing. It is gitignored on purpose (25 MB). Fetch it with:\n` +
        `  npm run fetch:tiles -- ${spec.sourceTile}`,
    );
  });

  const size = gridSizeForByteLength(raw.length, spec.sourceTile);
  const corner = parseTileName(spec.sourceTile);
  if (corner === null) throw new Error(`${spec.sourceTile} is not a tile name`);
  if (cut.row0 < 0 || cut.col0 < 0 || cut.row0 + cut.rows > size || cut.col0 + cut.cols > size) {
    throw new Error(
      `Window for ${spec.caseId} (row ${cut.row0}+${cut.rows}, col ${cut.col0}+${cut.cols}) ` +
        `falls outside the ${size}x${size} tile ${spec.sourceTile}`,
    );
  }

  const source = decodeBigEndianInt16(raw, spec.sourceTile);
  const samples = new Int16Array(cut.rows * cut.cols);
  for (let row = 0; row < cut.rows; row += 1) {
    for (let col = 0; col < cut.cols; col += 1) {
      const value = source[(cut.row0 + row) * size + (cut.col0 + col)];
      if (value === undefined) throw new Error(`Source sample (${row}, ${col}) missing`);
      samples[row * cut.cols + col] = value;
    }
  }

  const step = 1 / (size - 1);
  const northLat = corner.southLat + 1 - cut.row0 * step;
  const westLon = corner.westLon + cut.col0 * step;

  let voids = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let maxIndex = -1;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    if (value === undefined) continue;
    if (value === VOID_SAMPLE) {
      voids += 1;
      continue;
    }
    if (value < min) min = value;
    if (value > max) {
      max = value;
      maxIndex = index;
    }
  }

  const name = `${spec.caseId}-window`;
  const dataName = `${name}.i16be`;
  await writeFile(join(CASE_TILE_FIXTURE_DIR, dataName), encodeBigEndianInt16(samples));

  const meta = {
    name,
    data: dataName,
    format: 'int16-be-row-major-north-first',
    description:
      `Terrain for the "${spec.caseId}" ground-truth acceptance case: a ` +
      `${cut.rows}x${cut.cols} rectangle of real SRTM1 data cut byte-for-byte out of ` +
      `${spec.sourceTile}. Committed so the acceptance suite runs offline without ` +
      'data/tiles/, which is gitignored.',
    coverageNote: spec.coverageNote,
    sweep: spec.sweep,
    source: {
      tile: spec.sourceTile,
      url: `${S3_BASE}/${spec.sourceTile.slice(0, 3)}/${spec.sourceTile}.hgt.gz`,
      dataset: 'SRTM1 (1 arc-second) via the AWS elevation-tiles-prod "skadi" mirror',
      sourceGridSize: size,
      extractedFromRow: cut.row0,
      extractedFromCol: cut.col0,
      // The day this window was cut. Read from the clock rather than hardcoded:
      // a provenance date that silently stays at the day the script was written
      // is worse than no date, and this is an acquisition script, not core.
      extractedOn: new Date().toISOString().slice(0, 10),
      license: 'SRTM is public domain (NASA/USGS); the AWS mirror is a public dataset.',
      regenerateWith: 'npm run fixtures:case-tiles',
    },
    geometry: {
      northLat,
      westLon,
      rows: cut.rows,
      cols: cut.cols,
      latStepDeg: step,
      lonStepDeg: step,
    },
    bounds: {
      north: northLat,
      south: northLat - (cut.rows - 1) * step,
      west: westLon,
      east: westLon + (cut.cols - 1) * step,
    },
    statistics: {
      voidSamples: voids,
      minElevationM: min,
      maxElevationM: max,
      maxAt: {
        row: Math.floor(maxIndex / cut.cols),
        col: maxIndex % cut.cols,
        lat: northLat - Math.floor(maxIndex / cut.cols) * step,
        lon: westLon + (maxIndex % cut.cols) * step,
      },
    },
    accuracyCaveat:
      'Terrain horizon only. SRTM under-reads AND displaces sharp summits (Matterhorn ' +
      '4230 m here against a surveyed 4478 m, ~320 m out of position), so summit heights ' +
      'come from the peak database in fixtures/peaks/, never from these bytes.',
  };
  await writeFile(join(CASE_TILE_FIXTURE_DIR, `${name}.json`), `${JSON.stringify(meta, null, 2)}\n`);

  process.stdout.write(
    `  ${dataName}: ${cut.rows}x${cut.cols} from ${spec.sourceTile} ` +
      `(row ${cut.row0}, col ${cut.col0}) — ${min}..${max} m, ${voids} voids, ` +
      `${(samples.length * 2 / 1024).toFixed(0)} KiB\n`,
  );
}

async function main(): Promise<void> {
  const wanted = process.argv.slice(2);
  const specs = wanted.length === 0
    ? CASE_TERRAIN
    : CASE_TERRAIN.filter((spec) => wanted.includes(spec.caseId));

  if (specs.length === 0) {
    throw new Error(
      `No registered case matches ${wanted.join(', ')}. ` +
        `Known: ${CASE_TERRAIN.map((spec) => spec.caseId).join(', ')}.`,
    );
  }

  await mkdir(CASE_TILE_FIXTURE_DIR, { recursive: true });
  process.stdout.write(`Cutting ${specs.length} case window(s) into ${CASE_TILE_FIXTURE_DIR}\n`);
  for (const spec of specs) await writeCaseWindow(spec);
  process.stdout.write('Done\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
