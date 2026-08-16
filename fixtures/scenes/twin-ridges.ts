/**
 * SCENE 2 — TWIN RIDGES  (PLAN.md P6.1 "two ridges", P1.2 / P1.5 occlusion)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The single most important thing this project has to get right is that a
 * distant peak can be HIGHER and still be HIDDEN, because a nearer, lower ridge
 * subtends a bigger angle. Height does not decide visibility; angle does. This
 * scene reduces that to two numbers you can compare on paper.
 *
 * Two ridges, both crossing the line of sight:
 *
 *     near ridge   crest  5 km away,   900 m
 *     far ridge    crest 20 km away,  2400 m  (variant A)  or  2000 m (variant B)
 *
 * Observer eye at exactly 500 m above sea level (ground 498.4 m + eye 1.6 m, so
 * the eye height is realistic AND the arithmetic below is clean).
 *
 * Between and beyond the ridges the terrain is a plain at the observer's own
 * ground elevation, 498.4 m — 1.6 m below the eye, hence always at a negative
 * angle and never a candidate for the skyline.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THE RIDGES ARE CONCENTRIC RINGS
 * ───────────────────────────────────────────────────────────────────────────
 * Each ridge is a circular ring centred on the observer, so the terrain depends
 * only on ground distance. That makes the analysis exact at EVERY bearing and
 * removes end effects — a finite straight ridge would have ends whose angles
 * are messy, and any disagreement there would be an artefact of the fixture
 * rather than a fact about the pipeline. "Along one bearing" is satisfied at
 * all 360 of them, and the extra symmetry gives P1.3's profile builder a strong
 * additional constraint: the profile must be flat in bearing.
 *
 * Ridge cross-section is triangular: the elevation rises linearly from the
 * plain to the crest over a half-width w, and falls the same way beyond.
 *
 *     ridge(d) = (crest − plain) · max(0, 1 − |d − d_crest| / w)
 *     terrain(d) = plain + max over both ridges of ridge(d)
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THE CREST IS THE MAXIMUM ANGLE ALONG THE RAY
 * ───────────────────────────────────────────────────────────────────────────
 * Along a ray, α(s) ≈ (E(s) − H_o)/s − s/(2R_eff). Differentiating,
 *
 *     dα/ds = E'(s)/s − (E(s) − H_o)/s² − 1/(2R_eff)
 *
 * On the near flank of a ridge this is positive — so α keeps climbing right up
 * to the crest — provided the flank is steeper than the sightline:
 *
 *     E'(s) > (E(s) − H_o)/s ≈ tan α
 *
 *   near ridge:  slope = 400 m / 1000 m = 0.400  vs  tan α ≈ 0.0797   ✓ 5.0×
 *   far ridge A: slope = 1900 m / 2000 m = 0.950 vs  tan α ≈ 0.0936   ✓ 10.1×
 *   far ridge B: slope = 1500 m / 2000 m = 0.750 vs  tan α ≈ 0.0736   ✓ 10.2×
 *
 * Past the crest E'(s) < 0 and α falls away. So the skyline candidate on each
 * ridge is its crest, and only its crest. No hidden fourth answer.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * DERIVATION — THE TWO ANGLES, BY HAND
 * ───────────────────────────────────────────────────────────────────────────
 * THIS SCENE ASSUMES: R = 6 371 008.8 m (IUGG mean radius) and k = 0.13.
 * The constant is never copied in as a decimal — scene-geometry.ts evaluates
 *
 *     R_eff = R / (1 − k) = 6 371 008.8 / 0.87 = 7 322 998.6207 m
 *
 * If src/core ever adopts a different R or k, the expectations below move and
 * this line is where a reviewer finds out. Curvature drop c = d²/(2 R_eff).
 *
 * ── NEAR RIDGE  (d = 5 000 m, E = 900 m, H_o = 500 m) ───────────────────────
 *     c₁ = 5 000² / (2 × 7 322 998.6207)
 *        = 25 000 000 / 14 645 997.2414
 *        = 1.70695 m
 *     apparent rise = 900 − 500 − 1.70695 = 398.29305 m
 *     tan α₁ = 398.29305 / 5 000 = 0.07965861
 *     α₁ = atan(0.07965861)
 *        = 0.07965861 − 0.07965861³/3 + 0.07965861⁵/5 − …
 *        = 0.07965861 − 0.00016849 + 0.00000064
 *        = 0.07949076 rad
 *        = 0.07949076 × 57.29577951
 *        = 4.554485°
 *
 * ── FAR RIDGE, VARIANT A  (d = 20 000 m, E = 2 400 m) ───────────────────────
 *     c₂ = 20 000² / 14 645 997.2414
 *        = 400 000 000 / 14 645 997.2414
 *        = 27.31122 m
 *     apparent rise = 2 400 − 500 − 27.31122 = 1 872.68878 m
 *     tan α₂ = 1 872.68878 / 20 000 = 0.09363444
 *     α₂ = 0.09363444 − 0.00027364 + 0.00000144 − 0.00000001
 *        = 0.09336223 rad
 *        = 5.349262°
 *
 *     α₂ (5.349262°) > α₁ (4.554485°)  by 0.794777°
 *     ⇒ THE FAR RIDGE FORMS THE SKYLINE. A peak on its crest is VISIBLE.
 *
 * ── FAR RIDGE, VARIANT B  (d = 20 000 m, E = 2 000 m) ───────────────────────
 *     c₂ unchanged = 27.31122 m
 *     apparent rise = 2 000 − 500 − 27.31122 = 1 472.68878 m
 *     tan α₂ = 1 472.68878 / 20 000 = 0.07363444
 *     α₂ = 0.07363444 − 0.00013308 + 0.00000043
 *        = 0.07350179 rad
 *        = 4.211342°
 *
 *     α₂ (4.211342°) < α₁ (4.554485°)  by 0.343143°
 *     ⇒ THE NEAR RIDGE FORMS THE SKYLINE. A peak on the far crest is HIDDEN,
 *       even though that crest stands 1 100 m HIGHER than the ridge hiding it.
 *
 * Both margins (0.79° and 0.34°) are 30–80× PLAN.md's 0.01° tolerance, so the
 * verdicts cannot flip on a modelling detail — only on a genuine mistake.
 *
 * The exact sphere model (`apparentAltitudeDeg`) gives 4.553926 / 5.347500 /
 * 4.210181, i.e. within 0.002° of the hand figures above. The verdicts are
 * identical under either model, which is the point of quoting both.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * A CAVEAT WORTH READING BEFORE ASSERTING ANYTHING ELSE
 * ───────────────────────────────────────────────────────────────────────────
 * In variant A the near crest sits BELOW the skyline (4.554° < 5.349°) but is
 * still physically in plain sight: it is in FRONT of the far ridge, and nothing
 * closer than it blocks it. The naive visibility rule in PLAN.md P1.5 —
 * "visible iff the peak's angle clears the skyline at its bearing" — would call
 * it hidden, which is wrong in the real world.
 *
 * This fixture therefore does NOT assert a verdict for the near crest in
 * variant A; it records it as an acknowledged limitation instead. Ground truth
 * must not quietly bless a known simplification. If P1.5 is later upgraded to
 * compare a peak only against terrain NEARER than the peak, the near crest
 * becomes an unambiguous must-see and should be promoted to a verdict then.
 */

import type { ElevationSample, LatLng, Observer, Peak } from '../../src/core/types';
import {
  apparentAltitudeDeg,
  apparentAltitudeDegPlaneDrop,
  destinationPoint,
  greatCircleDistanceM,
} from './scene-geometry';
import {
  eyeElevationM,
  generateRadialSamples,
  type ExpectedPeakVerdict,
  type ExpectedSkylinePoint,
  type SceneSampling,
  type SyntheticScene,
} from './scene';

/** Elevation of the plain the observer stands on. */
export const PLAIN_ELEVATION_M = 498.4;

/** Ground distance to the near ridge crest. */
export const NEAR_RIDGE_DISTANCE_M = 5_000;
/** Crest elevation of the near ridge. */
export const NEAR_RIDGE_CREST_M = 900;
/** Half-width of the near ridge in the range direction. */
export const NEAR_RIDGE_HALF_WIDTH_M = 1_000;

/** Ground distance to the far ridge crest, in both variants. */
export const FAR_RIDGE_DISTANCE_M = 20_000;
/** Half-width of the far ridge in the range direction. */
export const FAR_RIDGE_HALF_WIDTH_M = 2_000;

/** Far crest in the variant where the far ridge wins the skyline. */
export const FAR_RIDGE_CREST_VISIBLE_M = 2_400;
/** Far crest in the variant where the near ridge hides it. */
export const FAR_RIDGE_CREST_HIDDEN_M = 2_000;

const OBSERVER: Observer = {
  lat: 47,
  lon: 11,
  groundElevationM: PLAIN_ELEVATION_M,
  // 1.6 m is PLAN/types.ts's stated handheld camera height, and it makes the
  // eye land on exactly 500.0 m.
  eyeHeightM: 1.6,
};

const EYE_ELEVATION_M = eyeElevationM(OBSERVER); // 498.4 + 1.6 = 500.0 exactly

const SAMPLING: SceneSampling = {
  bearingStepDeg: 1,
  // 250 m divides both 5 000 m and 20 000 m exactly, so both crests are
  // sampled dead-on and no interpolation stands between the fixture and the
  // closed form.
  rangeStepM: 250,
  maxRangeM: 40_000,
};

/** Bearing along which the peaks are placed and the expectations are stated. */
export const PRIMARY_BEARING_DEG = 90;

function triangularRidge(
  distanceM: number,
  crestDistanceM: number,
  crestElevationM: number,
  halfWidthM: number,
): number {
  const shoulder = 1 - Math.abs(distanceM - crestDistanceM) / halfWidthM;
  if (shoulder <= 0) return 0;
  return (crestElevationM - PLAIN_ELEVATION_M) * shoulder;
}

interface TwinRidgeVariant {
  id: string;
  title: string;
  farRidgeCrestM: number;
  farRidgeWins: boolean;
}

function buildVariant(variant: TwinRidgeVariant): SyntheticScene {
  const { farRidgeCrestM, farRidgeWins } = variant;
  const observerPoint: LatLng = { lat: OBSERVER.lat, lon: OBSERVER.lon };

  const elevationAtM = (point: LatLng): number => {
    const distanceM = greatCircleDistanceM(observerPoint, point);
    return (
      PLAIN_ELEVATION_M +
      Math.max(
        triangularRidge(
          distanceM,
          NEAR_RIDGE_DISTANCE_M,
          NEAR_RIDGE_CREST_M,
          NEAR_RIDGE_HALF_WIDTH_M,
        ),
        triangularRidge(
          distanceM,
          FAR_RIDGE_DISTANCE_M,
          farRidgeCrestM,
          FAR_RIDGE_HALF_WIDTH_M,
        ),
      )
    );
  };

  const nearAltitudeDeg = apparentAltitudeDeg(
    EYE_ELEVATION_M,
    NEAR_RIDGE_CREST_M,
    NEAR_RIDGE_DISTANCE_M,
  );
  const farAltitudeDeg = apparentAltitudeDeg(
    EYE_ELEVATION_M,
    farRidgeCrestM,
    FAR_RIDGE_DISTANCE_M,
  );

  const skylineIsFar = farAltitudeDeg > nearAltitudeDeg;
  const skylineAltitudeDeg = skylineIsFar ? farAltitudeDeg : nearAltitudeDeg;
  const skylineDistanceM = skylineIsFar ? FAR_RIDGE_DISTANCE_M : NEAR_RIDGE_DISTANCE_M;
  const skylineElevationM = skylineIsFar ? farRidgeCrestM : NEAR_RIDGE_CREST_M;

  // The scene declares which ridge wins in its own definition; if the closed
  // form ever disagrees with that declaration the fixture is inconsistent and
  // the acceptance suite says so rather than silently following the maths.
  const expectedSkyline: readonly ExpectedSkylinePoint[] = [
    {
      bearingDeg: PRIMARY_BEARING_DEG,
      altitudeDeg: skylineAltitudeDeg,
      altitudeDegPlaneDrop: apparentAltitudeDegPlaneDrop(
        EYE_ELEVATION_M,
        skylineElevationM,
        skylineDistanceM,
      ),
      distanceM: skylineDistanceM,
      elevationM: skylineElevationM,
      note: skylineIsFar
        ? 'Far ridge subtends the larger angle and forms the skyline.'
        : 'Near ridge subtends the larger angle; the taller far ridge is behind it.',
    },
    {
      // Rotational symmetry: the same answer must come out 180° away.
      bearingDeg: (PRIMARY_BEARING_DEG + 180) % 360,
      altitudeDeg: skylineAltitudeDeg,
      altitudeDegPlaneDrop: apparentAltitudeDegPlaneDrop(
        EYE_ELEVATION_M,
        skylineElevationM,
        skylineDistanceM,
      ),
      distanceM: skylineDistanceM,
      elevationM: skylineElevationM,
      note: 'Ridges are concentric rings, so the skyline is bearing-invariant.',
    },
  ];

  const nearCrestPoint = destinationPoint(
    observerPoint,
    PRIMARY_BEARING_DEG,
    NEAR_RIDGE_DISTANCE_M,
  );
  const farCrestPoint = destinationPoint(
    observerPoint,
    PRIMARY_BEARING_DEG,
    FAR_RIDGE_DISTANCE_M,
  );

  const nearPeakId = `${variant.id}/near-crest`;
  const farPeakId = `${variant.id}/far-crest`;

  const peaks: readonly Peak[] = [
    {
      id: nearPeakId,
      name: 'Near Crest',
      lat: nearCrestPoint.lat,
      lon: nearCrestPoint.lon,
      elevationM: NEAR_RIDGE_CREST_M,
      elevationSource: 'srtm',
    },
    {
      id: farPeakId,
      name: 'Far Crest',
      lat: farCrestPoint.lat,
      lon: farCrestPoint.lon,
      elevationM: farRidgeCrestM,
      elevationSource: 'srtm',
    },
  ];

  const expectedPeakVerdicts: ExpectedPeakVerdict[] = [
    {
      peakId: farPeakId,
      visible: farRidgeWins,
      peakAltitudeDeg: farAltitudeDeg,
      skylineAltitudeDeg: farRidgeWins ? farAltitudeDeg : nearAltitudeDeg,
      clearanceDeg: farAltitudeDeg - (farRidgeWins ? farAltitudeDeg : nearAltitudeDeg),
      reason: farRidgeWins
        ? 'Far crest angle exceeds the near ridge angle by 0.79 deg, so it clears it.'
        : 'Far crest stands 1100 m higher than the near ridge yet falls 0.34 deg ' +
          'short of it in angle, so the near ridge hides it. This is the case ' +
          'that a height-only visibility test gets wrong.',
    },
  ];

  if (!farRidgeWins) {
    // Only assert the near crest when it is itself the skyline. In the other
    // variant it sits in front of a taller backdrop, where PLAN.md P1.5's
    // simplified rule and physical reality disagree (see header caveat).
    expectedPeakVerdicts.push({
      peakId: nearPeakId,
      visible: true,
      peakAltitudeDeg: nearAltitudeDeg,
      skylineAltitudeDeg: nearAltitudeDeg,
      clearanceDeg: 0,
      reason: 'The near crest IS the skyline here, so it is visible by construction.',
    });
  }

  return {
    id: variant.id,
    title: variant.title,
    derivation:
      `Near ridge: 900 m at 5 km -> ${nearAltitudeDeg.toFixed(6)} deg. ` +
      `Far ridge: ${farRidgeCrestM} m at 20 km -> ${farAltitudeDeg.toFixed(6)} deg. ` +
      `Larger angle wins the skyline, so the ${skylineIsFar ? 'far' : 'near'} ridge does. ` +
      'Both angles are atan((E - H_o - d^2/(2 R_eff)) / d) with H_o = 500 m.',
    observer: OBSERVER,
    sampling: SAMPLING,
    elevationAtM,
    generateSamples(): ElevationSample[] {
      return generateRadialSamples(OBSERVER, SAMPLING, elevationAtM);
    },
    expectedSkyline,
    peaks,
    expectedPeakVerdicts,
    toleranceDeg: 0.01,
    distanceToleranceM: SAMPLING.rangeStepM,
  };
}

/** Variant A — the far, higher ridge wins the skyline and is visible. */
export const twinRidgesFarVisibleScene: SyntheticScene = buildVariant({
  id: 'twin-ridges-far-visible',
  title: 'Twin ridges: far 2400 m ridge clears the near 900 m ridge',
  farRidgeCrestM: FAR_RIDGE_CREST_VISIBLE_M,
  farRidgeWins: true,
});

/** Variant B — the far, higher ridge is hidden behind the near, lower one. */
export const twinRidgesFarHiddenScene: SyntheticScene = buildVariant({
  id: 'twin-ridges-far-hidden',
  title: 'Twin ridges: far 2000 m ridge hidden behind the near 900 m ridge',
  farRidgeCrestM: FAR_RIDGE_CREST_HIDDEN_M,
  farRidgeWins: false,
});
