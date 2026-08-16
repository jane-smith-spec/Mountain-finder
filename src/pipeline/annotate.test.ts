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
import { apparentAltitudeDeg, greatCircleDistanceM } from '../../fixtures/scenes';

import { annotateScene } from './annotate';
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
    expect(high.horizonAltitudeDeg).toBeCloseTo(RIDGE_ALTITUDE_DEG, 9);
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
