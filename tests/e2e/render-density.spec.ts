import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import type { CameraPose, HorizonPoint, VisiblePeak } from '../../src/core/types';
import type {
  OverlayOptions,
  OverlayScene,
  PointPx,
  RectPx,
  ResolvedOverlayOptions,
} from '../../src/render/types';

/**
 * Real peak density, all the way to the raster.
 *
 * ## Why this file exists
 *
 * `layout.test.ts` proves the crowding rules hold as numbers. It cannot prove
 * the delivered image is legible, and legibility is the entire point: the
 * failure this guards against is not a crash but a picture that still looks
 * like an answer while being a wall of overlapping text. So the dense scene is
 * laid out, serialised, composited and probed in Chromium, and the export is
 * saved to `out/render-density.png` for a human to look at.
 *
 * ## The measurement this fixture is modelled on
 *
 * Gornergrat railway platform (45.98333 N, 7.78222 E, 3 089 m + 1.6 m eye),
 * heading 355°, hFOV 65°, on a 1600 × 1200 frame, against the 1 786 Overture
 * summits imported for the Zermatt region and the real SRTM tiles: **74 named
 * summits projected inside the frame**, with adjacent bearings as close as
 * 0.008° and a median gap of 0.51°. The synthetic distribution below reproduces
 * that shape — 74 peaks across the frame, unevenly clumped, altitudes from just
 * above the skyline to well up the frame — without depending on the peak
 * fixtures, whose shape belongs to another part of the system.
 *
 * ## Where the expected numbers come from
 *
 * The same closed form used by the unit tests and `render.spec.ts`, and stated
 * again here so this file stands on its own. With pitch = roll = 0,
 *
 *     x = 0.5 + tanΔ         / (2 · tan(hFOV/2))
 *     y = 0.5 − tanα / cosΔ  / (2 · tan(vFOV/2))
 *
 * with tan(vFOV/2) = tan(hFOV/2) · height / width. Nothing below is read off
 * the renderer's own output.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../../out');

const WIDTH_PX = 1600;
const HEIGHT_PX = 1200;
const HFOV_DEG = 65;

const RAD = Math.PI / 180;
const TAN_HALF_H = Math.tan((HFOV_DEG / 2) * RAD);
const TAN_HALF_V = TAN_HALF_H * (HEIGHT_PX / WIDTH_PX);

const POSE: CameraPose = {
  headingDeg: 90,
  pitchDeg: 0,
  rollDeg: 0,
  hFovDeg: HFOV_DEG,
  vFovDeg: (2 * Math.atan(TAN_HALF_V) * 180) / Math.PI,
};

/** Hand-computed pixel position of a target at bearing offset Δ, altitude α. */
function expectedPx(deltaBearingDeg: number, altitudeDeg: number): PointPx {
  const x = 0.5 + Math.tan(deltaBearingDeg * RAD) / (2 * TAN_HALF_H);
  const y = 0.5 - Math.tan(altitudeDeg * RAD) / Math.cos(deltaBearingDeg * RAD) / (2 * TAN_HALF_V);
  return { xPx: x * WIDTH_PX, yPx: y * HEIGHT_PX };
}

function peak(
  id: string,
  name: string,
  bearingDeg: number,
  altitudeDeg: number,
  elevationM: number,
  distanceKm: number,
): VisiblePeak {
  return {
    id,
    name,
    lat: 45.98,
    lon: 7.78,
    elevationM,
    elevationSource: 'osm',
    bearingDeg,
    altitudeDeg,
    distanceKm,
    occludingAltitudeDeg: altitudeDeg - 1,
    clearanceDeg: 1,
  };
}

/**
 * 74 summits across a 65° frame, clumped the way a real ridge line clumps.
 *
 * Deterministic by construction — a golden-angle offset sequence, never
 * `Math.random` — so the same scene lays out identically on every run and the
 * exported PNG is comparable between runs. The golden angle is used because
 * successive terms of `i · φ mod 1` are maximally *un*even at every prefix
 * length, which is what produces clumps and gaps rather than a comb.
 *
 * Names are real Valais summit names of realistic length: label width drives
 * the derived budget, so a fixture of `P1`…`P74` would flatter the renderer.
 */
const NAMES = [
  'Weisshorn', 'Bishorn', 'Brunegghorn', 'Barrhorn', 'Schalihorn',
  'Zinalrothorn', 'Besso', 'Ober Gabelhorn', 'Wellenkuppe', 'Trifthorn',
  'Mettelhorn', 'Platthorn', 'Furgghorn', 'Wisshorn', 'Getschung',
  'Pointe Burnaby', 'Wisse Schijen', 'Crête Sud de Moming', 'Gross Kastel', 'Chli Kastel',
  'Festihorn Ost', 'Festihorn West', 'Dreizehntenhorn', 'Sparruhorn', 'Steitalhorn',
  'Augstbordhorn', 'Wilerhorn', 'Gletscherhorn', 'Grosshorn', 'Jegihorn',
  'Bietschhorn', 'Kleines Nesthorn', 'Wiwannihorn', 'Tieregghorn', 'Chrütighorn',
  'Stockhorn', 'Gugla', 'Grabenhorn', 'Bösentrift', 'Unterrothorn',
  'Oberrothorn', 'Leiterspitzen', 'Chli Dirruhorn', 'Dirruhorn', 'Hohgwächte',
  'Kinhorn', 'Hohberghorn', 'Stecknadelhorn', 'Dom', 'Täschhorn',
  'Grand Gendarme', 'Alphubel', 'Allalinhorn', 'Rimpfischhorn', 'Strahlhorn',
  'Adlerhorn', 'Cima di Jazzi', 'Nordend', 'Dufourspitze', 'Zumsteinspitze',
  'Signalkuppe', 'Parrotspitze', 'Ludwigshöhe', 'Schwarzhorn', 'Vincentpyramide',
  'Liskamm', 'Castor', 'Pollux', 'Breithorn', 'Klein Matterhorn',
  'Theodulhorn', 'Furggen', 'Riffelhorn', 'Gornergrat',
] as const;

/** Golden angle in turns: the most irrational rotation there is. */
const GOLDEN = 0.618_033_988_749_895;

function densePeaks(): VisiblePeak[] {
  const peaks: VisiblePeak[] = [];
  for (let index = 0; index < NAMES.length; index += 1) {
    const name = NAMES[index];
    if (name === undefined) continue;
    // Δ sweeps −31°…+31° with a golden-angle wobble of ±1.4°, which pushes
    // some pairs to within a hundredth of a degree and leaves other gaps open.
    const spanFraction = index / (NAMES.length - 1);
    const wobbleDeg = 1.4 * (2 * ((index * GOLDEN) % 1) - 1);
    const deltaDeg = -31 + 62 * spanFraction + wobbleDeg;
    // Altitudes 1.6°…7.4°, cycling independently of Δ so tall summits are not
    // conveniently sorted across the frame.
    const altitudeDeg = 1.6 + 5.8 * ((index * 7 * GOLDEN) % 1);
    const elevationM = Math.round(3000 + 1600 * ((index * 13 * GOLDEN) % 1));
    const distanceKm = Math.round((4 + 42 * ((index * 5 * GOLDEN) % 1)) * 10) / 10;
    peaks.push(
      peak(`node/${String(index)}`, name, 90 + deltaDeg, altitudeDeg, elevationM, distanceKm),
    );
  }
  return peaks;
}

/**
 * The peak that must survive any prioritisation: highest apparent height in the
 * scene by a clear margin, placed at Δ = +12° so its pixel position is exactly
 * computable and far from the frame edges.
 */
const DOMINANT_DELTA_DEG = 12;
const DOMINANT_ALTITUDE_DEG = 9.5;
const DOMINANT_PX = expectedPx(DOMINANT_DELTA_DEG, DOMINANT_ALTITUDE_DEG);

/** A self-occluded summit riding high (D8): must be labelled, and greyed. */
const GREYED_DELTA_DEG = -20;
const GREYED_ALTITUDE_DEG = 8.6;

/** A foreground-occluded summit riding highest of all (D8): must never appear. */
const HIDDEN_DELTA_DEG = 4;
const HIDDEN_ALTITUDE_DEG = 11;
const HIDDEN_PX = expectedPx(HIDDEN_DELTA_DEG, HIDDEN_ALTITUDE_DEG);

const HORIZON: HorizonPoint[] = [];
for (let bearingDeg = 0; bearingDeg < 360; bearingDeg += 1) {
  const radians = bearingDeg * RAD;
  HORIZON.push({
    bearingDeg,
    altitudeDeg: 1.2 + 0.5 * Math.sin(radians * 7) + 0.25 * Math.sin(radians * 23 + 1),
    distanceKm: 18,
    elevationM: 3100,
  });
}

const SCENE: OverlayScene = {
  widthPx: WIDTH_PX,
  heightPx: HEIGHT_PX,
  pose: POSE,
  horizon: HORIZON,
  peaks: [
    ...densePeaks(),
    peak('node/dominant', 'Matterhorn', 90 + DOMINANT_DELTA_DEG, DOMINANT_ALTITUDE_DEG, 4478, 9.6),
    {
      ...peak('node/greyed', 'Riffelberg', 90 + GREYED_DELTA_DEG, GREYED_ALTITUDE_DEG, 2582, 2.4),
      visibility: 'self-occluded' as const,
    },
    {
      ...peak('node/hidden', 'Ben Nevis', 90 + HIDDEN_DELTA_DEG, HIDDEN_ALTITUDE_DEG, 1345, 6.7),
      visibility: 'foreground-occluded' as const,
    },
  ],
};

/** Nothing pinned: the derived defaults are what ships, so they are what is tested. */
const OPTIONS: OverlayOptions = {};

interface ProbeSample {
  label: string;
  xPx: number;
  yPx: number;
  rgba: [number, number, number, number];
}

interface HarnessMarker {
  name: string;
  summitPx: PointPx;
  poleTipPx: PointPx;
  labelBoxPx: RectPx;
  stackLevel: number;
  direction: string;
  overlapped: boolean;
  obscured: boolean;
}

interface HarnessResult {
  pngDataUrl: string;
  overlaySvg: string;
  svgParseError: string | null;
  canvasWidthPx: number;
  canvasHeightPx: number;
  markerCount: number;
  offFrameCount: number;
  foregroundOccludedNames: string[];
  crowdedOut: { name: string; summitPx: PointPx; obscured: boolean }[];
  options: ResolvedOverlayOptions;
  markers: HarnessMarker[];
  samples: ProbeSample[];
}

interface HarnessWindow {
  mfRenderHarness: {
    render(input: {
      scene: OverlayScene;
      options: OverlayOptions;
      probesPx: { label: string; xPx: number; yPx: number }[];
    }): Promise<HarnessResult>;
  };
}

/** The overlay's summit-dot fill, `#ffd166`. */
const MARKER_RGB: [number, number, number] = [255, 209, 102];

function channelDistance(rgba: readonly number[], rgb: readonly number[]): number {
  return Math.max(...rgb.map((value, index) => Math.abs((rgba[index] ?? Number.NaN) - value)));
}

function sampleNamed(result: HarnessResult, label: string): ProbeSample {
  const found = result.samples.find((sample) => sample.label === label);
  if (found === undefined) throw new Error(`no probe named ${label}`);
  return found;
}

function rectsOverlap(a: RectPx, b: RectPx): boolean {
  return (
    a.xPx < b.xPx + b.widthPx &&
    b.xPx < a.xPx + a.widthPx &&
    a.yPx < b.yPx + b.heightPx &&
    b.yPx < a.yPx + a.heightPx
  );
}

test('a frame of 77 summits exports a legible overlay', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      errors.push(message.text());
    }
  });

  await page.goto('/src/render/harness.html');
  await page.waitForFunction(() => 'mfRenderHarness' in window);

  const result = await page.evaluate(
    (input) => (window as unknown as HarnessWindow).mfRenderHarness.render(input),
    {
      scene: SCENE,
      options: OPTIONS,
      probesPx: [
        // The dominant summit's dot, at its hand-computed position.
        { label: 'dominant-dot', xPx: DOMINANT_PX.xPx, yPx: DOMINANT_PX.yPx },
        // 120 px to the left along the same row: sky, no overlay ink.
        { label: 'control-sky', xPx: DOMINANT_PX.xPx - 120, yPx: DOMINANT_PX.yPx },
        // Where the refused foreground-occluded summit would have been marked.
        { label: 'refused-position', xPx: HIDDEN_PX.xPx, yPx: HIDDEN_PX.yPx },
      ],
    },
  );

  expect(errors).toEqual([]);
  expect(result.svgParseError).toBeNull();

  // --- the scene is genuinely dense -----------------------------------------
  const inFrame = result.markerCount + result.crowdedOut.length;
  expect(inFrame).toBeGreaterThanOrEqual(70);
  expect(result.offFrameCount).toBeLessThanOrEqual(SCENE.peaks.length - 70);

  // --- and the overlay decided not to name all of it -------------------------
  expect(result.crowdedOut.length).toBeGreaterThan(0);
  // Every peak is accounted for exactly once.
  expect(
    result.markerCount +
      result.crowdedOut.length +
      result.offFrameCount +
      result.foregroundOccludedNames.length,
  ).toBe(SCENE.peaks.length);

  // --- the legibility guarantees -------------------------------------------
  // No two labels share pixels. This is the assertion the whole change exists
  // for: before it, this scene produced 24 mutually intersecting label boxes.
  for (let i = 0; i < result.markers.length; i += 1) {
    for (let j = i + 1; j < result.markers.length; j += 1) {
      const a = result.markers[i];
      const b = result.markers[j];
      if (a === undefined || b === undefined) throw new Error('missing marker');
      expect(
        rectsOverlap(a.labelBoxPx, b.labelBoxPx),
        `${a.name} and ${b.name} overlap`,
      ).toBe(false);
    }
  }
  expect(result.markers.every((marker) => !marker.overlapped)).toBe(true);

  // No label stands further from its dot than the pole budget, so every label
  // is still readable as belonging to a particular summit.
  for (const marker of result.markers) {
    const poleLengthPx = Math.abs(marker.poleTipPx.yPx - marker.summitPx.yPx);
    expect(poleLengthPx).toBeLessThanOrEqual(result.options.maxPoleLengthPx + 1e-6);
  }

  // Every label box is inside the frame margins — nothing runs off the edge.
  for (const marker of result.markers) {
    expect(marker.labelBoxPx.xPx).toBeGreaterThanOrEqual(result.options.frameMarginPx - 1e-6);
    expect(marker.labelBoxPx.xPx + marker.labelBoxPx.widthPx).toBeLessThanOrEqual(
      WIDTH_PX - result.options.frameMarginPx + 1e-6,
    );
    expect(marker.labelBoxPx.yPx).toBeGreaterThanOrEqual(result.options.frameMarginPx - 1e-6);
    expect(marker.labelBoxPx.yPx + marker.labelBoxPx.heightPx).toBeLessThanOrEqual(
      HEIGHT_PX - result.options.frameMarginPx + 1e-6,
    );
  }

  // --- the frame says what it withheld --------------------------------------
  expect(result.overlaySvg).toContain(
    `+${String(result.crowdedOut.length)} more named summits in this frame`,
  );
  expect(result.overlaySvg).toContain('too crowded to label');
  // A withheld name is genuinely absent from the document, not merely hidden.
  const labelledNames = new Set(result.markers.map((marker) => marker.name));
  for (const dropped of result.crowdedOut) {
    if (labelledNames.has(dropped.name)) continue; // duplicate summit names exist
    expect(result.overlaySvg).not.toContain(`>${dropped.name}<`);
  }

  // --- D8 survives the prioritisation ---------------------------------------
  // The tallest thing in the scene is hidden behind a different landform. No
  // amount of "it is the most important peak here" may draw it.
  expect(result.foregroundOccludedNames).toEqual(['Ben Nevis']);
  expect(result.overlaySvg).not.toContain('Ben Nevis');
  expect(result.crowdedOut.map((entry) => entry.name)).not.toContain('Ben Nevis');
  const refused = sampleNamed(result, 'refused-position');
  expect(channelDistance(refused.rgba, MARKER_RGB)).toBeGreaterThan(40);

  // The greyed summit rides high, so it must keep its label in a crowded frame
  // — decluttering is not allowed to be a quiet way of dropping D8's labels.
  const greyed = result.markers.find((marker) => marker.name === 'Riffelberg');
  expect(greyed, 'the self-occluded summit lost its label to crowding').toBeDefined();
  expect(greyed?.obscured).toBe(true);
  expect(result.overlaySvg).toContain('summit obscured');

  // --- the geometry survived into the raster --------------------------------
  const dominant = result.markers.find((marker) => marker.name === 'Matterhorn');
  expect(dominant).toBeDefined();
  expect(dominant?.summitPx.xPx).toBeCloseTo(DOMINANT_PX.xPx, 2);
  expect(dominant?.summitPx.yPx).toBeCloseTo(DOMINANT_PX.yPx, 2);

  const dot = sampleNamed(result, 'dominant-dot');
  const sky = sampleNamed(result, 'control-sky');
  expect(channelDistance(dot.rgba, MARKER_RGB)).toBeLessThanOrEqual(12);
  expect(channelDistance(sky.rgba, MARKER_RGB)).toBeGreaterThan(40);

  // --- the exported PNG ------------------------------------------------------
  expect(result.canvasWidthPx).toBe(WIDTH_PX);
  expect(result.canvasHeightPx).toBe(HEIGHT_PX);
  const png = Buffer.from(result.pngDataUrl.slice('data:image/png;base64,'.length), 'base64');
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(png.readUInt32BE(16)).toBe(WIDTH_PX);
  expect(png.readUInt32BE(20)).toBe(HEIGHT_PX);
  expect(png.byteLength).toBeGreaterThan(50_000);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'render-density.png'), png);
  writeFileSync(resolve(OUT_DIR, 'render-density.svg'), result.overlaySvg, 'utf8');
});

test('the same dense scene exports the same bytes twice', async ({ page }) => {
  // Prioritisation introduces a second sort over the same data. If either sort
  // were unstable — or seeded from anything but the peaks themselves — the same
  // photograph would name different mountains on a second run.
  await page.goto('/src/render/harness.html');
  await page.waitForFunction(() => 'mfRenderHarness' in window);

  const render = async (peaks: readonly unknown[]): Promise<string> => {
    const result = await page.evaluate(
      (input) => (window as unknown as HarnessWindow).mfRenderHarness.render(input),
      { scene: { ...SCENE, peaks } as OverlayScene, options: OPTIONS, probesPx: [] },
    );
    return result.pngDataUrl;
  };

  const first = await render(SCENE.peaks);
  expect(await render(SCENE.peaks)).toBe(first);
  // …and reversing the order the peaks arrive in must not change which of them
  // get named, because "which mountains did it name" cannot depend on the
  // database's row order.
  expect(await render([...SCENE.peaks].reverse())).toBe(first);
});
