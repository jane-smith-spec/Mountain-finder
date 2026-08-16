/**
 * ACCEPTANCE — SYNTHETIC ANALYTIC SCENES (PLAN.md P6.1)
 *
 * WHAT THIS FILE GENUINELY PROVES, TODAY, WITHOUT ANY PIPELINE:
 *
 *   1. The fixtures' own geometry kit is correct, checked against answers that
 *      are exact by construction (1° of latitude, a quarter circumference to
 *      the pole) and by round-tripping destination against distance.
 *   2. Each scene's closed-form expectation matches arithmetic done BY HAND and
 *      written out in the scene module — the literals below were typed from
 *      those longhand chains, not pasted from a program's output.
 *   3. Two independent Earth models (exact spherical atan2 vs the surveying
 *      curvature-drop form) agree on every expectation to better than 0.002°,
 *      so no expectation here is an artefact of one modelling choice.
 *   4. The generators emit terrain that actually contains the features the
 *      expectations are about, sampled exactly where the maths assumes.
 *   5. A brute-force scan of the generated terrain — using no pipeline code —
 *      recovers the same skyline the closed form predicts.
 *
 * WHAT IT DOES NOT PROVE: anything at all about src/core. See
 * pipeline-hooks.test.ts for the assertions waiting on Waves 2–3.
 */

import { describe, expect, it } from 'vitest';

import {
  analyticScenes,
  apparentAltitudeDeg,
  apparentAltitudeDegPlaneDrop,
  conicalPeakBruteForceRayMaximum,
  conicalPeakScene,
  destinationPoint,
  EARTH_MEAN_RADIUS_M,
  EFFECTIVE_EARTH_RADIUS_M,
  eyeElevationM,
  flatPlaneBruteForceSkyline,
  flatPlaneScene,
  greatCircleDistanceM,
  initialBearingDeg,
  REFRACTION_COEFFICIENT_K,
  twinRidgesFarHiddenScene,
  twinRidgesFarVisibleScene,
  type SyntheticScene,
} from '../../fixtures/scenes';

import {
  CONE_APEX_BEARING_DEG,
  CONE_APEX_DISTANCE_M,
  CONE_APEX_ELEVATION_M,
  CONE_PLAIN_BEARING_DEG,
  FAR_RIDGE_CREST_HIDDEN_M,
  FAR_RIDGE_CREST_VISIBLE_M,
  FAR_RIDGE_DISTANCE_M,
  FLAT_PLANE_EXPECTED_DIP_DEG,
  FLAT_PLANE_EXPECTED_DIP_SMALL_ANGLE_DEG,
  FLAT_PLANE_EXPECTED_HORIZON_DISTANCE_M,
  FLAT_PLANE_EXPECTED_HORIZON_DISTANCE_SMALL_ANGLE_M,
  NEAR_RIDGE_CREST_M,
  NEAR_RIDGE_DISTANCE_M,
  TWIN_RIDGES_PLAIN_ELEVATION_M,
  TWIN_RIDGES_PRIMARY_BEARING_DEG,
} from '../../fixtures/scenes';

/**
 * Angles typed out from the longhand arithmetic in the scene modules' headers.
 * All of these are the CURVATURE-DROP form, because that is the one that can be
 * carried through by hand with an atan series. Each is checked to 1e-5°.
 */
const HAND_DERIVED_DEG = {
  flatPlaneDipExact: -0.299427,
  flatPlaneDipDropModel: -0.299429,
  nearRidge: 4.554485,
  farRidgeVisibleVariant: 5.349262,
  farRidgeHiddenVariant: 4.211342,
  coneApex: 8.481293,
  conePlainDip: -0.042346,
} as const;

/** How far the two Earth models may disagree before a scene is untrustworthy. */
const MODEL_AGREEMENT_TOLERANCE_DEG = 0.002;

describe('fixture geometry kit — checked against exactly-known answers', () => {
  it('derives the effective radius symbolically from R and k, not from a copied decimal', () => {
    expect(EARTH_MEAN_RADIUS_M).toBe(6_371_008.8);
    expect(REFRACTION_COEFFICIENT_K).toBe(0.13);
    expect(EFFECTIVE_EARTH_RADIUS_M).toBeCloseTo(
      EARTH_MEAN_RADIUS_M / (1 - REFRACTION_COEFFICIENT_K),
      9,
    );
    // ~7 323 km, NOT ~7 314 km. Guards against a wrong constant being pasted in.
    expect(EFFECTIVE_EARTH_RADIUS_M).toBeGreaterThan(7_322_000);
    expect(EFFECTIVE_EARTH_RADIUS_M).toBeLessThan(7_324_000);
  });

  const oneDegreeOfArcM = (EARTH_MEAN_RADIUS_M * Math.PI) / 180;

  it('destinationPoint: due north by one degree of arc lands one degree north', () => {
    const p = destinationPoint({ lat: 0, lon: 0 }, 0, oneDegreeOfArcM);
    expect(p.lat).toBeCloseTo(1, 10);
    expect(p.lon).toBeCloseTo(0, 10);
  });

  it('destinationPoint: due east along the equator by one degree of arc lands one degree east', () => {
    const p = destinationPoint({ lat: 0, lon: 0 }, 90, oneDegreeOfArcM);
    expect(p.lat).toBeCloseTo(0, 10);
    expect(p.lon).toBeCloseTo(1, 10);
  });

  it('destinationPoint: a quarter circumference due north from the equator reaches the pole', () => {
    const p = destinationPoint(
      { lat: 0, lon: 0 },
      0,
      (EARTH_MEAN_RADIUS_M * Math.PI) / 2,
    );
    expect(p.lat).toBeCloseTo(90, 8);
  });

  it('destinationPoint and greatCircleDistanceM are mutual inverses', () => {
    const origin = { lat: 47, lon: 11 };
    for (const bearingDeg of [0, 37, 90, 180, 271, 359]) {
      for (const distanceM of [250, 5_000, 20_000, 60_000, 250_000]) {
        const p = destinationPoint(origin, bearingDeg, distanceM);
        expect(greatCircleDistanceM(origin, p)).toBeCloseTo(distanceM, 4);
      }
    }
  });

  it('initialBearingDeg recovers the bearing destinationPoint was given', () => {
    const origin = { lat: 47, lon: 11 };
    for (const bearingDeg of [0, 37, 90, 180, 271, 359]) {
      const p = destinationPoint(origin, bearingDeg, 20_000);
      expect(initialBearingDeg(origin, p)).toBeCloseTo(bearingDeg, 6);
    }
  });

  it('the two Earth models agree on a spread of geometries', () => {
    for (const [eyeM, targetM, distanceM] of [
      [500, 900, 5_000],
      [500, 2_400, 20_000],
      [2, 1_500, 10_000],
      [1_174.6, 3_187, 291_900],
    ] as const) {
      const exactDeg = apparentAltitudeDeg(eyeM, targetM, distanceM);
      const dropDeg = apparentAltitudeDegPlaneDrop(eyeM, targetM, distanceM);
      expect(Math.abs(exactDeg - dropDeg)).toBeLessThan(MODEL_AGREEMENT_TOLERANCE_DEG);
    }
  });
});

describe('every analytic scene is internally well-formed', () => {
  it('exposes four scenes with unique ids', () => {
    expect(analyticScenes).toHaveLength(4);
    const ids = analyticScenes.map((scene) => scene.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const scene of analyticScenes) {
    describe(scene.id, () => {
      it('states a derivation, a tolerance and at least one expectation', () => {
        expect(scene.derivation.length).toBeGreaterThan(80);
        expect(scene.toleranceDeg).toBeGreaterThan(0);
        expect(scene.distanceToleranceM).toBeGreaterThan(0);
        expect(scene.expectedSkyline.length).toBeGreaterThan(0);
      });

      it('generates exactly the samples its sampling description implies', () => {
        const samples = scene.generateSamples();
        const { bearingStepDeg, rangeStepM, maxRangeM } = scene.sampling;
        const expectedCount =
          1 + Math.round(360 / bearingStepDeg) * Math.round(maxRangeM / rangeStepM);
        expect(samples).toHaveLength(expectedCount);
      });

      it('generates samples whose elevations match the analytic terrain', () => {
        // Every sample must be reproducible from the scene's own terrain
        // function. If the generator drifted from the analytic definition, the
        // expectations would describe terrain the pipeline never sees.
        const samples = scene.generateSamples();
        for (let index = 0; index < samples.length; index += 977) {
          const sample = samples[index];
          expect(sample).toBeDefined();
          if (sample === undefined) continue;
          expect(sample.elevationM).toBeCloseTo(scene.elevationAtM(sample), 9);
          expect(Number.isFinite(sample.lat)).toBe(true);
          expect(Number.isFinite(sample.lon)).toBe(true);
          expect(Math.abs(sample.lat)).toBeLessThanOrEqual(90);
          expect(Math.abs(sample.lon)).toBeLessThanOrEqual(180);
        }
      });

      it('places every sample within the declared maximum range', () => {
        const samples = scene.generateSamples();
        const origin = { lat: scene.observer.lat, lon: scene.observer.lon };
        for (let index = 0; index < samples.length; index += 1361) {
          const sample = samples[index];
          if (sample === undefined) continue;
          expect(greatCircleDistanceM(origin, sample)).toBeLessThanOrEqual(
            scene.sampling.maxRangeM + 1,
          );
        }
      });

      it('agrees with itself across the two Earth models', () => {
        for (const point of scene.expectedSkyline) {
          expect(
            Math.abs(point.altitudeDeg - point.altitudeDegPlaneDrop),
          ).toBeLessThan(MODEL_AGREEMENT_TOLERANCE_DEG);
        }
      });

      it('declares peak verdicts consistent with its own closed-form angles', () => {
        for (const verdict of scene.expectedPeakVerdicts) {
          const peak = scene.peaks.find((candidate) => candidate.id === verdict.peakId);
          expect(peak, `verdict references unknown peak ${verdict.peakId}`).toBeDefined();
          if (peak === undefined) continue;

          // Recompute the peak's angle from its own coordinate rather than
          // trusting the number recorded alongside it.
          const distanceM = greatCircleDistanceM(
            { lat: scene.observer.lat, lon: scene.observer.lon },
            peak,
          );
          const recomputedDeg = apparentAltitudeDeg(
            eyeElevationM(scene.observer),
            peak.elevationM,
            distanceM,
          );
          expect(recomputedDeg).toBeCloseTo(verdict.peakAltitudeDeg, 6);

          // `visible` must follow from the angles, never be asserted alongside
          // numbers that contradict it.
          const clearance = verdict.peakAltitudeDeg - verdict.skylineAltitudeDeg;
          expect(clearance).toBeCloseTo(verdict.clearanceDeg, 9);
          expect(verdict.visible).toBe(clearance >= 0);
          expect(verdict.reason.length).toBeGreaterThan(20);
        }
      });
    });
  }
});

describe('scene 1 — flat plane: the horizon dip is the geometric one', () => {
  it('matches the hand-derived tangent-line dip', () => {
    expect(FLAT_PLANE_EXPECTED_DIP_DEG).toBeCloseTo(
      HAND_DERIVED_DEG.flatPlaneDipExact,
      5,
    );
  });

  it('matches the hand-derived drop-model optimum, by a different derivation', () => {
    expect(FLAT_PLANE_EXPECTED_DIP_SMALL_ANGLE_DEG).toBeCloseTo(
      HAND_DERIVED_DEG.flatPlaneDipDropModel,
      5,
    );
  });

  it('reconciles the tangent construction and the calculus optimum to 1e-5 deg', () => {
    expect(
      Math.abs(FLAT_PLANE_EXPECTED_DIP_DEG - FLAT_PLANE_EXPECTED_DIP_SMALL_ANGLE_DEG),
    ).toBeLessThan(1e-5);
  });

  it('puts the horizon at 38.27 km by both routes', () => {
    expect(FLAT_PLANE_EXPECTED_HORIZON_DISTANCE_M / 1000).toBeCloseTo(38.27, 2);
    expect(FLAT_PLANE_EXPECTED_HORIZON_DISTANCE_SMALL_ANGLE_M / 1000).toBeCloseTo(38.27, 2);
    // Rule of thumb for k = 0.13: d(km) = 3.827 * sqrt(h(m)).
    expect(FLAT_PLANE_EXPECTED_HORIZON_DISTANCE_SMALL_ANGLE_M / 1000).toBeCloseTo(
      3.827 * Math.sqrt(100),
      2,
    );
  });

  it('is identical at every expected bearing (rotational symmetry)', () => {
    const altitudes = flatPlaneScene.expectedSkyline.map((p) => p.altitudeDeg);
    for (const altitudeDeg of altitudes) {
      expect(altitudeDeg).toBeCloseTo(FLAT_PLANE_EXPECTED_DIP_DEG, 12);
    }
    // One expectation deliberately sits between sampling rays, to exercise the
    // profile interpolation of P1.3 when it exists.
    expect(
      flatPlaneScene.expectedSkyline.some((p) => !Number.isInteger(p.bearingDeg)),
    ).toBe(true);
  });

  it('is recovered by brute force over the generated terrain, using no pipeline code', () => {
    const found = flatPlaneBruteForceSkyline();
    expect(found.altitudeDeg).toBeCloseTo(FLAT_PLANE_EXPECTED_DIP_DEG, 4);
    expect(
      Math.abs(found.distanceM - FLAT_PLANE_EXPECTED_HORIZON_DISTANCE_M),
    ).toBeLessThanOrEqual(flatPlaneScene.distanceToleranceM);
  });

  it('generates a perfectly flat terrain, so relief cannot be the answer', () => {
    const samples = flatPlaneScene.generateSamples();
    const elevations = new Set(samples.map((s) => s.elevationM));
    expect(elevations).toEqual(new Set([0]));
  });
});

describe('scene 2 — twin ridges: angle decides visibility, not height', () => {
  const observerPoint = {
    lat: twinRidgesFarVisibleScene.observer.lat,
    lon: twinRidgesFarVisibleScene.observer.lon,
  };
  const eyeM = eyeElevationM(twinRidgesFarVisibleScene.observer);

  it('puts the observer eye at exactly 500 m, as the hand arithmetic assumes', () => {
    expect(eyeM).toBeCloseTo(500, 9);
  });

  it('matches the hand-derived near-ridge angle', () => {
    expect(
      apparentAltitudeDegPlaneDrop(eyeM, NEAR_RIDGE_CREST_M, NEAR_RIDGE_DISTANCE_M),
    ).toBeCloseTo(HAND_DERIVED_DEG.nearRidge, 5);
  });

  it('matches the hand-derived far-ridge angles in both variants', () => {
    expect(
      apparentAltitudeDegPlaneDrop(eyeM, FAR_RIDGE_CREST_VISIBLE_M, FAR_RIDGE_DISTANCE_M),
    ).toBeCloseTo(HAND_DERIVED_DEG.farRidgeVisibleVariant, 5);
    expect(
      apparentAltitudeDegPlaneDrop(eyeM, FAR_RIDGE_CREST_HIDDEN_M, FAR_RIDGE_DISTANCE_M),
    ).toBeCloseTo(HAND_DERIVED_DEG.farRidgeHiddenVariant, 5);
  });

  it('variant A: the far ridge wins the skyline by 0.79 deg', () => {
    const nearDeg = apparentAltitudeDeg(eyeM, NEAR_RIDGE_CREST_M, NEAR_RIDGE_DISTANCE_M);
    const farDeg = apparentAltitudeDeg(eyeM, FAR_RIDGE_CREST_VISIBLE_M, FAR_RIDGE_DISTANCE_M);
    expect(farDeg).toBeGreaterThan(nearDeg);
    expect(farDeg - nearDeg).toBeCloseTo(0.7936, 3);

    const [skyline] = twinRidgesFarVisibleScene.expectedSkyline;
    expect(skyline).toBeDefined();
    expect(skyline?.altitudeDeg).toBeCloseTo(farDeg, 9);
    expect(skyline?.distanceM).toBe(FAR_RIDGE_DISTANCE_M);
  });

  it('variant B: the far ridge is 1100 m HIGHER and still loses by 0.34 deg', () => {
    const nearDeg = apparentAltitudeDeg(eyeM, NEAR_RIDGE_CREST_M, NEAR_RIDGE_DISTANCE_M);
    const farDeg = apparentAltitudeDeg(eyeM, FAR_RIDGE_CREST_HIDDEN_M, FAR_RIDGE_DISTANCE_M);

    expect(FAR_RIDGE_CREST_HIDDEN_M - NEAR_RIDGE_CREST_M).toBe(1100);
    expect(farDeg).toBeLessThan(nearDeg);
    expect(nearDeg - farDeg).toBeCloseTo(0.3437, 3);

    const [skyline] = twinRidgesFarHiddenScene.expectedSkyline;
    expect(skyline).toBeDefined();
    expect(skyline?.altitudeDeg).toBeCloseTo(nearDeg, 9);
    expect(skyline?.distanceM).toBe(NEAR_RIDGE_DISTANCE_M);
  });

  it('states the occlusion verdicts the two variants exist to test', () => {
    const visibleVerdict = twinRidgesFarVisibleScene.expectedPeakVerdicts.find((v) =>
      v.peakId.endsWith('/far-crest'),
    );
    const hiddenVerdict = twinRidgesFarHiddenScene.expectedPeakVerdicts.find((v) =>
      v.peakId.endsWith('/far-crest'),
    );
    expect(visibleVerdict?.visible).toBe(true);
    expect(hiddenVerdict?.visible).toBe(false);
  });

  it('does NOT assert the near crest in variant A — the known P1.5 limitation', () => {
    // Documented in twin-ridges.ts: a peak in FRONT of a taller backdrop is
    // physically visible but fails the simplified "clears the skyline" rule.
    // Ground truth must not bless that simplification by asserting it.
    const nearVerdict = twinRidgesFarVisibleScene.expectedPeakVerdicts.find((v) =>
      v.peakId.endsWith('/near-crest'),
    );
    expect(nearVerdict).toBeUndefined();
  });

  it('generates terrain containing both crests at the assumed ranges', () => {
    for (const [scene, farCrestM] of [
      [twinRidgesFarVisibleScene, FAR_RIDGE_CREST_VISIBLE_M],
      [twinRidgesFarHiddenScene, FAR_RIDGE_CREST_HIDDEN_M],
    ] as const) {
      const samples = scene.generateSamples();
      const maxElevationM = samples.reduce((best, s) => Math.max(best, s.elevationM), 0);
      expect(maxElevationM).toBeCloseTo(Math.max(NEAR_RIDGE_CREST_M, farCrestM), 6);

      const crest = destinationPoint(
        observerPoint,
        TWIN_RIDGES_PRIMARY_BEARING_DEG,
        NEAR_RIDGE_DISTANCE_M,
      );
      expect(scene.elevationAtM(crest)).toBeCloseTo(NEAR_RIDGE_CREST_M, 6);
    }
  });

  it('keeps the plain below the eye, so only a ridge can ever be the skyline', () => {
    // Samples ON the plain, i.e. off both ridges. Flank samples sit between the
    // plain and a crest and are legitimately above the eye — they are part of
    // the ridge, not part of the plain.
    const samples = twinRidgesFarVisibleScene.generateSamples();
    const plainSamples = samples.filter(
      (s) => Math.abs(s.elevationM - TWIN_RIDGES_PLAIN_ELEVATION_M) < 1e-9,
    );
    expect(plainSamples.length).toBeGreaterThan(1000);
    for (const sample of plainSamples) {
      expect(sample.elevationM).toBeLessThan(eyeM);
    }

    // The stronger statement: every point of the plain subtends a NEGATIVE
    // angle, so no amount of plain can compete with either crest.
    for (
      let distanceM = twinRidgesFarVisibleScene.sampling.rangeStepM;
      distanceM <= twinRidgesFarVisibleScene.sampling.maxRangeM;
      distanceM += twinRidgesFarVisibleScene.sampling.rangeStepM
    ) {
      expect(
        apparentAltitudeDeg(eyeM, TWIN_RIDGES_PLAIN_ELEVATION_M, distanceM),
      ).toBeLessThan(0);
    }
  });
});

describe('scene 3 — conical peak: the apex angle is closed form', () => {
  const eyeM = eyeElevationM(conicalPeakScene.observer);

  it('matches the hand-derived apex angle', () => {
    expect(
      apparentAltitudeDegPlaneDrop(eyeM, CONE_APEX_ELEVATION_M, CONE_APEX_DISTANCE_M),
    ).toBeCloseTo(HAND_DERIVED_DEG.coneApex, 5);
  });

  it('matches the hand-derived bare-plain dip 135 deg away', () => {
    const plainExpectation = conicalPeakScene.expectedSkyline.find(
      (p) => p.bearingDeg === CONE_PLAIN_BEARING_DEG,
    );
    expect(plainExpectation).toBeDefined();
    expect(plainExpectation?.altitudeDegPlaneDrop).toBeCloseTo(
      HAND_DERIVED_DEG.conePlainDip,
      5,
    );
  });

  it('keeps the flank steeper than the sightline, so the apex is the maximum', () => {
    const apexExpectation = conicalPeakScene.expectedSkyline.find(
      (p) => p.bearingDeg === CONE_APEX_BEARING_DEG,
    );
    expect(apexExpectation).toBeDefined();
    const tanAlpha = Math.tan(((apexExpectation?.altitudeDeg ?? 0) * Math.PI) / 180);
    expect(tanAlpha).toBeLessThan(0.5); // flank slope = 1500/3000
  });

  it('is recovered by brute force along the apex ray, using no pipeline code', () => {
    const found = conicalPeakBruteForceRayMaximum(CONE_APEX_BEARING_DEG);
    expect(found.distanceM).toBe(CONE_APEX_DISTANCE_M);
    expect(found.elevationM).toBeCloseTo(CONE_APEX_ELEVATION_M, 6);
    const apexExpectation = conicalPeakScene.expectedSkyline.find(
      (p) => p.bearingDeg === CONE_APEX_BEARING_DEG,
    );
    expect(found.altitudeDeg).toBeCloseTo(apexExpectation?.altitudeDeg ?? NaN, 9);
  });

  it('falls back to the bare-plain horizon away from the cone', () => {
    const found = conicalPeakBruteForceRayMaximum(CONE_PLAIN_BEARING_DEG);
    expect(found.elevationM).toBe(0);
    const plainExpectation = conicalPeakScene.expectedSkyline.find(
      (p) => p.bearingDeg === CONE_PLAIN_BEARING_DEG,
    );
    expect(found.altitudeDeg).toBeCloseTo(plainExpectation?.altitudeDeg ?? NaN, 4);
    expect(
      Math.abs(found.distanceM - (plainExpectation?.distanceM ?? 0)),
    ).toBeLessThanOrEqual(conicalPeakScene.distanceToleranceM);
  });

  it('separates the two expectations by three orders of magnitude in angle', () => {
    // 8.48 deg against -0.042 deg in one scene: a pipeline cannot fudge a
    // constant that satisfies both.
    const [apex, plain] = conicalPeakScene.expectedSkyline;
    expect(apex).toBeDefined();
    expect(plain).toBeDefined();
    expect((apex?.altitudeDeg ?? 0) / Math.abs(plain?.altitudeDeg ?? 1)).toBeGreaterThan(150);
  });
});

describe('the scene set collectively covers the failure modes it is meant to', () => {
  const scenes: readonly SyntheticScene[] = analyticScenes;

  it('includes at least one scene whose skyline is below horizontal', () => {
    expect(
      scenes.some((s) => s.expectedSkyline.some((p) => p.altitudeDeg < 0)),
    ).toBe(true);
  });

  it('includes at least one scene whose skyline is well above horizontal', () => {
    expect(
      scenes.some((s) => s.expectedSkyline.some((p) => p.altitudeDeg > 5)),
    ).toBe(true);
  });

  it('includes a provably hidden peak and a provably visible one', () => {
    const verdicts = scenes.flatMap((s) => s.expectedPeakVerdicts);
    expect(verdicts.some((v) => v.visible)).toBe(true);
    expect(verdicts.some((v) => !v.visible)).toBe(true);
  });
});
