/**
 * `npm run demo -- <case>` — run one ground-truth viewpoint end to end, print
 * what the pipeline saw, and write the annotated image to `out/annotated.png`.
 *
 *   npm run demo                              # list the cases
 *   npm run demo -- gornergrat                # full SRTM tiles + PNG
 *   npm run demo -- gornergrat --window       # the committed 728 KB window
 *   npm run demo -- gornergrat --heading 238 --hfov 85 --out out/wide.png
 *   npm run demo -- fort-william --range-km 8 --range-step-m 30 --bearing-step 0.5
 *   npm run demo -- gornergrat --no-png       # text report only
 *
 * This is the human-viewable proof that the whole system works together: an
 * offline peak database, offline SRTM terrain, the geometry core, the renderer
 * and the compositor, with no network and no test harness in the way.
 *
 * ── WHAT THE IMAGE IS, EXACTLY ─────────────────────────────────────────────
 * There is no photograph for these viewpoints (the case files cite images on
 * Wikimedia Commons and deliberately do not vendor them), so the overlay is
 * composited onto a SYNTHETIC BACKDROP: the run's own terrain silhouette, flat,
 * hatched and captioned as such on the image itself. See
 * `src/render/synthetic-backdrop.ts` for why a convincing fake photograph would
 * be the worst possible artifact here.
 *
 * Read the picture accordingly:
 *
 *   TAUTOLOGICAL   the overlay's horizon line lying on the silhouette. Both
 *                  come from the same horizon profile; their agreement means
 *                  nothing.
 *   REAL           the peak markers. They are computed from the peak database
 *                  and the camera projection with no reference to the terrain
 *                  sweep, so a summit dot sitting on its own bump in the SRTM
 *                  silhouette is two independent computations agreeing.
 *
 * ── TERRAIN ────────────────────────────────────────────────────────────────
 * The demo is a developer tool, not a test, so it reads the FULL tiles from
 * `data/tiles/` by default — more terrain than any committed window, and the
 * only source that can prove an occlusion beyond the window's cut. If the tile
 * is not there it says so and stops, rather than quietly falling back; use
 * `--window` to ask for the committed window on purpose.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { interpolateHorizonAltitudeDeg } from '../src/core/horizon.js';
import { cameraPoseFromFocalLength, vFovDegFromHFovDeg } from '../src/core/projection.js';
import type { CameraPose } from '../src/core/types.js';
import { annotateScene } from '../src/pipeline/annotate.js';
import {
  FULL_TILE_DIR,
  loadCaseTerrain,
  caseTerrainSpec,
} from '../src/pipeline/testing/case-terrain.js';
import type { AnnotatedPeak, AnnotatedScene } from '../src/pipeline/types.js';
import { buildOverlaySvgFromLayout, layoutOverlay } from '../src/render/index.js';
import { buildSyntheticBackdropSvg } from '../src/render/synthetic-backdrop.js';
import type { OverlayScene } from '../src/render/types.js';
import { groundTruthPeakStore } from '../fixtures/peaks/index.js';
import { groundTruthCases, type GroundTruthCase } from '../tests/acceptance/cases/index.js';
import { rasteriseToPng, RasteriseUnavailableError } from './rasterise.js';

/**
 * A wide-angle 4:3 frame at review size.
 *
 * 28 mm-equivalent is a typical phone lens, and the case files' stated view
 * bearings describe photographs taken with something like one. 1600 × 1200 is
 * the same aspect ratio as a 4032 × 3024 phone image — so the field of view and
 * every projected position are identical — at a size a human can open.
 */
const DEMO_FOCAL_35MM = 28;
const DEMO_IMAGE_WIDTH_PX = 1600;
const DEMO_IMAGE_HEIGHT_PX = 1200;

/** Where the annotated image lands unless `--out` says otherwise. */
const DEFAULT_PNG_PATH = 'out/annotated.png';

interface Options {
  readonly caseId: string | undefined;
  /** Use the committed window instead of the full tile. */
  readonly useWindow: boolean;
  readonly maxRangeKm: number | undefined;
  readonly rangeStepM: number | undefined;
  readonly bearingStepDeg: number | undefined;
  /** Framing overrides — the default is the case's own stated view. */
  readonly headingDeg: number | undefined;
  readonly hFovDeg: number | undefined;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly writePng: boolean;
  readonly outPath: string;
}

function parseArgs(argv: readonly string[]): Options {
  let caseId: string | undefined;
  let useWindow = false;
  let maxRangeKm: number | undefined;
  let rangeStepM: number | undefined;
  let bearingStepDeg: number | undefined;
  let headingDeg: number | undefined;
  let hFovDeg: number | undefined;
  let widthPx = DEMO_IMAGE_WIDTH_PX;
  let heightPx = DEMO_IMAGE_HEIGHT_PX;
  let writePng = true;
  let outPath = DEFAULT_PNG_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    switch (arg) {
      case '--window':
        useWindow = true;
        break;
      case '--full-tiles':
        // Kept as a no-op alias: full tiles are now the default, and silently
        // ignoring a flag someone typed is worse than saying it changed.
        process.stderr.write('note: --full-tiles is the default now; use --window for the committed cut\n');
        break;
      case '--no-png':
        writePng = false;
        break;
      case '--out':
        outPath = stringArg(argv[index + 1], arg);
        index += 1;
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
      case '--heading':
        headingDeg = numberArg(argv[index + 1], arg);
        index += 1;
        break;
      case '--hfov':
        hFovDeg = numberArg(argv[index + 1], arg);
        index += 1;
        break;
      case '--width':
        widthPx = numberArg(argv[index + 1], arg);
        index += 1;
        break;
      case '--height':
        heightPx = numberArg(argv[index + 1], arg);
        index += 1;
        break;
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown flag ${arg}`);
        caseId = arg;
    }
  }
  return {
    caseId,
    useWindow,
    maxRangeKm,
    rangeStepM,
    bearingStepDeg,
    headingDeg,
    hFovDeg,
    widthPx,
    heightPx,
    writePng,
    outPath,
  };
}

function stringArg(raw: string | undefined, flag: string): string {
  if (raw === undefined || raw.startsWith('--')) throw new Error(`${flag} needs a value`);
  return raw;
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
  line('usage: npm run demo -- <case> [options]');
  line();
  line('  --window            use the committed terrain window, not data/tiles/');
  line('  --no-png            text report only, do not write an image');
  line('  --out PATH          where to write the image (default out/annotated.png)');
  line('  --heading DEG       override the case\'s stated view bearing');
  line('  --hfov DEG          override the horizontal field of view');
  line('  --width/--height N  frame size in pixels (default 1600x1200)');
  line('  --range-km N  --range-step-m N  --bearing-step N   terrain sweep');
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

/** One occluded peak: the verdict, the terrain that beat it, and the D8 evidence. */
function describeOccludedPeak(peak: AnnotatedPeak): void {
  line(`    ${describePeak(peak)}`);
  const by = peak.occludedBy;
  line(
    by === undefined
      ? '      hidden by terrain the profile interpolated between rays'
      : `      hidden by terrain ${by.elevationM} m at ${by.distanceKm.toFixed(2)} km on ` +
        `bearing ${by.rayBearingDeg.toFixed(1)} deg, reaching ${deg(by.altitudeDeg)} deg`,
  );
  const occlusion = peak.occlusion;
  if (occlusion === undefined) return;
  line(
    `      ${occlusion.evidence}` +
      (occlusion.crestDistanceKm === undefined
        ? ''
        : `: first blocked at ${occlusion.crestDistanceKm.toFixed(2)} km by ` +
          `${(occlusion.crestElevationM ?? Number.NaN).toFixed(0)} m of ground reaching ` +
          `${deg(occlusion.crestAltitudeDeg ?? Number.NaN)} deg`) +
      (occlusion.colDepthM === undefined
        ? ''
        : `; deepest col between there and the summit ${occlusion.colDepthM.toFixed(1)} m`),
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
  line(`  VISIBLE — LABELLED (${scene.visible.length})`);
  if (scene.visible.length === 0) line('    (none)');
  for (const peak of scene.visible) line(`    ${describePeak(peak)}`);
  line();
  line(`  SELF-OCCLUDED — LABELLED, GREYED (${scene.selfOccluded.length})`);
  line('    The summit point is behind a shoulder of its OWN hill: the ground runs');
  line('    unbroken from the blocker to the summit, so the hill filling the view IS');
  line('    the peak, and the label belongs on it (decision D8).');
  if (scene.selfOccluded.length === 0) line('    (none)');
  for (const peak of scene.selfOccluded) describeOccludedPeak(peak);
  line();
  line(`  FOREGROUND-OCCLUDED — NOT LABELLED (${scene.foregroundOccluded.length})`);
  line('    A different, nearer landform is in the way, or the terrain between could');
  line('    not be shown continuous. Drawing these would name a mountain that is not');
  line('    in the picture.');
  if (scene.foregroundOccluded.length === 0) line('    (none)');
  for (const peak of scene.foregroundOccluded) describeOccludedPeak(peak);

  if (scene.warnings.length > 0) {
    line();
    line('WARNINGS');
    for (const warning of scene.warnings) line(`  ! ${warning}`);
  }

  const spec = caseTerrainSpec(testCase.id);
  if (spec !== undefined) {
    line();
    line('WHAT THIS RUN DOES AND DOES NOT PROVE');
    // The window's coverage note describes the WINDOW. Printing it after a
    // full-tile run would understate what was actually sampled.
    line(
      provenance.startsWith('full')
        ? `  A whole ${spec.sourceTile} tile was sampled out to ` +
          `${scene.config.sweep.maxRangeKm} km, so occlusion is testable ` +
          'anywhere inside that degree square. Rays leaving it read no data.'
        : `  ${spec.coverageNote}`,
    );
  }

  line();
}

/**
 * Load the case's terrain, preferring the FULL tile.
 *
 * A missing tile stops the run with instructions rather than falling back
 * silently: `--full-tiles` used to do exactly that, which meant a developer
 * could ask for 25 MB of real terrain, be handed a 728 KB cut, and never know.
 */
async function terrainFor(caseId: string, useWindow: boolean) {
  const spec = caseTerrainSpec(caseId);
  if (spec === undefined) {
    throw new Error(`No terrain window is registered for case "${caseId}".`);
  }
  if (useWindow) return loadCaseTerrain(caseId, { preferFullTiles: false });

  const tilePath = join(FULL_TILE_DIR, `${spec.sourceTile}.hgt`);
  const present = await stat(tilePath).then(
    () => true,
    () => false,
  );
  if (!present) {
    throw new Error(
      `${tilePath} is not here, and the demo runs on the full SRTM tile by default.\n` +
        `  Fetch it (25 MB, one-off):   npm run fetch:tiles -- ${spec.sourceTile}\n` +
        `  Or use the committed cut:    npm run demo -- ${caseId} --window\n` +
        `  (the window covers: ${spec.coverageNote})`,
    );
  }
  return loadCaseTerrain(caseId, { preferFullTiles: true });
}

/** Camera for the demo frame: the case's stated view unless overridden. */
function demoCamera(testCase: GroundTruthCase, options: Options): CameraPose {
  const headingDeg = options.headingDeg ?? testCase.view.bearingDeg;
  if (options.hFovDeg === undefined) {
    return cameraPoseFromFocalLength({
      headingDeg,
      focalLength35mm: DEMO_FOCAL_35MM,
      imageWidthPx: options.widthPx,
      imageHeightPx: options.heightPx,
    });
  }
  return {
    headingDeg,
    pitchDeg: 0,
    rollDeg: 0,
    hFovDeg: options.hFovDeg,
    vFovDeg: vFovDegFromHFovDeg(options.hFovDeg, options.widthPx / options.heightPx),
  };
}

/**
 * Render the scene and write the PNG.
 *
 * The overlay is exactly what the app draws — same `layoutOverlay`, same
 * `buildOverlaySvgFromLayout`, same compositor — over the synthetic backdrop
 * described in this file's header. What is drawn is decided by
 * `scene.labelled`, i.e. the pipeline's own answer to "which summits may be
 * named", so this image cannot show a peak the acceptance gates would refuse.
 */
async function writeImage(
  testCase: GroundTruthCase,
  scene: AnnotatedScene,
  provenance: string,
  options: Options,
): Promise<void> {
  const overlayScene: OverlayScene = {
    widthPx: options.widthPx,
    heightPx: options.heightPx,
    pose: scene.camera,
    horizon: scene.horizon,
    peaks: scene.labelled,
  };
  const layout = layoutOverlay(overlayScene);
  const overlaySvg = buildOverlaySvgFromLayout(layout);
  const backdropSvg = buildSyntheticBackdropSvg({
    widthPx: options.widthPx,
    heightPx: options.heightPx,
    ridgePolylinesPx: layout.horizonPolylinesPx,
    caption:
      `${testCase.id}: ${scene.observer.lat.toFixed(5)}, ${scene.observer.lon.toFixed(5)} · ` +
      `heading ${scene.camera.headingDeg.toFixed(1)}° · hFOV ${scene.camera.hFovDeg.toFixed(1)}° · ` +
      `terrain: ${provenance}`,
  });

  line('IMAGE');
  line(`  ${layout.markers.length} marker(s) drawn, ${layout.offFramePeaks.length} peak(s) off-frame, ` +
    `${layout.horizonPolylinesPx.length} horizon polyline(s)`);
  for (const marker of layout.markers) {
    line(
      `    ${marker.peak.name.padEnd(26)} summit at x=${marker.summitPx.xPx.toFixed(1)} ` +
        `y=${marker.summitPx.yPx.toFixed(1)} px  label level ${marker.stackLevel} ${marker.direction}` +
        `${marker.overlapped ? ' (OVERLAPPED — no free space)' : ''}` +
        `${marker.obscured ? ' (obscured: greyed)' : ''}`,
    );
    // Why a summit dot may float ABOVE the silhouette it belongs to: the label
    // height comes from the peak database, the silhouette from SRTM, and SRTM
    // under-reads a sharp summit by hundreds of metres (MISSION.md). Printing
    // both makes that gap a measured quantity instead of a visual puzzle.
    const skylineDeg = interpolateHorizonAltitudeDeg(scene.horizon, marker.peak.bearingDeg);
    line(
      `      summit ${deg(marker.peak.altitudeDeg)} deg vs computed skyline ` +
        `${deg(skylineDeg)} deg at the same bearing — the dot sits ` +
        `${deg(marker.peak.altitudeDeg - skylineDeg)} deg above the drawn ridge`,
    );
  }
  if (layout.markers.length === 0) {
    line('    (no peak in this frame — the image shows the skyline and nothing else)');
  }

  const png = await rasteriseToPng({
    backdropSvg,
    overlaySvg,
    widthPx: options.widthPx,
    heightPx: options.heightPx,
  });
  await mkdir(dirname(options.outPath), { recursive: true });
  await writeFile(options.outPath, png);
  line();
  line(`  wrote ${options.outPath} — ${options.widthPx}x${options.heightPx}, ${png.length} bytes`);
  line('  The backdrop is NOT a photograph: it is this run\'s own terrain silhouette,');
  line('  hatched and captioned on the image. The horizon line lying on the silhouette');
  line('  is therefore tautological. The peak markers are not: they come from the peak');
  line('  database and the projection, never from the terrain sweep.');
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

  const terrain = await terrainFor(testCase.id, options.useWindow);
  const camera = demoCamera(testCase, options);

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

  if (!options.writePng) {
    line('IMAGE');
    line('  skipped (--no-png)');
    line();
    return;
  }
  try {
    await writeImage(testCase, scene, terrain.provenance, options);
  } catch (error) {
    if (error instanceof RasteriseUnavailableError) {
      line('IMAGE');
      line(`  NOT written: ${error.message}`);
      line();
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
