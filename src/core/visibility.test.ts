import { describe, expect, it } from 'vitest';

import { destinationPoint } from './geodesy';
import {
  buildHorizonProfile,
  interpolateHorizonAltitudeDeg,
  normaliseHorizonProfile,
} from './horizon';
import type { BearingRay } from './horizon';
import { altitudeAngleDeg, sightPeak } from './sightline';
import type { RaySample } from './sightline';
import {
  filterVisiblePeaks,
  isPeakVisible,
  resolveAgainstHorizon,
  NO_NEARER_TERRAIN_ALTITUDE_DEG,
} from './visibility';
import type { HorizonPoint, HorizonProfile, Observer, Peak, PeakSighting } from './types';

function horizonPoint(bearingDeg: number, altitudeDeg: number): HorizonPoint {
  return { bearingDeg, altitudeDeg, distanceKm: 5, elevationM: 500 };
}

function sighting(
  name: string,
  bearingDeg: number,
  altitudeDeg: number,
  distanceKm = 20,
): PeakSighting {
  return {
    id: `node/${name}`,
    name,
    lat: 0,
    lon: 0,
    elevationM: 1000,
    elevationSource: 'osm',
    bearingDeg,
    altitudeDeg,
    distanceKm,
  };
}

describe('resolveAgainstHorizon', () => {
  /**
   * A skyline with a high ridge to the east and a low one to the west:
   *
   *   bearing:   0°   90°  180°  270°
   *   skyline:  +3°   +6°   +3°   +1°
   *
   * Round numbers, so every clearance below is exact integer arithmetic.
   */
  const profile = normaliseHorizonProfile([
    horizonPoint(0, 3),
    horizonPoint(90, 6),
    horizonPoint(180, 3),
    horizonPoint(270, 1),
  ]);

  it('records the skyline angle and the clearance for a peak that clears it', () => {
    const resolved = resolveAgainstHorizon(sighting('Exposed', 270, 4), profile);
    expect(resolved.horizonAltitudeDeg).toBe(1);
    expect(resolved.clearanceDeg).toBe(3);
  });

  it('records a negative clearance for a peak the ridge hides', () => {
    const resolved = resolveAgainstHorizon(sighting('Hidden', 90, 4), profile);
    expect(resolved.horizonAltitudeDeg).toBe(6);
    expect(resolved.clearanceDeg).toBe(-2);
  });

  it('uses the interpolated skyline between samples', () => {
    // 45° is midway 0°(+3) → 90°(+6), so the skyline there is +4.5°.
    const resolved = resolveAgainstHorizon(sighting('Between', 45, 5), profile);
    expect(resolved.horizonAltitudeDeg).toBeCloseTo(4.5, 12);
    expect(resolved.clearanceDeg).toBeCloseTo(0.5, 12);
  });

  it('carries the sighting through unchanged', () => {
    const source = sighting('Monte Test', 270, 4, 12.5);
    const resolved = resolveAgainstHorizon(source, profile);
    expect(resolved.id).toBe('node/Monte Test');
    expect(resolved.name).toBe('Monte Test');
    expect(resolved.altitudeDeg).toBe(4);
    expect(resolved.bearingDeg).toBe(270);
    expect(resolved.distanceKm).toBe(12.5);
    expect(resolved.elevationSource).toBe('osm');
  });

  it('refuses to guess when there is no profile', () => {
    expect(() => resolveAgainstHorizon(sighting('Nowhere', 0, 4), [])).toThrow(RangeError);
  });
});

describe('isPeakVisible — tolerance', () => {
  const profile = normaliseHorizonProfile([horizonPoint(0, 3), horizonPoint(180, 3)]);

  it('treats an exact graze as visible at zero tolerance', () => {
    const resolved = resolveAgainstHorizon(sighting('Graze', 0, 3), profile);
    expect(resolved.clearanceDeg).toBe(0);
    expect(isPeakVisible(resolved, 0)).toBe(true);
  });

  it('rejects a peak below the skyline unless the tolerance covers the shortfall', () => {
    // Half a degree short of the ridge (3 − 2.5, both exactly representable,
    // so the boundary comparisons below are exact rather than epsilon-fudged).
    const resolved = resolveAgainstHorizon(sighting('Marginal', 0, 2.5), profile);
    expect(resolved.clearanceDeg).toBe(-0.5);
    expect(isPeakVisible(resolved, 0)).toBe(false);
    expect(isPeakVisible(resolved, 0.25)).toBe(false);
    expect(isPeakVisible(resolved, 0.5)).toBe(true);
    expect(isPeakVisible(resolved, 2)).toBe(true);
  });

  it('rejects a negative tolerance', () => {
    const resolved = resolveAgainstHorizon(sighting('Any', 0, 4), profile);
    expect(() => isPeakVisible(resolved, -0.1)).toThrow(RangeError);
    expect(() => filterVisiblePeaks([], profile, { toleranceDeg: -0.1 })).toThrow(RangeError);
  });
});

describe('filterVisiblePeaks', () => {
  const profile = normaliseHorizonProfile([
    horizonPoint(0, 3),
    horizonPoint(90, 6),
    horizonPoint(180, 3),
    horizonPoint(270, 1),
  ]);

  it('keeps exactly the peaks that clear their own bearing', () => {
    const visible = filterVisiblePeaks(
      [sighting('Hidden', 90, 4), sighting('Exposed', 270, 4)],
      profile,
    );
    expect(visible.map((peak) => peak.name)).toEqual(['Exposed']);
  });

  it('preserves the caller ordering', () => {
    const visible = filterVisiblePeaks(
      [
        sighting('Third', 270, 9),
        sighting('First', 270, 2),
        sighting('Blocked', 90, 4),
        sighting('Second', 0, 5),
      ],
      profile,
    );
    expect(visible.map((peak) => peak.name)).toEqual(['Third', 'First', 'Second']);
  });

  it('returns nothing when nothing clears', () => {
    expect(filterVisiblePeaks([sighting('Buried', 90, 1)], profile)).toEqual([]);
    expect(filterVisiblePeaks([], profile)).toEqual([]);
  });
});

describe('synthetic scene — one exposed peak, one ridge-hidden peak', () => {
  /**
   * Sea-level plain, observer eye 1.6 m above it at 46°N 8°E.
   *
   * Terrain: a 5 km-distant wall, 500 m high in the eastern sector
   * (bearings 60°–120°) and only 50 m high everywhere else.
   *
   *   east skyline: atan2(500 − 1.6 − 1.70695, 5000) = 5.6730710°
   *   west skyline: atan2( 50 − 1.6 − 1.70695, 5000) = 0.5350474°
   *
   * Two identical 1000 m summits are placed 20 km out, one due east and one
   * due west. Both subtend
   *
   *   atan2(1000 − 1.6 − 27.31122, 20000) = 2.7797813°
   *
   * so the east one is buried by 2.89° and the west one clears by 2.24°.
   * The comparison is decided by the near wall, not by the summits, which is
   * exactly the failure mode a naive "is it tall enough?" filter gets wrong.
   */
  const observer: Observer = { lat: 46, lon: 8, groundElevationM: 0, eyeHeightM: 1.6 };
  const EAST_SKYLINE_DEG = 5.6730710;
  const WEST_SKYLINE_DEG = 0.5350474;
  const SUMMIT_ALTITUDE_DEG = 2.7797813;

  function wallHeightM(bearingDeg: number): number {
    return bearingDeg >= 60 && bearingDeg <= 120 ? 500 : 50;
  }

  const rays: BearingRay[] = [];
  for (let bearingDeg = 0; bearingDeg < 360; bearingDeg += 10) {
    const samples: RaySample[] = [
      { distanceM: 1_000, elevationM: 0 },
      { distanceM: 2_000, elevationM: 0 },
      { distanceM: 5_000, elevationM: wallHeightM(bearingDeg) },
      { distanceM: 10_000, elevationM: 0 },
      { distanceM: 20_000, elevationM: 0 },
    ];
    rays.push({ bearingDeg, samples });
  }

  const profile = buildHorizonProfile(
    observer.groundElevationM + observer.eyeHeightM,
    rays,
  );

  function summit(name: string, bearingDeg: number): Peak {
    return {
      ...destinationPoint(observer, bearingDeg, 20_000),
      id: `node/${name}`,
      name,
      elevationM: 1000,
      elevationSource: 'srtm',
    };
  }

  const hidden = sightPeak(observer, summit('Hidden Peak', 90));
  const exposed = sightPeak(observer, summit('Exposed Peak', 270));

  it('builds a 36-point profile with the expected east and west skylines', () => {
    expect(profile).toHaveLength(36);
    const east = profile.find((entry) => entry.bearingDeg === 90);
    const west = profile.find((entry) => entry.bearingDeg === 270);
    expect(east?.altitudeDeg).toBeCloseTo(EAST_SKYLINE_DEG, 5);
    expect(east?.elevationM).toBe(500);
    expect(east?.distanceKm).toBe(5);
    expect(west?.altitudeDeg).toBeCloseTo(WEST_SKYLINE_DEG, 5);
    expect(west?.elevationM).toBe(50);
  });

  it('sights both summits at the same angle', () => {
    expect(hidden.altitudeDeg).toBeCloseTo(SUMMIT_ALTITUDE_DEG, 5);
    expect(exposed.altitudeDeg).toBeCloseTo(SUMMIT_ALTITUDE_DEG, 5);
    expect(hidden.bearingDeg).toBeCloseTo(90, 6);
    expect(exposed.bearingDeg).toBeCloseTo(270, 6);
  });

  it('keeps exactly the exposed summit', () => {
    const visible = filterVisiblePeaks([hidden, exposed], profile);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.name).toBe('Exposed Peak');
    expect(visible[0]?.horizonAltitudeDeg).toBeCloseTo(WEST_SKYLINE_DEG, 5);
    expect(visible[0]?.clearanceDeg).toBeCloseTo(SUMMIT_ALTITUDE_DEG - WEST_SKYLINE_DEG, 5);
  });

  it('explains the hidden summit with a negative clearance of ~2.89°', () => {
    const resolved = resolveAgainstHorizon(hidden, profile);
    expect(resolved.horizonAltitudeDeg).toBeCloseTo(EAST_SKYLINE_DEG, 5);
    expect(resolved.clearanceDeg).toBeCloseTo(SUMMIT_ALTITUDE_DEG - EAST_SKYLINE_DEG, 5);
    expect(resolved.clearanceDeg).toBeLessThan(0);
  });

  it('still hides the eastern summit under a generous 1° tolerance', () => {
    // The shortfall is 2.89°, so no plausible error budget rescues it.
    const visible = filterVisiblePeaks([hidden, exposed], profile, { toleranceDeg: 1 });
    expect(visible.map((peak) => peak.name)).toEqual(['Exposed Peak']);
  });

  it('would show the eastern summit if the wall were removed', () => {
    // Control: flatten the eastern wall to 50 m and the same summit appears.
    const flatRays = rays.map((ray) => ({
      bearingDeg: ray.bearingDeg,
      samples: ray.samples.map((sample) =>
        sample.distanceM === 5_000 ? { distanceM: 5_000, elevationM: 50 } : sample,
      ),
    }));
    const flatProfile = buildHorizonProfile(
      observer.groundElevationM + observer.eyeHeightM,
      flatRays,
    );
    const visible = filterVisiblePeaks([hidden, exposed], flatProfile);
    expect(visible.map((peak) => peak.name)).toEqual(['Hidden Peak', 'Exposed Peak']);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ONLY NEARER TERRAIN OCCLUDES  (the P1.5 correctness fix)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is Group F's twin-ridges scene (fixtures/scenes/twin-ridges.ts) rebuilt
 * as bearing rays, because it is the scene that exposed the bug.
 *
 *   observer eye  500.0 m above sea level (ground 498.4 m + 1.6 m camera)
 *   plain         498.4 m everywhere off the ridges
 *   near ridge    crest 900 m at 5 km, triangular, half-width 1 km
 *   far ridge     crest 2400 m (variant A) or 2000 m (variant B) at 20 km,
 *                 triangular, half-width 2 km
 *   sampling      every 250 m out to 40 km — 250 m divides both 5 000 and
 *                 20 000 exactly, so both crests are sampled dead on
 *
 * The ridges are concentric rings centred on the observer, so every bearing
 * sees the identical cross-section and no expectation depends on which one is
 * used. Terrain height depends only on ground distance:
 *
 *   ridge(d) = (crest − 498.4) · max(0, 1 − |d − d_crest| / halfWidth)
 *   terrain(d) = 498.4 + max over the two ridges
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE FIVE ANGLES, DERIVED LONGHAND
 * ───────────────────────────────────────────────────────────────────────────
 * All from α = atan( (E − 500 − d²/(2·R_eff)) / d ), with
 * R_eff = R/(1−k) = 6 371 008.8 / 0.87 = 7 322 998.6207 m, so
 * 2·R_eff = 14 645 997.2414 m, and 1 rad = 57.29577951°.
 *
 * (1) NEAR CREST — d = 5 000 m, E = 900 m
 *     c = 25 000 000 / 14 645 997.2414 = 1.70695 m
 *     tan α = (900 − 500 − 1.70695)/5 000 = 398.29305/5 000 = 0.07965861
 *     α = 0.07965861 − 0.00016849 + 0.00000064 = 0.07949076 rad = 4.554485°
 *
 * (2) FAR CREST, VARIANT A — d = 20 000 m, E = 2 400 m
 *     c = 400 000 000 / 14 645 997.2414 = 27.31122 m
 *     tan α = (2 400 − 500 − 27.31122)/20 000 = 0.09363444
 *     α = 0.09363444 − 0.00027364 + 0.00000144 − 0.00000001 = 0.09336223 rad
 *       = 5.349262°     ← HIGHER THAN (1): the far ridge owns the skyline.
 *
 * (3) FAR CREST, VARIANT B — d = 20 000 m, E = 2 000 m
 *     tan α = (2 000 − 500 − 27.31122)/20 000 = 0.07363444
 *     α = 0.07363444 − 0.00013308 + 0.00000043 = 0.07350179 rad = 4.211342°
 *       ← LOWER THAN (1): the near ridge owns the skyline and hides it.
 *
 * (4) WHAT STANDS IN FRONT OF THE NEAR CREST — the highest angle among samples
 *     strictly nearer than 5 000 m. Along the near ridge's inner flank the
 *     angle climbs monotonically (the flank's slope 401.6/1000 = 0.4016 beats
 *     tan α ≈ 0.08 by 5×, so dα/ds > 0 all the way to the crest) and the plain
 *     is below the eye and therefore negative everywhere. So the maximum is the
 *     last sample before the crest, d = 4 750 m:
 *       E = 498.4 + 401.6 · (1 − 250/1 000) = 498.4 + 301.2 = 799.6 m
 *       c = 22 562 500 / 14 645 997.2414 = 1.540523 m
 *       tan α = (799.6 − 500 − 1.540523)/4 750 = 298.059477/4 750 = 0.06274936
 *       α = 0.06274936 − 0.00008236 + 0.00000019 = 0.06266719 rad = 3.590565°
 *
 * (5) WHAT STANDS IN FRONT OF THE FAR CREST, VARIANT A — the same scan out to
 *     20 000 m. It contains the near crest (4.554485°) and the far ridge's own
 *     inner flank, whose last sample d = 19 750 m wins:
 *       E = 498.4 + 1 901.6 · (1 − 250/2 000) = 498.4 + 1 663.9 = 2 162.3 m
 *       c = 390 062 500 / 14 645 997.2414 = 26.632703 m
 *       tan α = (2 162.3 − 500 − 26.632703)/19 750 = 1 635.667297/19 750
 *             = 0.08281859
 *       α = 0.08281859 − 0.00018933 + 0.00000078 = 0.08263004 rad = 4.734353°
 *
 *     In variant B that same scan is won by the NEAR CREST instead: the far
 *     ridge's flank at 19 750 m only reaches 498.4 + 1 501.6·0.875 = 1 812.3 m,
 *     i.e. tan α = (1 812.3 − 500 − 26.632703)/19 750 = 0.06509708 → 3.724533°,
 *     which loses to (1)'s 4.554485°. So in variant B the occluding angle for
 *     the far crest equals the skyline angle — the case that must not change.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE VERDICTS THAT FOLLOW
 * ───────────────────────────────────────────────────────────────────────────
 *   variant A  near crest  4.554485 vs (4) 3.590565  → clears by +0.963920 ✓
 *              far crest   5.349262 vs (5) 4.734353  → clears by +0.614909 ✓
 *   variant B  near crest  4.554485 vs (4) 3.590565  → clears by +0.963920 ✓
 *              far crest   4.211342 vs (1) 4.554485  → short by −0.343143 ✗
 *
 * The old rule compared every peak against the skyline — 5.349262° in variant
 * A — and so buried the near crest by 0.794777° despite it standing in front.
 */
describe('occlusion by NEARER terrain only — the twin-ridges scene', () => {
  const EYE_ELEVATION_M = 500;
  const PLAIN_M = 498.4;
  const RANGE_STEP_M = 250;
  const MAX_RANGE_M = 40_000;

  const NEAR_CREST_DEG = 4.554485;
  const FAR_CREST_A_DEG = 5.349262;
  const FAR_CREST_B_DEG = 4.211342;
  const IN_FRONT_OF_NEAR_CREST_DEG = 3.590565;
  const IN_FRONT_OF_FAR_CREST_A_DEG = 4.734353;

  function ridgeM(distanceM: number, crestM: number, crestDistanceM: number, halfWidthM: number) {
    const shoulder = 1 - Math.abs(distanceM - crestDistanceM) / halfWidthM;
    return shoulder <= 0 ? 0 : (crestM - PLAIN_M) * shoulder;
  }

  /** Concentric twin ridges, so the profile is the same at every bearing. */
  function buildProfile(farCrestM: number): HorizonProfile {
    const samples: RaySample[] = [];
    for (let distanceM = RANGE_STEP_M; distanceM <= MAX_RANGE_M; distanceM += RANGE_STEP_M) {
      samples.push({
        distanceM,
        elevationM:
          PLAIN_M +
          Math.max(
            ridgeM(distanceM, 900, 5_000, 1_000),
            ridgeM(distanceM, farCrestM, 20_000, 2_000),
          ),
      });
    }
    const rays: BearingRay[] = [0, 90, 180, 270].map((bearingDeg) => ({ bearingDeg, samples }));
    return buildHorizonProfile(EYE_ELEVATION_M, rays);
  }

  /** A crest sighting stated from the longhand angles above, not from the pipeline. */
  function crest(name: string, altitudeDeg: number, distanceKm: number): PeakSighting {
    return {
      id: `twin-ridges/${name}`,
      name,
      lat: 47,
      lon: 11,
      elevationM: 0, // irrelevant here; the angle is what the filter compares
      elevationSource: 'srtm',
      bearingDeg: 90,
      altitudeDeg,
      distanceKm,
    };
  }

  const profileA = buildProfile(2_400);
  const profileB = buildProfile(2_000);

  it('agrees with the longhand angles for the terrain it was handed', () => {
    // Cross-check in the honest direction: the pipeline's own sight-line model
    // must reproduce the hand arithmetic, not the other way round.
    expect(altitudeAngleDeg(EYE_ELEVATION_M, 900, 5_000)).toBeCloseTo(NEAR_CREST_DEG, 5);
    expect(altitudeAngleDeg(EYE_ELEVATION_M, 2_400, 20_000)).toBeCloseTo(FAR_CREST_A_DEG, 5);
    expect(altitudeAngleDeg(EYE_ELEVATION_M, 2_000, 20_000)).toBeCloseTo(FAR_CREST_B_DEG, 5);
    expect(altitudeAngleDeg(EYE_ELEVATION_M, 799.6, 4_750)).toBeCloseTo(
      IN_FRONT_OF_NEAR_CREST_DEG,
      5,
    );
    expect(altitudeAngleDeg(EYE_ELEVATION_M, 2_162.3, 19_750)).toBeCloseTo(
      IN_FRONT_OF_FAR_CREST_A_DEG,
      5,
    );
  });

  it('variant A: the skyline really is the far ridge, 0.79 deg above the near crest', () => {
    // The premise of the whole case. If this ever stopped holding, the test
    // below would be proving nothing.
    expect(interpolateHorizonAltitudeDeg(profileA, 90)).toBeCloseTo(FAR_CREST_A_DEG, 5);
    expect(FAR_CREST_A_DEG - NEAR_CREST_DEG).toBeCloseTo(0.794777, 6);
  });

  it('variant A: the near crest in FRONT of the taller far ridge is VISIBLE', () => {
    // Group F's promoted case (fixtures/scenes/twin-ridges.ts). The near crest
    // sits 0.79 deg BELOW the skyline and is nonetheless in plain sight,
    // because the only thing between it and the observer is its own lower
    // flank at 4 750 m.
    const nearCrest = crest('Near Crest', NEAR_CREST_DEG, 5);
    const resolved = resolveAgainstHorizon(nearCrest, profileA);

    expect(resolved.horizonAltitudeDeg).toBeCloseTo(IN_FRONT_OF_NEAR_CREST_DEG, 5);
    expect(resolved.clearanceDeg).toBeCloseTo(0.963920, 5);
    expect(isPeakVisible(resolved, 0)).toBe(true);
    expect(filterVisiblePeaks([nearCrest], profileA).map((p) => p.name)).toEqual(['Near Crest']);

    // …and the old rule, which is still available for drawing the skyline,
    // would have buried it by 0.79 deg. This is the bug, stated as a number.
    const skylineDeg = interpolateHorizonAltitudeDeg(profileA, 90);
    expect(NEAR_CREST_DEG - skylineDeg).toBeCloseTo(-0.794777, 5);
  });

  it('variant A: both crests survive, in the caller ordering', () => {
    const visible = filterVisiblePeaks(
      [crest('Far Crest', FAR_CREST_A_DEG, 20), crest('Near Crest', NEAR_CREST_DEG, 5)],
      profileA,
    );
    expect(visible.map((p) => p.name)).toEqual(['Far Crest', 'Near Crest']);
    expect(visible[0]?.horizonAltitudeDeg).toBeCloseTo(IN_FRONT_OF_FAR_CREST_A_DEG, 5);
    expect(visible[0]?.clearanceDeg).toBeCloseTo(0.614909, 5);
  });

  it('variant B: a nearer ridge STILL hides a farther, higher peak', () => {
    // The rule must not have become permissive. The far crest stands 1 100 m
    // higher than the near ridge and is still hidden, because the near ridge is
    // genuinely in front of it and out-angles it by 0.343143 deg.
    const farCrest = crest('Far Crest', FAR_CREST_B_DEG, 20);
    const resolved = resolveAgainstHorizon(farCrest, profileB);

    expect(resolved.horizonAltitudeDeg).toBeCloseTo(NEAR_CREST_DEG, 5);
    expect(resolved.clearanceDeg).toBeCloseTo(-0.343143, 5);
    expect(isPeakVisible(resolved, 0)).toBe(false);
    // Not rescued by any plausible error budget either.
    expect(isPeakVisible(resolved, 0.3)).toBe(false);
    expect(filterVisiblePeaks([farCrest], profileB)).toEqual([]);
  });

  it('variant B: the far peak is unchanged from the old skyline rule, exactly', () => {
    // REGRESSION GUARD. When a peak is farther out than every piece of terrain
    // that forms the skyline at its bearing, "highest thing nearer than the
    // peak" and "highest thing at all" are the same maximum, so the new answer
    // must equal the old one bit for bit — not merely to some tolerance.
    const farCrest = crest('Far Crest', FAR_CREST_B_DEG, 20);
    const resolved = resolveAgainstHorizon(farCrest, profileB);
    const oldRuleHorizonDeg = interpolateHorizonAltitudeDeg(profileB, farCrest.bearingDeg);

    expect(resolved.horizonAltitudeDeg).toBe(oldRuleHorizonDeg);
    expect(resolved.clearanceDeg).toBe(farCrest.altitudeDeg - oldRuleHorizonDeg);

    // Same guard for a peak beyond everything in variant A, where the skyline
    // is formed at 20 km: anything past 20 km sees the identical skyline.
    for (const distanceKm of [20.25, 25, 40, 120]) {
      const beyond = crest('Beyond', 6, distanceKm);
      expect(resolveAgainstHorizon(beyond, profileA).horizonAltitudeDeg).toBe(
        interpolateHorizonAltitudeDeg(profileA, beyond.bearingDeg),
      );
    }
  });

  it('agrees with the skyline rule at every bearing for a far-enough peak', () => {
    // Including bearings between the sampled rays and across the 0/360 seam,
    // so the two interpolations are proven to use the same bracketing pair.
    for (const bearingDeg of [0, 22.5, 90, 137.25, 180, 270, 315, 359.75]) {
      const beyond = crest('Beyond', 6, 40);
      expect(
        resolveAgainstHorizon({ ...beyond, bearingDeg }, profileA).horizonAltitudeDeg,
      ).toBe(interpolateHorizonAltitudeDeg(profileA, bearingDeg));
    }
  });
});

describe('occlusion at exactly the peak distance — the boundary case', () => {
  /**
   * A staircase in round numbers so every comparison is exact:
   *
   *   1 km → +3°,   10 km → +7°
   *
   * and a peak whose own angle is +5°, i.e. above the 1 km step and below the
   * 10 km one. Whether it is visible turns entirely on which side of the
   * boundary the 10 km terrain falls.
   */
  const profile = normaliseHorizonProfile([
    {
      bearingDeg: 0,
      altitudeDeg: 7,
      distanceKm: 10,
      elevationM: 1500,
      skylineSteps: [
        { distanceKm: 1, maxAltitudeDeg: 3, elevationM: 200 },
        { distanceKm: 10, maxAltitudeDeg: 7, elevationM: 1500 },
      ],
    },
    {
      bearingDeg: 180,
      altitudeDeg: 7,
      distanceKm: 10,
      elevationM: 1500,
      skylineSteps: [
        { distanceKm: 1, maxAltitudeDeg: 3, elevationM: 200 },
        { distanceKm: 10, maxAltitudeDeg: 7, elevationM: 1500 },
      ],
    },
  ]);

  const peakAt = (distanceKm: number): PeakSighting => sighting('Boundary', 0, 5, distanceKm);

  it('does not let terrain at exactly the peak distance occlude it', () => {
    // The summit IS the terrain sample at 10 km; it cannot hide itself. Only
    // the 1 km step counts, so the peak clears by 5 − 3 = 2 exactly.
    const resolved = resolveAgainstHorizon(peakAt(10), profile);
    expect(resolved.horizonAltitudeDeg).toBe(3);
    expect(resolved.clearanceDeg).toBe(2);
    expect(isPeakVisible(resolved, 0)).toBe(true);
  });

  it('does let it occlude a peak one step farther out', () => {
    // Move the peak a metre beyond the ridge and the ridge is now in front of
    // it: 5 − 7 = −2, hidden. The verdict flips exactly at the boundary.
    const resolved = resolveAgainstHorizon(peakAt(10.001), profile);
    expect(resolved.horizonAltitudeDeg).toBe(7);
    expect(resolved.clearanceDeg).toBe(-2);
    expect(isPeakVisible(resolved, 0)).toBe(false);
    // Only a tolerance at least as large as the shortfall rescues it.
    expect(isPeakVisible(resolved, 1.999)).toBe(false);
    expect(isPeakVisible(resolved, 2)).toBe(true);
  });

  it('reports the nadir when nothing at all stands in front of the peak', () => {
    // A peak nearer than every recorded sample has nothing that can occlude it.
    const resolved = resolveAgainstHorizon(peakAt(1), profile);
    expect(resolved.horizonAltitudeDeg).toBe(NO_NEARER_TERRAIN_ALTITUDE_DEG);
    expect(resolved.horizonAltitudeDeg).toBe(-90);
    expect(resolved.clearanceDeg).toBe(95);
    expect(isPeakVisible(resolved, 0)).toBe(true);
  });
});

describe('staircase-free profiles keep their old meaning', () => {
  /**
   * A profile point that carries no `skylineSteps` knows one fact: at 5 km the
   * terrain reached 6°. Peaks beyond 5 km are compared against it exactly as
   * before; peaks in front of it have nothing recorded in their way.
   */
  const profile = normaliseHorizonProfile([
    { bearingDeg: 0, altitudeDeg: 6, distanceKm: 5, elevationM: 900 },
    { bearingDeg: 180, altitudeDeg: 6, distanceKm: 5, elevationM: 900 },
  ]);

  it('compares a farther peak against the recorded occluder, as it always did', () => {
    const resolved = resolveAgainstHorizon(sighting('Behind', 0, 4, 20), profile);
    expect(resolved.horizonAltitudeDeg).toBe(6);
    expect(resolved.clearanceDeg).toBe(-2);
    expect(isPeakVisible(resolved, 0)).toBe(false);
  });

  it('does not invent terrain in front of a nearer peak', () => {
    const resolved = resolveAgainstHorizon(sighting('InFront', 0, 4, 3), profile);
    expect(resolved.horizonAltitudeDeg).toBe(NO_NEARER_TERRAIN_ALTITUDE_DEG);
    expect(isPeakVisible(resolved, 0)).toBe(true);
  });
});
