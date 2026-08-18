/**
 * The pipeline end to end, on a scene whose answer is written down in advance.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE SCENE, AND WHY EVERY NUMBER IN IT IS CHECKABLE BY HAND
 * ───────────────────────────────────────────────────────────────────────────
 * Observer at (0°, 0°) — on the equator, so a due-east ray runs along the
 * equator itself and a point `d` metres east sits at longitude
 * `d / (R·π/180)` degrees, with no destination-point formula involved. Ground
 * is sea level, the eye is 100 m up.
 *
 * Terrain is a RING RIDGE: 900 m at every point 4 900–5 100 m from the
 * observer, sea level everywhere else. With a 250 m range step exactly one
 * sample per ray — the one at 5 000 m — lands on it.
 *
 * Closed forms, with R = 6 371 008.8 m, k = 0.13, R_eff = R/(1−k) =
 * 7 322 998.62 m, drop(d) = d²/(2·R_eff), eye at 100 m:
 *
 *   ridge   d =  5 km, h =  900 m: drop  1.71 m, tanα = 798.293/5000  = 0.159659 → α = +9.0712°
 *   HIGH    d = 10 km, h = 4478 m: drop  6.83 m, tanα = 4371.172/10000= 0.437117 → α = +23.611°
 *   HIDDEN  d = 20 km, h = 1500 m: drop 27.31 m, tanα = 1372.689/20000= 0.068634 → α = +3.9263°
 *
 * So HIGH clears the ridge by 14.54° and HIDDEN falls 5.14° short of it, even
 * though HIDDEN stands 600 m taller than the ridge. That is the whole point of
 * an angle-based occlusion test, and it is checked here rather than assumed.
 *
 * ── Which Earth model, and why two of them appear below ────────────────────
 * The expectations are computed by `expectedAltitudeDeg` in this file, a
 * re-derivation of the documented curvature-drop formula from the constants
 * above — the same formula src/core states in its docs, written out again here
 * so a typo in either implementation shows up as a disagreement. The decimals
 * in the table are the hand arithmetic, carried to four figures, and they are
 * asserted too.
 *
 * The `fixtures/scenes` kit is also consulted, but only as a SECOND OPINION:
 * it models the sphere exactly rather than through the d²/2R drop, and at these
 * geometries the two differ by up to 0.013° (they agree to 0.002° at the
 * shallow angles the analytic scenes use, which is what those scenes document).
 * A test that demanded 0.002° agreement here would be asserting that two
 * different models are the same model. So the exact-sphere value is asserted
 * loosely, as a sanity bound, and never as the answer.
 *
 * Nothing here was obtained by running the pipeline.
 */

import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_M } from '../core/geodesy';
import { interpolateHorizonAltitudeDeg } from '../core/horizon';
import type { CameraPose, Peak } from '../core/types';
import {
  apparentAltitudeDeg,
  destinationPoint,
  greatCircleDistanceM,
  initialBearingDeg,
} from '../../fixtures/scenes';

import { annotateScene, nearFieldElevationBandM } from './annotate';
import { PipelineError } from './errors';
import {
  FunctionElevationSource,
  StaticPeakSource,
  type TerrainFunctionM,
} from './testing/elevation-sources';
import type { AnnotateSceneRequest, AnnotatedPeak } from './types';

/** Metres per degree along the equator: R·π/180. */
const METRES_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;

const ORIGIN = { lat: 0, lon: 0 };
const EYE_HEIGHT_M = 100;
const EYE_ELEVATION_M = 0 + EYE_HEIGHT_M;

const RIDGE_ELEVATION_M = 900;
const RIDGE_DISTANCE_M = 5000;
const HIGH_DISTANCE_M = 10_000;
const HIGH_ELEVATION_M = 4478;
const HIDDEN_DISTANCE_M = 20_000;
const HIDDEN_ELEVATION_M = 1500;

/**
 * The specified model, re-derived here from the constants:
 *
 *   R_eff = R/(1−k) = 6 371 008.8 / 0.87 = 7 322 998.6207 m
 *   α = atan2( Δh − d²/(2·R_eff) , d )
 */
const EFFECTIVE_RADIUS_M = EARTH_RADIUS_M / (1 - 0.13);

function expectedAltitudeDeg(
  targetElevationM: number,
  distanceM: number,
  eyeElevationM: number = EYE_ELEVATION_M,
): number {
  const rise =
    targetElevationM - eyeElevationM - (distanceM * distanceM) / (2 * EFFECTIVE_RADIUS_M);
  return (Math.atan2(rise, distanceM) * 180) / Math.PI;
}

const RIDGE_ALTITUDE_DEG = expectedAltitudeDeg(RIDGE_ELEVATION_M, RIDGE_DISTANCE_M);
const HIGH_ALTITUDE_DEG = expectedAltitudeDeg(HIGH_ELEVATION_M, HIGH_DISTANCE_M);
const HIDDEN_ALTITUDE_DEG = expectedAltitudeDeg(HIDDEN_ELEVATION_M, HIDDEN_DISTANCE_M);

/** How far the exact-sphere second opinion may sit from the drop model here. */
const MODEL_GAP_TOLERANCE_DEG = 0.02;

/** A point `distanceM` due east of the origin, on the equator. */
function east(distanceM: number): { lat: number; lon: number } {
  return { lat: 0, lon: distanceM / METRES_PER_DEG };
}

const ringRidge: TerrainFunctionM = (point) => {
  const distanceM = greatCircleDistanceM(ORIGIN, point);
  return distanceM >= 4900 && distanceM <= 5100 ? RIDGE_ELEVATION_M : 0;
};

const peaks: readonly Peak[] = [
  {
    id: 'test/high',
    name: 'High Peak',
    ...east(HIGH_DISTANCE_M),
    elevationM: HIGH_ELEVATION_M,
    elevationSource: 'unknown',
  },
  {
    id: 'test/hidden',
    name: 'Hidden Peak',
    ...east(HIDDEN_DISTANCE_M),
    elevationM: HIDDEN_ELEVATION_M,
    elevationSource: 'unknown',
  },
  {
    id: 'test/underfoot',
    name: 'Underfoot',
    lat: 0,
    lon: 0,
    elevationM: 0,
    elevationSource: 'unknown',
  },
];

const camera: CameraPose = {
  headingDeg: 90,
  pitchDeg: 0,
  rollDeg: 0,
  hFovDeg: 60,
  vFovDeg: 40,
};

const FIXED_CLOCK = new Date('2026-08-16T12:00:00.000Z');

function request(overrides: Partial<AnnotateSceneRequest> = {}): AnnotateSceneRequest {
  return {
    observer: { lat: 0, lon: 0, eyeHeightM: EYE_HEIGHT_M },
    camera,
    elevation: new FunctionElevationSource(ringRidge, 'ring-ridge'),
    peaks: new StaticPeakSource(peaks),
    config: {
      sweep: { bearingStepDeg: 1, rangeStepM: 250, maxRangeKm: 30 },
      peakRadiusKm: 50,
      clock: () => FIXED_CLOCK,
    },
    ...overrides,
  };
}

function byId(list: readonly AnnotatedPeak[], id: string): AnnotatedPeak {
  const found = list.find((peak) => peak.id === id);
  if (found === undefined) throw new Error(`expected the scene to contain ${id}`);
  return found;
}

describe('annotateScene — the ring-ridge scene', () => {
  it('resolves the observer off the terrain and reports how', async () => {
    const scene = await annotateScene(request());
    expect(scene.observer.groundElevationM).toBe(0);
    expect(scene.observer.eyeHeightM).toBe(EYE_HEIGHT_M);
    expect(scene.observerResolution.groundElevationSource).toBe('terrain');
  });

  it('builds a full 360 deg horizon whose skyline is the ridge', async () => {
    const scene = await annotateScene(request());

    expect(scene.horizon).toHaveLength(360);
    expect(scene.sweep.raysRequested).toBe(360);
    expect(scene.sweep.raysWithTerrain).toBe(360);
    // 120 samples per ray (250 m steps out to 30 km) × 360 rays.
    expect(scene.sweep.samplesRequested).toBe(360 * 120);
    expect(scene.sweep.samplesWithElevation).toBe(360 * 120);

    const dueEast = scene.horizon.find((point) => point.bearingDeg === 90);
    expect(dueEast?.altitudeDeg).toBeCloseTo(RIDGE_ALTITUDE_DEG, 9);
    expect(dueEast?.altitudeDeg).toBeCloseTo(9.0712, 3);
    expect(dueEast?.distanceKm).toBeCloseTo(5, 6);
    expect(dueEast?.elevationM).toBe(RIDGE_ELEVATION_M);

    // The ridge is a ring, so every bearing has the same skyline.
    expect(interpolateHorizonAltitudeDeg(scene.horizon, 217.5)).toBeCloseTo(RIDGE_ALTITUDE_DEG, 9);
  });

  it('carries the staircase the occlusion rule needs, not just the winner', async () => {
    const scene = await annotateScene(request());
    const dueEast = scene.horizon.find((point) => point.bearingDeg === 90);
    const steps = dueEast?.skylineSteps ?? [];

    expect(steps.length).toBeGreaterThan(1);
    // Non-decreasing in both fields, ending on the winner: the contract
    // src/core/types.ts states for SkylineStep.
    for (let index = 1; index < steps.length; index += 1) {
      const previous = steps[index - 1];
      const current = steps[index];
      if (previous === undefined || current === undefined) throw new Error('step index lost');
      expect(current.distanceKm).toBeGreaterThanOrEqual(previous.distanceKm);
      expect(current.maxAltitudeDeg).toBeGreaterThanOrEqual(previous.maxAltitudeDeg);
    }
    expect(steps.at(-1)?.elevationM).toBe(RIDGE_ELEVATION_M);
  });

  it('labels the high peak and hides the taller far one — angle, not height', async () => {
    const scene = await annotateScene(request());

    expect(scene.visible.map((peak) => peak.id)).toEqual(['test/high']);
    expect(scene.occluded.map((peak) => peak.id)).toEqual(['test/hidden']);

    const high = byId(scene.peaks, 'test/high');
    expect(high.altitudeDeg).toBeCloseTo(HIGH_ALTITUDE_DEG, 9);
    expect(high.altitudeDeg).toBeCloseTo(23.611, 3);
    expect(high.distanceKm).toBeCloseTo(10, 6);
    expect(high.bearingDeg).toBeCloseTo(90, 9);
    expect(high.occludingAltitudeDeg).toBeCloseTo(RIDGE_ALTITUDE_DEG, 9);
    expect(high.clearanceDeg).toBeCloseTo(HIGH_ALTITUDE_DEG - RIDGE_ALTITUDE_DEG, 9);
    expect(high.clearanceDeg).toBeCloseTo(14.54, 2);
    expect(high.occludedBy).toBeUndefined();

    const hidden = byId(scene.peaks, 'test/hidden');
    expect(hidden.altitudeDeg).toBeCloseTo(HIDDEN_ALTITUDE_DEG, 9);
    expect(hidden.altitudeDeg).toBeCloseTo(3.9263, 3);
    // 600 m TALLER than the ridge and still hidden by it.
    expect(hidden.elevationM).toBeGreaterThan(RIDGE_ELEVATION_M);
    expect(hidden.visible).toBe(false);
    expect(hidden.clearanceDeg).toBeCloseTo(HIDDEN_ALTITUDE_DEG - RIDGE_ALTITUDE_DEG, 9);
    expect(hidden.clearanceDeg).toBeCloseTo(-5.145, 2);
  });

  it('names the terrain that does the hiding', async () => {
    const scene = await annotateScene(request());
    const hidden = byId(scene.peaks, 'test/hidden');

    expect(hidden.occludedBy?.distanceKm).toBeCloseTo(5, 6);
    expect(hidden.occludedBy?.elevationM).toBe(RIDGE_ELEVATION_M);
    expect(hidden.occludedBy?.altitudeDeg).toBeCloseTo(RIDGE_ALTITUDE_DEG, 9);
    expect(hidden.occludedBy?.rayBearingDeg).toBeCloseTo(90, 9);
  });

  it('projects each peak into the frame', async () => {
    const scene = await annotateScene(request());
    const high = byId(scene.peaks, 'test/high');

    // Dead ahead of a camera heading 90°, so x is exactly the frame centre.
    expect(high.image.x).toBeCloseTo(0.5, 12);
    // y = 0.5 − tan(α) / (2·tan(vFov/2)), the rectilinear projection written
    // out independently of src/core/projection.ts.
    const expectedY =
      0.5 -
      Math.tan((HIGH_ALTITUDE_DEG * Math.PI) / 180) /
        (2 * Math.tan((camera.vFovDeg * Math.PI) / 360));
    expect(high.image.y).toBeCloseTo(expectedY, 3);
    // 23.6° up with a 40° vertical field is above the top edge: y < 0.
    expect(high.image.y).toBeLessThan(0);
    expect(high.image.inFrame).toBe(false);

    // The hidden peak at +3.93° does land inside the frame — being off-image
    // and being occluded are different questions and must not be conflated.
    const hidden = byId(scene.peaks, 'test/hidden');
    expect(hidden.image.inFrame).toBe(true);
  });

  it('drops the peak the observer is standing on, loudly', async () => {
    const scene = await annotateScene(request());
    expect(scene.peaks.map((peak) => peak.id)).not.toContain('test/underfoot');
    expect(scene.warnings.join('\n')).toMatch(/Underfoot/);
    expect(scene.warnings.join('\n')).toMatch(/standing on it/);
  });

  it('orders peaks nearest first and keeps the subsets consistent', async () => {
    const scene = await annotateScene(request());
    const ranges = scene.peaks.map((peak) => peak.distanceKm);
    expect([...ranges].sort((a, b) => a - b)).toEqual(ranges);
    expect(scene.visible.length + scene.occluded.length).toBe(scene.peaks.length);
  });

  it('takes its timestamp from the injected clock', async () => {
    const scene = await annotateScene(request());
    expect(scene.generatedAt).toEqual(FIXED_CLOCK);
  });

  it('reports the configuration the run actually used', async () => {
    const scene = await annotateScene(request());
    expect(scene.config.sweep.rangeStepM).toBe(250);
    expect(scene.config.sweep.spanDeg).toBe(360);
    expect(scene.config.toleranceDeg).toBe(0);
    expect(scene.config.peakRadiusKm).toBe(50);
  });
});

describe('annotateScene — tolerance and sectors', () => {
  it('keeps a marginal peak when the caller grants tolerance', async () => {
    // HIDDEN falls 5.14° short of the ridge. A tolerance of 6° is far past
    // anything defensible in production — used here precisely because it makes
    // the knob's effect unambiguous.
    const scene = await annotateScene(
      request({
        config: {
          sweep: { bearingStepDeg: 1, rangeStepM: 250, maxRangeKm: 30 },
          peakRadiusKm: 50,
          toleranceDeg: 6,
          clock: () => FIXED_CLOCK,
        },
      }),
    );
    expect(scene.visible.map((peak) => peak.id)).toEqual(['test/high', 'test/hidden']);
  });

  it('sweeps only the requested sector', async () => {
    const scene = await annotateScene(
      request({
        config: {
          sweep: { startBearingDeg: 60, spanDeg: 60, bearingStepDeg: 1, rangeStepM: 250, maxRangeKm: 30 },
          peakRadiusKm: 50,
          clock: () => FIXED_CLOCK,
        },
      }),
    );
    expect(scene.horizon).toHaveLength(60);
    expect(scene.horizon[0]?.bearingDeg).toBe(60);
    // The verdicts on the due-east peaks are unchanged: their bearing is
    // inside the sector, so the same ridge sample decides them.
    expect(scene.visible.map((peak) => peak.id)).toEqual(['test/high']);
  });
});

describe('annotateScene — refusals', () => {
  it('refuses to invent a horizon when no terrain was found', async () => {
    // The observer's own height is supplied, so the run gets past the observer
    // lookup and fails at the thing under test: a sweep with nothing in it.
    await expect(
      annotateScene(
        request({
          observer: { lat: 0, lon: 0, eyeHeightM: EYE_HEIGHT_M, groundElevationM: 0 },
          elevation: new FunctionElevationSource(() => null, 'local-tiles(missing)'),
        }),
      ),
    ).rejects.toMatchObject({ code: 'no-terrain' });
  });

  it('fails at the observer first when even their own ground is unknown', async () => {
    await expect(
      annotateScene(
        request({ elevation: new FunctionElevationSource(() => null, 'local-tiles(missing)') }),
      ),
    ).rejects.toMatchObject({ code: 'observer-elevation-unknown' });
  });

  it('reports partial terrain as a warning rather than a silent gap', async () => {
    // Data only in the eastern half: the western rays contribute no horizon
    // point at all, and the caller has to be told.
    const halfWorld = new FunctionElevationSource(
      (point) => (point.lon >= 0 ? ringRidge(point) : null),
      'half-world',
    );
    const scene = await annotateScene(request({ elevation: halfWorld }));
    expect(scene.sweep.raysWithTerrain).toBeLessThan(scene.sweep.raysRequested);
    expect(scene.warnings.join('\n')).toMatch(/rays had no terrain data/);
    expect(scene.warnings.join('\n')).toMatch(/half-world/);
  });

  it('stops on an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(annotateScene(request({ signal: controller.signal }))).rejects.toBeInstanceOf(
      PipelineError,
    );
  });

  it('rejects a negative tolerance instead of treating it as extra clearance', async () => {
    await expect(
      annotateScene(request({ config: { toleranceDeg: -1 } })),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe('the scene geometry itself, stated independently', () => {
  it('agrees with the hand arithmetic in the module header', () => {
    expect(RIDGE_ALTITUDE_DEG).toBeCloseTo(9.0712, 3);
    expect(HIGH_ALTITUDE_DEG).toBeCloseTo(23.611, 2);
    expect(HIDDEN_ALTITUDE_DEG).toBeCloseTo(3.9263, 3);
  });

  it('sits within the documented gap of the exact-sphere second opinion', () => {
    // The fixtures kit models the sphere exactly; core uses the d²/2R drop.
    // They are different models, so this is a sanity bound, not an equality.
    for (const [elevationM, distanceM, dropModelDeg] of [
      [RIDGE_ELEVATION_M, RIDGE_DISTANCE_M, RIDGE_ALTITUDE_DEG],
      [HIGH_ELEVATION_M, HIGH_DISTANCE_M, HIGH_ALTITUDE_DEG],
      [HIDDEN_ELEVATION_M, HIDDEN_DISTANCE_M, HIDDEN_ALTITUDE_DEG],
    ] as const) {
      const exactDeg = apparentAltitudeDeg(EYE_ELEVATION_M, elevationM, distanceM);
      expect(Math.abs(exactDeg - dropModelDeg)).toBeLessThan(MODEL_GAP_TOLERANCE_DEG);
    }
  });

  it('places a due-east peak exactly on the equator at the right longitude', () => {
    expect(greatCircleDistanceM(ORIGIN, east(HIGH_DISTANCE_M))).toBeCloseTo(HIGH_DISTANCE_M, 6);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D8 — self-occlusion vs foreground occlusion, through the pipeline
 * ══════════════════════════════════════════════════════════════════════════ */

describe('annotateScene — occlusion classification (D8)', () => {
  it('calls the far peak behind the ring ridge FOREGROUND-occluded and never labels it', async () => {
    // Hidden Peak stands 20 km out with 5 km of sea-level ground between it and
    // the 900 m ring ridge that hides it: a 900 m col, so the ridge is a
    // different landform entirely and the peak is not in the picture at all.
    const scene = await annotateScene(request());
    const hidden = byId(scene.peaks, 'test/hidden');

    expect(hidden.visible).toBe(false);
    expect(hidden.visibility).toBe('foreground-occluded');
    expect(hidden.occlusion?.evidence).toBe('col-between-occluder-and-summit');
    // Ridge crest 900 m, valley floor 0 m — the col is the ridge's full height.
    expect(hidden.occlusion?.colDepthM).toBe(RIDGE_ELEVATION_M);

    expect(scene.labelled.map((peak) => peak.id)).not.toContain('test/hidden');
    expect(scene.foregroundOccluded.map((peak) => peak.id)).toContain('test/hidden');
  });

  it('classifies a visible peak as visible and labels it', async () => {
    const scene = await annotateScene(request());
    const high = byId(scene.peaks, 'test/high');

    expect(high.visibility).toBe('visible');
    expect(high.occlusion).toBeUndefined();
    expect(scene.labelled.map((peak) => peak.id)).toContain('test/high');
  });

  /**
   * THE COW HILL SHAPE, as a pipeline scene.
   *
   * Radially symmetric convex terrain, sea level under the observer, eye 2 m
   * up. With a 250 m range step the ray reads:
   *
   *   d = 250 m,  90 m:  tanα = (90 − 2 − 0.0043)/250  = 0.351983 → +19.391°
   *   d = 500 m, 150 m:  tanα = (150 − 2 − 0.0171)/500 = 0.295966 → +16.485°
   *   d = 750 m, 190 m:  tanα = (190 − 2 − 0.0384)/750 = 0.250615 → +14.070°
   *
   * and the summit — 230 m at 1000 m, its height from the peak database rather
   * than from the ground model, exactly as a real run takes it — subtends
   *
   *   tanα = (230 − 2 − 0.0683)/1000 = 0.227932 → +12.840°.
   *
   * So the 250 m shoulder out-angles the summit by 6.55° and the summit is
   * hidden. But the ground climbs 90 → 150 → 190 m without once falling back:
   * there is no col between the shoulder and the summit, so both are the same
   * hill and the label belongs on it, greyed.
   */
  const CONVEX_EYE_HEIGHT_M = 2;
  const CONVEX_SUMMIT_M = 230;
  const convexHill: TerrainFunctionM = (point) => {
    const distanceM = greatCircleDistanceM(ORIGIN, point);
    if (distanceM < 125) return 0;
    if (distanceM < 375) return 90;
    if (distanceM < 625) return 150;
    if (distanceM < 875) return 190;
    if (distanceM < 1125) return 215;
    return 0;
  };

  const convexRequest: AnnotateSceneRequest = {
    observer: { lat: 0, lon: 0, eyeHeightM: CONVEX_EYE_HEIGHT_M },
    camera,
    elevation: new FunctionElevationSource(convexHill, 'convex-hill'),
    peaks: new StaticPeakSource([
      {
        id: 'test/shoulder-hidden',
        name: 'Convex Hill',
        ...east(1000),
        elevationM: CONVEX_SUMMIT_M,
        elevationSource: 'unknown',
      },
    ]),
    config: {
      sweep: { bearingStepDeg: 1, rangeStepM: 250, maxRangeKm: 5 },
      peakRadiusKm: 50,
      clock: () => FIXED_CLOCK,
    },
  };

  it('calls a summit behind its own hill SELF-occluded, and labels it', async () => {
    const scene = await annotateScene(convexRequest);
    const summit = byId(scene.peaks, 'test/shoulder-hidden');

    // Still hidden by the geometry — nothing about the verdict is relaxed.
    expect(summit.visible).toBe(false);
    expect(summit.altitudeDeg).toBeCloseTo(
      expectedAltitudeDeg(CONVEX_SUMMIT_M, 1000, CONVEX_EYE_HEIGHT_M),
      6,
    );

    expect(summit.visibility).toBe('self-occluded');
    expect(summit.occlusion?.evidence).toBe('unbroken-rise-to-summit');
    expect(summit.occlusion?.crestDistanceKm).toBeCloseTo(0.25, 9);
    expect(summit.occlusion?.crestElevationM).toBe(90);
    expect(summit.occlusion?.colDepthM).toBe(0);

    // Labelled but NOT in the visible list: the two questions stay separate.
    expect(scene.labelled.map((peak) => peak.id)).toContain('test/shoulder-hidden');
    expect(scene.selfOccluded.map((peak) => peak.id)).toContain('test/shoulder-hidden');
    expect(scene.visible.map((peak) => peak.id)).not.toContain('test/shoulder-hidden');
  });

  it('keeps the three buckets a partition of every peak considered', async () => {
    for (const scene of [await annotateScene(request()), await annotateScene(convexRequest)]) {
      const counted =
        scene.visible.length + scene.selfOccluded.length + scene.foregroundOccluded.length;
      expect(counted).toBe(scene.peaks.length);
      expect(scene.labelled.length).toBe(scene.visible.length + scene.selfOccluded.length);
      expect(scene.occluded.length).toBe(
        scene.selfOccluded.length + scene.foregroundOccluded.length,
      );
      for (const peak of scene.peaks) {
        expect(peak.visible).toBe(peak.visibility === 'visible');
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * A wedge of missing terrain — no verdict is better than a bridged one
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The ring-ridge scene with the tiles between bearings 100° and 140° never
 * fetched: every ray in that wedge returns no elevation at all and is dropped,
 * so the horizon profile jumps straight from 100° to 140°.
 *
 * `Wedge Peak` stands at bearing 120°, 20 km out, 1500 m up — dead centre of
 * the hole, 40° of compass with not one terrain sample in it. Interpolating the
 * profile there produces a confident ridge angle bridged from the two lips of
 * the hole, and the peak is then declared hidden by ground nobody measured.
 * The only defensible answer is that there is no answer.
 */
const WEDGE_START_DEG = 100;
const WEDGE_END_DEG = 140;
const WEDGE_PEAK_BEARING_DEG = 120;
const WEDGE_PEAK_DISTANCE_M = HIDDEN_DISTANCE_M;

const wedgeOfMissingTiles: TerrainFunctionM = (point) => {
  const bearingDeg = initialBearingDeg(ORIGIN, point);
  if (bearingDeg > WEDGE_START_DEG && bearingDeg < WEDGE_END_DEG) return null;
  return ringRidge(point);
};

const wedgePeak: Peak = {
  id: 'test/wedge',
  name: 'Wedge Peak',
  ...destinationPoint(ORIGIN, WEDGE_PEAK_BEARING_DEG, WEDGE_PEAK_DISTANCE_M),
  elevationM: HIDDEN_ELEVATION_M,
  elevationSource: 'unknown',
};

function wedgeRequest(overrides: Partial<AnnotateSceneRequest> = {}): AnnotateSceneRequest {
  return request({
    elevation: new FunctionElevationSource(wedgeOfMissingTiles, 'wedge-of-missing-tiles'),
    peaks: new StaticPeakSource([...peaks, wedgePeak]),
    ...overrides,
  });
}

describe('annotateScene — bearings the sweep asked about and lost', () => {
  it('drops the rays in the wedge, leaving a hole in the profile', async () => {
    const scene = await annotateScene(wedgeRequest());

    // 101°–139° inclusive: 39 rays of the 360 asked for.
    expect(scene.sweep.raysRequested).toBe(360);
    expect(scene.sweep.raysWithTerrain).toBe(360 - 39);
    expect(scene.horizon).toHaveLength(360 - 39);
    expect(scene.horizon.map((point) => point.bearingDeg)).not.toContain(
      WEDGE_PEAK_BEARING_DEG,
    );
  });

  it('reaches no verdict on a peak inside the hole', async () => {
    const scene = await annotateScene(wedgeRequest());

    for (const list of [scene.peaks, scene.visible, scene.occluded, scene.labelled]) {
      expect(list.map((peak) => peak.id)).not.toContain('test/wedge');
    }
    expect(scene.unmeasured.map((peak) => peak.id)).toEqual(['test/wedge']);
    expect(scene.warnings.join('\n')).toMatch(/Wedge Peak/);
    expect(scene.warnings.join('\n')).toMatch(/no terrain data/);
  });

  it('still judges the peaks whose own bearing was swept', async () => {
    const scene = await annotateScene(wedgeRequest());
    // High Peak and Hidden Peak are due east, well clear of the wedge, and the
    // ring ridge in front of them is untouched — so their verdicts are the ones
    // the ring-ridge scene documents.
    expect(scene.visible.map((peak) => peak.id)).toEqual(['test/high']);
    expect(byId(scene.peaks, 'test/hidden').visible).toBe(false);
  });

  it('does not treat the un-swept part of a SECTOR sweep as a lost bearing', async () => {
    // Full terrain, but only 60°–120° swept. The rays that were asked for all
    // came back, so nothing was lost: every peak still gets a verdict, and
    // `unmeasured` stays empty. A sector sweep is a bounded profile, not a
    // damaged one.
    const scene = await annotateScene(
      request({
        config: {
          sweep: {
            startBearingDeg: 60,
            spanDeg: 60,
            bearingStepDeg: 1,
            rangeStepM: 250,
            maxRangeKm: 30,
          },
          peakRadiusKm: 50,
          clock: () => FIXED_CLOCK,
        },
      }),
    );

    expect(scene.sweep.raysWithTerrain).toBe(scene.sweep.raysRequested);
    expect(scene.unmeasured).toEqual([]);
    expect(scene.peaks.map((peak) => peak.id)).toEqual(['test/high', 'test/hidden']);
    expect(scene.visible.map((peak) => peak.id)).toEqual(['test/high']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * A LOW BANK IN FRONT OF A TALLER MOUNTAIN (adversarial review 2, finding 1)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The same terrain as `classifyOcclusion — a taller crest standing behind the
 * first blocker` in src/core/visibility.test.ts, run end to end so the outcome
 * the review actually complained about — a greyed LABEL planted on a different
 * mountain's face, below the skyline — is the thing being asserted.
 *
 *   0.95–1.15 km   150 m   a low bank; the first thing in the way, 2.887°
 *   1.15–14.5 km   150→749 m  a foreslope that never dips
 *   14.5–15.5 km   900 m   a DIFFERENT mountain; the skyline here, 3.084°
 *   15.5–19.8 km   500 m   a 400 m col
 *   19.8–20 km     500→1000 m  the summit's own flank
 *   Mount Ghost    1000 m at 20 km, 2.499° — below both of them
 *
 * Measured from the bank, the foreslope never falls below 150 m, so the col
 * reads 0 and Mount Ghost is called self-occluded: labelled, greyed, drawn on
 * the 900 m mountain 5 km short of the summit it names. Measured from the
 * crest that is actually in view, the col is 400 m deep and the peak is a
 * different landform — foreground-occluded, never drawn. Sweeping a 60° sector
 * keeps the run to 60 rays; the peak is due east, in the middle of it.
 */
const GHOST_DISTANCE_M = 20_000;
const GHOST_ELEVATION_M = 1000;

/** The review's profile as a function of ground distance from the observer. */
function reviewProfileM(distanceM: number): number {
  if (distanceM < 950) return 0;
  if (distanceM <= 1150) return 150;
  if (distanceM < 14_500) return 150 + ((distanceM - 1150) * (749 - 150)) / (14_500 - 1150);
  if (distanceM <= 15_500) return 900;
  if (distanceM <= 19_800) return 500;
  return 500 + ((distanceM - 19_800) * (GHOST_ELEVATION_M - 500)) / 200;
}

const bankThenMountain: TerrainFunctionM = (point) =>
  reviewProfileM(greatCircleDistanceM(ORIGIN, point));

const ghostRequest: AnnotateSceneRequest = {
  observer: { lat: 0, lon: 0, eyeHeightM: EYE_HEIGHT_M },
  camera,
  elevation: new FunctionElevationSource(bankThenMountain, 'bank-then-mountain'),
  peaks: new StaticPeakSource([
    {
      id: 'test/ghost',
      name: 'Mount Ghost',
      ...east(GHOST_DISTANCE_M),
      elevationM: GHOST_ELEVATION_M,
      elevationSource: 'unknown',
    },
  ]),
  config: {
    sweep: {
      startBearingDeg: 60,
      spanDeg: 60,
      bearingStepDeg: 1,
      rangeStepM: 90,
      maxRangeKm: 21,
    },
    peakRadiusKm: 50,
    clock: () => FIXED_CLOCK,
  },
};

describe('annotateScene — a summit across a col behind a low near bank', () => {
  it('has the geometry the case turns on', async () => {
    const scene = await annotateScene(ghostRequest);
    const ghost = byId(scene.peaks, 'test/ghost');

    // Hand arithmetic, drop model, eye at 100 m — see the header above.
    expect(ghost.altitudeDeg).toBeCloseTo(expectedAltitudeDeg(GHOST_ELEVATION_M, 20_000), 9);
    expect(ghost.altitudeDeg).toBeCloseTo(2.4985, 3);
    // The 900 m mountain at 14.58 km is the highest thing in front of it …
    expect(expectedAltitudeDeg(900, 14_580)).toBeCloseTo(3.0838, 3);
    // … and the 150 m bank at 0.99 km, which gets in the way first, is lower.
    expect(expectedAltitudeDeg(150, 990)).toBeCloseTo(2.8874, 3);
    expect(ghost.occludingAltitudeDeg).toBeCloseTo(3.0838, 3);
    expect(ghost.visible).toBe(false);
  });

  it('does not plant a label on the mountain in front of it', async () => {
    const scene = await annotateScene(ghostRequest);
    const ghost = byId(scene.peaks, 'test/ghost');

    expect(ghost.visibility).toBe('foreground-occluded');
    expect(ghost.occlusion?.evidence).toBe('col-between-occluder-and-summit');
    expect(ghost.occlusion?.crestElevationM).toBe(900);
    expect(ghost.occlusion?.crestDistanceKm).toBeCloseTo(14.58, 6);
    // 900 m crest, 500 m col floor. Ground distances round-trip through the
    // destination-point formula, so the floor is 500 m to within a nanometre.
    expect(ghost.occlusion?.colDepthM ?? Number.NaN).toBeCloseTo(400, 6);

    expect(scene.labelled.map((peak) => peak.name)).not.toContain('Mount Ghost');
    expect(scene.foregroundOccluded.map((peak) => peak.name)).toContain('Mount Ghost');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PEAKS PAST THE END OF THE SWEEP (adversarial review 2, finding 2)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The review's scene, and the asymmetry the shipped defaults have:
 * `DEFAULT_PEAK_RADIUS_KM` is 200 km while `DEFAULT_SWEEP.maxRangeKm` is 30 km,
 * so summits are looked for six times farther out than terrain is ever
 * sampled. A 1500 m wall at 45 km and a 2000 m summit at 60 km, eye at 100 m:
 *
 *   wall    1500 m @ 45 km: drop 138.2647 → atan(1261.7353/45000) = 1.606073°
 *   summit  2000 m @ 60 km: drop 245.8017 → atan(1654.1983/60000) = 1.579244°
 *
 * The wall hides the summit by 0.026829°. A 30 km sweep never sees the wall, so
 * nothing blocks and the summit clears comfortably — a confident `visible`
 * resting on the first half of a sightline, with no warning anywhere.
 *
 * Both numbers are hand arithmetic from the documented drop model, asserted
 * below before anything else is claimed.
 */
const WALL_DISTANCE_M = 45_000;
const WALL_ELEVATION_M = 1500;
const BEHIND_DISTANCE_M = 60_000;
const BEHIND_ELEVATION_M = 2000;

const wallBeyondTheSweep: TerrainFunctionM = (point) => {
  const distanceM = greatCircleDistanceM(ORIGIN, point);
  // +-50 m of a 90 m sampling step: exactly one sample per ray, at 45 km.
  return distanceM >= 44_950 && distanceM <= 45_050 ? WALL_ELEVATION_M : 0;
};

function longRangeRequest(maxRangeKm: number): AnnotateSceneRequest {
  return {
    observer: { lat: 0, lon: 0, eyeHeightM: EYE_HEIGHT_M },
    camera,
    elevation: new FunctionElevationSource(wallBeyondTheSweep, 'wall-at-45km'),
    peaks: new StaticPeakSource([
      {
        id: 'test/behind',
        name: 'Mount Behind',
        ...east(BEHIND_DISTANCE_M),
        elevationM: BEHIND_ELEVATION_M,
        elevationSource: 'unknown',
      },
    ]),
    config: {
      sweep: { startBearingDeg: 60, spanDeg: 60, bearingStepDeg: 1, rangeStepM: 90, maxRangeKm },
      peakRadiusKm: 200,
      clock: () => FIXED_CLOCK,
    },
  };
}

describe('annotateScene — a peak farther out than the sweep reached', () => {
  it('has the geometry the case turns on: the wall really does hide the summit', () => {
    const wallDeg = expectedAltitudeDeg(WALL_ELEVATION_M, WALL_DISTANCE_M);
    const summitDeg = expectedAltitudeDeg(BEHIND_ELEVATION_M, BEHIND_DISTANCE_M);

    expect(wallDeg).toBeCloseTo(1.606073, 5);
    expect(summitDeg).toBeCloseTo(1.579244, 5);
    expect(wallDeg - summitDeg).toBeCloseTo(0.026829, 5);
    expect(summitDeg).toBeLessThan(wallDeg);
  });

  it('refuses a verdict rather than clearing a summit on half a sightline', async () => {
    const scene = await annotateScene(longRangeRequest(30));

    // The sweep stopped at 30 km; the summit is at 60 km. Nothing between the
    // two was looked at, so neither answer is available.
    expect(scene.config.sweep.maxRangeKm).toBe(30);
    for (const list of [scene.peaks, scene.visible, scene.occluded, scene.labelled]) {
      expect(list.map((peak) => peak.id)).not.toContain('test/behind');
    }
    expect(scene.unmeasured.map((peak) => peak.id)).toEqual(['test/behind']);

    // And it says so — the silence was half the finding.
    expect(scene.warnings.join('\n')).toMatch(/Mount Behind/);
    expect(scene.warnings.join('\n')).toMatch(/30 km/);
  });

  it('gives a real answer once the sweep is long enough to reach the wall', async () => {
    // The same scene with the sweep widened past the summit: the wall is now
    // sampled, and the verdict is a measurement rather than a refusal.
    const scene = await annotateScene(longRangeRequest(65));
    const behind = byId(scene.peaks, 'test/behind');

    expect(scene.unmeasured).toEqual([]);
    expect(behind.visible).toBe(false);
    expect(behind.occludingAltitudeDeg).toBeCloseTo(
      expectedAltitudeDeg(WALL_ELEVATION_M, WALL_DISTANCE_M),
      4,
    );
    expect(behind.clearanceDeg).toBeCloseTo(-0.026829, 5);
    // 15 km of sea-level ground between the wall and the summit: a 1500 m col,
    // so the wall is a different landform and the peak is never labelled.
    expect(behind.visibility).toBe('foreground-occluded');
    expect(behind.occlusion?.colDepthM).toBe(WALL_ELEVATION_M);
    expect(scene.labelled.map((peak) => peak.id)).not.toContain('test/behind');
  });

  it('lets a caller judge on partial evidence, but only by saying so', async () => {
    // The acceptance suite's committed terrain windows are deliberately small
    // (3 km at Kerry Park for a 134 km sightline), and they state what that
    // means in prose. This flag is how a caller states it in code; the default
    // is the refusal above.
    const base = longRangeRequest(30);
    const scene = await annotateScene({
      ...base,
      config: { ...base.config, judgeBeyondMeasuredTerrain: true },
    });

    expect(scene.unmeasured).toEqual([]);
    expect(byId(scene.peaks, 'test/behind').visible).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * P1.6 — the phantom wall: verdicts measured against unresolvable near ground
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The Railroad Ridge shape (docs/NEAR-FIELD.md) in checkable numbers: eye 2 m
 * over flat ground, a 3 m wall exactly one sample away at 90 m, and summits
 * 11 km east whose clearances land inside and outside the wall's noise.
 *
 * Closed forms, same derivation as the ring ridge above (R_eff = 7 322 998.62,
 * drop = d²/2R_eff), eye at 2 m:
 *
 *   wall     d =    90 m, h =   3 m: drop 0.00055 m → α = +0.636242°
 *   CLEAR    d = 11 km,   h = 400 m: drop 8.2617 m  → α = +2.029184°, clears by +1.392943°
 *   UP       d = 11 km,   h = 150 m:                → α = +0.727817°, clears by +0.091576°
 *   DOWN     d = 11 km,   h = 130 m:                → α = +0.623657°, falls short by −0.012584°
 *
 * The DEM's own relief within 150 m is the wall against the flat ground:
 * (3 − 0)/2 = 1.5 m either way, which at the wall's 90 m subtends
 * atan(1.5/90) = 0.954841°. So UP and DOWN sit deep inside the noise —
 * marginal, both of them — while CLEAR beats it and stays a confident verdict
 * even though its occluder is the same unresolvable wall.
 */
const NF_EYE_HEIGHT_M = 2;
const WALL_ALTITUDE_DEG = expectedAltitudeDeg(3, 90, NF_EYE_HEIGHT_M);
const NF_BAND_DEG = (Math.atan(1.5 / 90) * 180) / Math.PI;

const phantomWall: TerrainFunctionM = (point) => {
  const distanceM = greatCircleDistanceM(ORIGIN, point);
  return distanceM >= 75 && distanceM <= 105 ? 3 : 0;
};

const nearFieldPeaks: readonly Peak[] = [
  { id: 'test/clear', name: 'Clear', ...east(11_000), elevationM: 400, elevationSource: 'unknown' },
  { id: 'test/up', name: 'Up', ...east(11_000), elevationM: 150, elevationSource: 'unknown' },
  { id: 'test/down', name: 'Down', ...east(11_000), elevationM: 130, elevationSource: 'unknown' },
];

function nearFieldRequest(nearFieldRadiusM: number): AnnotateSceneRequest {
  return request({
    observer: { lat: 0, lon: 0, eyeHeightM: NF_EYE_HEIGHT_M },
    elevation: new FunctionElevationSource(phantomWall, 'phantom-wall'),
    peaks: new StaticPeakSource(nearFieldPeaks),
    config: {
      sweep: { bearingStepDeg: 1, rangeStepM: 30, maxRangeKm: 12 },
      peakRadiusKm: 50,
      nearFieldRadiusM,
      clock: () => FIXED_CLOCK,
    },
  });
}

describe('annotateScene — near-field marginality (P1.6)', () => {
  it('measures the near ground disagreement the DEM itself admits to', async () => {
    const scene = await annotateScene(nearFieldRequest(150));
    expect(scene.nearFieldUncertainty).toBeDefined();
    expect(scene.nearFieldUncertainty?.radiusM).toBe(150);
    // Readings within 150 m: the wall's 3 m and flat 0 m → half-span 1.5 m.
    expect(scene.nearFieldUncertainty?.elevationBandM).toBeCloseTo(1.5, 10);
    // The skyline due east IS the wall, at the closed-form angle above.
    const dueEast = scene.horizon.find((point) => point.bearingDeg === 90);
    expect(dueEast?.altitudeDeg).toBeCloseTo(WALL_ALTITUDE_DEG, 9);
    expect(dueEast?.altitudeDeg).toBeCloseTo(0.636242, 5);
    expect(dueEast?.distanceKm).toBeCloseTo(0.09, 9);
  });

  it('reports a verdict that flips inside the noise as marginal, in BOTH directions', async () => {
    const scene = await annotateScene(nearFieldRequest(150));

    const up = byId(scene.peaks, 'test/up');
    const down = byId(scene.peaks, 'test/down');
    expect(up.visibility).toBe('marginal');
    expect(down.visibility).toBe('marginal');
    // The band is the wall's own height uncertainty at the wall's distance.
    expect(up.clearanceBandDeg).toBeCloseTo(NF_BAND_DEG, 10);
    expect(up.clearanceBandDeg).toBeCloseTo(0.954841, 5);
    expect(up.occluderDistanceKm).toBeCloseTo(0.09, 10);
    // The raw geometric side each fell on is preserved, band-free.
    expect(up.visible).toBe(true);
    expect(down.visible).toBe(false);
    expect(up.clearanceDeg).toBeCloseTo(0.091576, 5);
    expect(down.clearanceDeg).toBeCloseTo(-0.012584, 5);

    expect(scene.marginal.map((peak) => peak.id).sort()).toEqual(['test/down', 'test/up']);
    // Marginal peaks are labelled — a direction the user can check — but the
    // confident lists exclude them, and no occlusion story is told for them.
    expect(scene.labelled.map((peak) => peak.id)).toContain('test/up');
    expect(scene.labelled.map((peak) => peak.id)).toContain('test/down');
    expect(scene.visible.map((peak) => peak.id)).toEqual(['test/clear']);
    expect(scene.occluded).toEqual([]);
    expect(up.occlusion).toBeUndefined();
    expect(down.occlusion).toBeUndefined();
    expect(down.occludedBy).toBeUndefined();
    expect(scene.warnings.some((warning) => warning.includes('no confident verdict'))).toBe(true);
  });

  it('keeps a confident verdict whose clearance beats the band, same occluder', async () => {
    const scene = await annotateScene(nearFieldRequest(150));
    const clear = byId(scene.peaks, 'test/clear');
    // +1.392943° against ±0.954841°: stable at both ends of the band, so the
    // near-field occluder does NOT demote it. Uncertainty narrows claims to
    // what survives it — it is not a blanket refusal.
    expect(clear.visibility).toBe('visible');
    expect(clear.clearanceBandDeg).toBeCloseTo(NF_BAND_DEG, 10);
    expect(clear.clearanceDeg).toBeCloseTo(1.392943, 5);
  });

  it('changes NOTHING when the radius is unset — the pre-P1.6 verdicts stand', async () => {
    const scene = await annotateScene(nearFieldRequest(0));
    expect(scene.nearFieldUncertainty).toBeUndefined();
    expect(scene.marginal).toEqual([]);
    expect(byId(scene.peaks, 'test/up').visibility).toBe('visible');
    expect(byId(scene.peaks, 'test/up').clearanceBandDeg).toBe(0);
    // DOWN is decided by the wall: crest at 90 m, ground drops 3 m behind it —
    // a col, so a different landform: foreground-occluded, never drawn.
    const down = byId(scene.peaks, 'test/down');
    expect(down.visibility).toBe('foreground-occluded');
    expect(down.occlusion?.evidence).toBe('col-between-occluder-and-summit');
    expect(scene.labelled.map((peak) => peak.id).sort()).toEqual(['test/clear', 'test/up']);
  });

  it('leaves a resolvable occluder alone: the ring ridge at 5 km is not near field', async () => {
    // The original scene with the near-field test ON: the ridge occluding
    // Hidden Peak stands 5 km out, far beyond 150 m, and the sweep's first
    // sample is at 250 m so the DEM reports no relief inside the radius at
    // all. Every verdict must equal the radius-0 run's.
    const scene = await annotateScene(
      request({ config: { ...request().config, nearFieldRadiusM: 150 } }),
    );
    expect(scene.nearFieldUncertainty?.elevationBandM).toBe(0);
    expect(scene.marginal).toEqual([]);
    expect(byId(scene.peaks, 'test/high').visibility).toBe('visible');
    expect(byId(scene.peaks, 'test/hidden').visibility).toBe('foreground-occluded');
    expect(byId(scene.peaks, 'test/hidden').clearanceBandDeg).toBe(0);
  });
});

describe('nearFieldElevationBandM', () => {
  const ray = (bearingDeg: number, samples: readonly [number, number][]) => ({
    bearingDeg,
    samples: samples.map(([distanceM, elevationM]) => ({ distanceM, elevationM })),
  });

  it('is half the span of readings inside the radius, observer cell included', () => {
    // Observer ground 10 m, near samples 0 m and 16 m: span 16, half 8.
    expect(nearFieldElevationBandM(10, [ray(0, [[50, 0], [100, 16]])], 150)).toBe(8);
    // The observer's own reading can be an extreme: ground 10, samples all 0.
    expect(nearFieldElevationBandM(10, [ray(0, [[50, 0], [100, 0]])], 150)).toBe(5);
  });

  it('ignores samples beyond the radius', () => {
    expect(nearFieldElevationBandM(0, [ray(0, [[50, 2], [200, 90]])], 150)).toBe(1);
  });

  it('charges a directional band only with ground in that direction', () => {
    // The ridge-crest case that forced the window (found on the first real
    // run): flat ground ahead at bearing 0, a valley 50 m deep behind at 180.
    // A verdict looking north must not carry the southern valley's relief —
    // no mis-placed camera raises that valley into the northward view.
    const crest = [ray(0, [[90, 12]]), ray(180, [[90, -50]])];
    expect(nearFieldElevationBandM(10, crest, 150, 0)).toBe(1);
    expect(nearFieldElevationBandM(10, crest, 150, 180)).toBe(30);
    // All directions — the scene-level figure — spans both: (12−(−50))/2.
    expect(nearFieldElevationBandM(10, crest, 150)).toBe(31);
    // The window is ±15° and wrap-safe: a ray at 350° serves a peak at 4°.
    expect(nearFieldElevationBandM(10, [ray(350, [[90, 12]])], 150, 4)).toBe(1);
    expect(nearFieldElevationBandM(10, [ray(350, [[90, 12]])], 150, 20)).toBe(0);
  });

  it('is 0 when the sweep holds no sample inside the radius', () => {
    // minRangeM excluded them, or the first step lands beyond: nothing was
    // sampled there, so there is no relief to report — and rangeIsMeasured is
    // already refusing verdicts on the caller's behalf in that configuration.
    expect(nearFieldElevationBandM(10, [ray(0, [[250, 0]])], 150)).toBe(0);
    expect(nearFieldElevationBandM(10, [], 150)).toBe(0);
  });

  it('is 0 at radius 0 — the switch in its off position', () => {
    expect(nearFieldElevationBandM(10, [ray(0, [[50, 999]])], 0)).toBe(0);
  });
});

describe('annotateScene — the alignment horizon (CV-10)', () => {
  it('drops the phantom wall from the alignment profile and keeps it for verdicts', async () => {
    const scene = await annotateScene(nearFieldRequest(150));
    expect(scene.alignmentHorizon).toBeDefined();
    // Verdicts still see the wall: the due-east skyline is the 90 m sample.
    const dueEast = scene.horizon.find((point) => point.bearingDeg === 90);
    expect(dueEast?.distanceKm).toBeCloseTo(0.09, 9);
    // The aligner does not: its due-east skyline rests on far ground, and no
    // point anywhere in the alignment profile is nearer than the radius.
    const alignedEast = scene.alignmentHorizon?.find((point) => point.bearingDeg === 90);
    expect(alignedEast).toBeDefined();
    expect((alignedEast?.distanceKm ?? 0) * 1000).toBeGreaterThanOrEqual(150);
    for (const point of scene.alignmentHorizon ?? []) {
      expect(point.distanceKm * 1000).toBeGreaterThanOrEqual(150);
    }
    // Flat ground at 11+ km sits BELOW the eye: the wall's +0.636° becomes a
    // negative altitude, which is what "the phantom is gone" looks like.
    expect(alignedEast?.altitudeDeg ?? 0).toBeLessThan(0);
  });

  it('builds no alignment horizon when the near-field radius is unset', async () => {
    const scene = await annotateScene(nearFieldRequest(0));
    expect(scene.alignmentHorizon).toBeUndefined();
  });
});

describe('annotateScene — peaks outside a bounded sweep (R-1)', () => {
  // A 90° sector centred due east: [45°, 135°]. Both east peaks are inside;
  // a peak due NORTH is 45° outside it, and before R-1 it was judged against
  // a horizon interpolated across the 270° the sweep never sampled.
  const northPeak: Peak = {
    id: 'test/north',
    name: 'North Peak',
    lat: 5000 / METRES_PER_DEG,
    lon: 0,
    elevationM: 2000,
    elevationSource: 'unknown',
  };

  function sectorRequest(): AnnotateSceneRequest {
    return request({
      peaks: new StaticPeakSource([...peaks, northPeak]),
      config: {
        sweep: { bearingStepDeg: 1, rangeStepM: 250, maxRangeKm: 30, startBearingDeg: 45, spanDeg: 90 },
        peakRadiusKm: 50,
        clock: () => FIXED_CLOCK,
      },
    });
  }

  it('refuses a verdict on a peak the sector never looked toward', async () => {
    const scene = await annotateScene(sectorRequest());
    // The east peaks keep their verdicts: the sector covers them.
    expect(byId(scene.peaks, 'test/high').visible).toBe(true);
    expect(byId(scene.peaks, 'test/hidden').visible).toBe(false);
    // The north peak gets NO verdict — not a fabricated one off the wrapped
    // interpolation between the sector's two edge rays.
    expect(scene.peaks.some((peak) => peak.id === 'test/north')).toBe(false);
    expect(scene.unmeasured.some((peak) => peak.id === 'test/north')).toBe(true);
    expect(scene.warnings.some((warning) => warning.includes('outside the swept'))).toBe(true);
  });

  it('leaves a full-circle sweep exactly as it was', async () => {
    const scene = await annotateScene(
      request({ peaks: new StaticPeakSource([...peaks, northPeak]) }),
    );
    expect(scene.peaks.some((peak) => peak.id === 'test/north')).toBe(true);
    expect(scene.unmeasured.some((peak) => peak.id === 'test/north')).toBe(false);
  });
});
