/**
 * `npm run demo -- <case>` — run one ground-truth viewpoint end to end and
 * print what the pipeline saw.
 *
 *   npm run demo                          # list the cases
 *   npm run demo -- gornergrat            # committed window terrain (offline)
 *   npm run demo -- gornergrat --full-tiles
 *   npm run demo -- fort-william --range-km 8 --range-step-m 30 --bearing-step 0.5
 *
 * This is the human-viewable proof that BUILD 1 + BUILD 2 work together: an
 * offline peak database, offline SRTM terrain, and the geometry core, with no
 * network and no test harness in the way.
 *
 * ── The renderer seam ──────────────────────────────────────────────────────
 * PLAN.md P4.2 says this command eventually writes `out/annotated.png`. It does
 * not do that yet, and deliberately does not fake it: the overlay builder
 * (`src/render`, P4.1) is being written in parallel. Everything that renderer
 * needs is already in the `AnnotatedScene` this script prints —
 * `scene.horizon` (the full profile, with its per-bearing skyline staircase),
 * `scene.visible[].image` (normalised x/y for every label) and `scene.camera`.
 * Wiring it up is one call at the marked seam below; nothing else here changes.
 */

import { cameraPoseFromFocalLength } from '../src/core/projection.js';
import type { CameraPose } from '../src/core/types.js';
import { annotateScene } from '../src/pipeline/annotate.js';
import { loadCaseTerrain, caseTerrainSpec } from '../src/pipeline/testing/case-terrain.js';
import type { AnnotatedPeak, AnnotatedScene } from '../src/pipeline/types.js';
import { groundTruthPeakStore } from '../fixtures/peaks/index.js';
import { groundTruthCases, type GroundTruthCase } from '../tests/acceptance/cases/index.js';

/** A typical phone photograph: 28 mm-equivalent on a 4:3 frame. */
const DEMO_FOCAL_35MM = 28;
const DEMO_IMAGE_WIDTH_PX = 4032;
const DEMO_IMAGE_HEIGHT_PX = 3024;

interface Options {
  readonly caseId: string | undefined;
  readonly fullTiles: boolean;
  readonly maxRangeKm: number | undefined;
  readonly rangeStepM: number | undefined;
  readonly bearingStepDeg: number | undefined;
}

function parseArgs(argv: readonly string[]): Options {
  let caseId: string | undefined;
  let fullTiles = false;
  let maxRangeKm: number | undefined;
  let rangeStepM: number | undefined;
  let bearingStepDeg: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    switch (arg) {
      case '--full-tiles':
        fullTiles = true;
        break;
      case '--range-km':
        maxRangeKm = numberArg(argv[index + 1], arg);
        index += 1;
        break;
      case '--range-step-m':
        rangeStepM = numberArg(argv[index + 1], arg);
        index += 1;
        break;
      case '--bearing-step':
        bearingStepDeg = numberArg(argv[index + 1], arg);
        index += 1;
        break;
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown flag ${arg}`);
        caseId = arg;
    }
  }
  return { caseId, fullTiles, maxRangeKm, rangeStepM, bearingStepDeg };
}

function numberArg(raw: string | undefined, flag: string): number {
  const value = Number(raw);
  if (raw === undefined || !Number.isFinite(value)) {
    throw new Error(`${flag} needs a number, received ${String(raw)}`);
  }
  return value;
}

function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

function deg(value: number, digits = 2): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function listCases(): void {
  line('usage: npm run demo -- <case> [--full-tiles] [--range-km N] [--range-step-m N] [--bearing-step N]');
  line();
  line('cases with committed terrain:');
  for (const testCase of groundTruthCases) {
    const spec = caseTerrainSpec(testCase.id);
    line(`  ${testCase.id.padEnd(22)} ${testCase.title}`);
    if (spec !== undefined) line(`  ${' '.repeat(22)} terrain: ${spec.coverageNote}`);
  }
}

function describePeak(peak: AnnotatedPeak): string {
  return (
    `${peak.name.padEnd(26)} ` +
    `${peak.distanceKm.toFixed(2).padStart(7)} km  ` +
    `bearing ${peak.bearingDeg.toFixed(1).padStart(5)} deg  ` +
    `alt ${deg(peak.altitudeDeg).padStart(7)} deg  ` +
    `clearance ${deg(peak.clearanceDeg).padStart(7)} deg  ` +
    `image x=${peak.image.x.toFixed(3)} y=${peak.image.y.toFixed(3)}` +
    `${peak.image.inFrame ? '' : ' (off-frame)'}`
  );
}

function report(testCase: GroundTruthCase, scene: AnnotatedScene, provenance: string): void {
  const eyeM = scene.observer.groundElevationM + scene.observer.eyeHeightM;

  line('='.repeat(100));
  line(`CASE  ${testCase.id} — ${testCase.title}`);
  line('='.repeat(100));
  line();
  line('OBSERVER');
  line(`  position          ${scene.observer.lat.toFixed(6)}, ${scene.observer.lon.toFixed(6)}`);
  line(
    `  ground elevation  ${scene.observer.groundElevationM.toFixed(1)} m ` +
      `(${scene.observerResolution.groundElevationSource}` +
      `${scene.observerResolution.terrainNote === undefined ? '' : `: ${scene.observerResolution.terrainNote}`})`,
  );
  line(
    `  case file cites   ${testCase.observer.groundElevationM} m ` +
      `+-${testCase.observer.groundElevationUncertaintyM} m (${testCase.observer.elevationSourceId})`,
  );
  line(`  eye above sea     ${eyeM.toFixed(1)} m  (camera ${scene.observer.eyeHeightM} m up)`);
  line(`  terrain source    ${provenance}`);
  line();
  line('CAMERA');
  line(
    `  heading ${scene.camera.headingDeg.toFixed(1)} deg  pitch ${scene.camera.pitchDeg.toFixed(1)} deg  ` +
      `hFOV ${scene.camera.hFovDeg.toFixed(1)} deg  vFOV ${scene.camera.vFovDeg.toFixed(1)} deg`,
  );
  line(`  ${testCase.view.note}`);
  line();
  line('HORIZON PROFILE');
  line(
    `  ${scene.horizon.length} points over ${scene.config.sweep.spanDeg} deg ` +
      `(every ${scene.config.sweep.bearingStepDeg} deg), rays sampled every ` +
      `${scene.config.sweep.rangeStepM} m out to ${scene.config.sweep.maxRangeKm} km`,
  );
  line(
    `  ${scene.sweep.samplesWithElevation} of ${scene.sweep.samplesRequested} terrain samples had ` +
      `data; ${scene.sweep.raysWithTerrain} of ${scene.sweep.raysRequested} rays produced a point`,
  );
  const highest = [...scene.horizon].sort((a, b) => b.altitudeDeg - a.altitudeDeg)[0];
  const lowest = [...scene.horizon].sort((a, b) => a.altitudeDeg - b.altitudeDeg)[0];
  if (highest !== undefined && lowest !== undefined) {
    line(
      `  highest skyline   ${deg(highest.altitudeDeg)} deg at bearing ` +
        `${highest.bearingDeg.toFixed(1)} deg (${highest.elevationM} m, ${highest.distanceKm.toFixed(2)} km)`,
    );
    line(
      `  lowest skyline    ${deg(lowest.altitudeDeg)} deg at bearing ` +
        `${lowest.bearingDeg.toFixed(1)} deg (${lowest.elevationM} m, ${lowest.distanceKm.toFixed(2)} km)`,
    );
  }
  line();
  line(`PEAKS CONSIDERED — ${scene.peaks.length} within ${scene.config.peakRadiusKm} km`);
  line();
  line(`  VISIBLE (${scene.visible.length})`);
  if (scene.visible.length === 0) line('    (none)');
  for (const peak of scene.visible) line(`    ${describePeak(peak)}`);
  line();
  line(`  OCCLUDED (${scene.occluded.length})`);
  if (scene.occluded.length === 0) line('    (none)');
  for (const peak of scene.occluded) {
    line(`    ${describePeak(peak)}`);
    const by = peak.occludedBy;
    line(
      by === undefined
        ? '      hidden by terrain the profile interpolated between rays'
        : `      hidden by terrain ${by.elevationM} m at ${by.distanceKm.toFixed(2)} km on ` +
          `bearing ${by.rayBearingDeg.toFixed(1)} deg, reaching ${deg(by.altitudeDeg)} deg`,
    );
  }

  if (scene.warnings.length > 0) {
    line();
    line('WARNINGS');
    for (const warning of scene.warnings) line(`  ! ${warning}`);
  }

  const spec = caseTerrainSpec(testCase.id);
  if (spec !== undefined) {
    line();
    line('WHAT THIS RUN DOES AND DOES NOT PROVE');
    line(`  ${spec.coverageNote}`);
  }

  line();
  line('NEXT (renderer seam, PLAN.md P4.2)');
  line('  out/annotated.png is NOT written yet: src/render is being built in parallel.');
  line('  Everything it needs is in this scene — horizon profile, per-peak image x/y, camera.');
  line();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.caseId === undefined) {
    listCases();
    return;
  }

  const testCase = groundTruthCases.find((entry) => entry.id === options.caseId);
  if (testCase === undefined) {
    throw new Error(
      `Unknown case "${options.caseId}". Known: ${groundTruthCases.map((c) => c.id).join(', ')}.`,
    );
  }

  const terrain = await loadCaseTerrain(testCase.id, { preferFullTiles: options.fullTiles });
  const camera: CameraPose = cameraPoseFromFocalLength({
    headingDeg: testCase.view.bearingDeg,
    focalLength35mm: DEMO_FOCAL_35MM,
    imageWidthPx: DEMO_IMAGE_WIDTH_PX,
    imageHeightPx: DEMO_IMAGE_HEIGHT_PX,
  });

  const scene = await annotateScene({
    // No groundElevationM: the demo exercises the terrain lookup, and prints
    // it next to the figure the case file cites so the two can be compared.
    observer: {
      lat: testCase.observer.lat,
      lon: testCase.observer.lon,
      eyeHeightM: testCase.observer.eyeHeightM,
      fallbackGroundElevationM: testCase.observer.groundElevationM,
    },
    camera,
    elevation: terrain.elevation,
    peaks: groundTruthPeakStore,
    config: {
      sweep: {
        ...terrain.spec.sweep,
        ...(options.maxRangeKm === undefined ? {} : { maxRangeKm: options.maxRangeKm }),
        ...(options.rangeStepM === undefined ? {} : { rangeStepM: options.rangeStepM }),
        ...(options.bearingStepDeg === undefined ? {} : { bearingStepDeg: options.bearingStepDeg }),
      },
      peakRadiusKm: 300,
    },
  });

  report(testCase, scene, terrain.provenance);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
