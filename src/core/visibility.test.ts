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
  classifyOcclusion,
  filterVisiblePeaks,
  isLabelled,
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

  it('records the occluding angle and the clearance for a peak that clears it', () => {
    const resolved = resolveAgainstHorizon(sighting('Exposed', 270, 4), profile);
    expect(resolved.occludingAltitudeDeg).toBe(1);
    expect(resolved.clearanceDeg).toBe(3);
  });

  it('records a negative clearance for a peak the ridge hides', () => {
    const resolved = resolveAgainstHorizon(sighting('Hidden', 90, 4), profile);
    expect(resolved.occludingAltitudeDeg).toBe(6);
    expect(resolved.clearanceDeg).toBe(-2);
  });

  it('interpolates the occluding angle between bearing samples', () => {
    // 45° is midway 0°(+3) → 90°(+6), so the terrain there reaches +4.5°.
    const resolved = resolveAgainstHorizon(sighting('Between', 45, 5), profile);
    expect(resolved.occludingAltitudeDeg).toBeCloseTo(4.5, 12);
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

  it('rejects a peak below the terrain in front of it unless the tolerance covers the shortfall', () => {
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
    expect(visible[0]?.occludingAltitudeDeg).toBeCloseTo(WEST_SKYLINE_DEG, 5);
    expect(visible[0]?.clearanceDeg).toBeCloseTo(SUMMIT_ALTITUDE_DEG - WEST_SKYLINE_DEG, 5);
  });

  it('explains the hidden summit with a negative clearance of ~2.89°', () => {
    const resolved = resolveAgainstHorizon(hidden, profile);
    expect(resolved.occludingAltitudeDeg).toBeCloseTo(EAST_SKYLINE_DEG, 5);
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

    expect(resolved.occludingAltitudeDeg).toBeCloseTo(IN_FRONT_OF_NEAR_CREST_DEG, 5);
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
    expect(visible[0]?.occludingAltitudeDeg).toBeCloseTo(IN_FRONT_OF_FAR_CREST_A_DEG, 5);
    expect(visible[0]?.clearanceDeg).toBeCloseTo(0.614909, 5);
  });

  it('variant B: a nearer ridge STILL hides a farther, higher peak', () => {
    // The rule must not have become permissive. The far crest stands 1 100 m
    // higher than the near ridge and is still hidden, because the near ridge is
    // genuinely in front of it and out-angles it by 0.343143 deg.
    const farCrest = crest('Far Crest', FAR_CREST_B_DEG, 20);
    const resolved = resolveAgainstHorizon(farCrest, profileB);

    expect(resolved.occludingAltitudeDeg).toBeCloseTo(NEAR_CREST_DEG, 5);
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

    expect(resolved.occludingAltitudeDeg).toBe(oldRuleHorizonDeg);
    expect(resolved.clearanceDeg).toBe(farCrest.altitudeDeg - oldRuleHorizonDeg);

    // Same guard for a peak beyond everything in variant A, where the skyline
    // is formed at 20 km: anything past 20 km sees the identical skyline.
    for (const distanceKm of [20.25, 25, 40, 120]) {
      const beyond = crest('Beyond', 6, distanceKm);
      expect(resolveAgainstHorizon(beyond, profileA).occludingAltitudeDeg).toBe(
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
        resolveAgainstHorizon({ ...beyond, bearingDeg }, profileA).occludingAltitudeDeg,
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
    expect(resolved.occludingAltitudeDeg).toBe(3);
    expect(resolved.clearanceDeg).toBe(2);
    expect(isPeakVisible(resolved, 0)).toBe(true);
  });

  it('does let it occlude a peak one step farther out', () => {
    // Move the peak a metre beyond the ridge and the ridge is now in front of
    // it: 5 − 7 = −2, hidden. The verdict flips exactly at the boundary.
    const resolved = resolveAgainstHorizon(peakAt(10.001), profile);
    expect(resolved.occludingAltitudeDeg).toBe(7);
    expect(resolved.clearanceDeg).toBe(-2);
    expect(isPeakVisible(resolved, 0)).toBe(false);
    // Only a tolerance at least as large as the shortfall rescues it.
    expect(isPeakVisible(resolved, 1.999)).toBe(false);
    expect(isPeakVisible(resolved, 2)).toBe(true);
  });

  it('reports the nadir when nothing at all stands in front of the peak', () => {
    // A peak nearer than every recorded sample has nothing that can occlude it.
    const resolved = resolveAgainstHorizon(peakAt(1), profile);
    expect(resolved.occludingAltitudeDeg).toBe(NO_NEARER_TERRAIN_ALTITUDE_DEG);
    expect(resolved.occludingAltitudeDeg).toBe(-90);
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
    expect(resolved.occludingAltitudeDeg).toBe(6);
    expect(resolved.clearanceDeg).toBe(-2);
    expect(isPeakVisible(resolved, 0)).toBe(false);
  });

  it('does not invent terrain in front of a nearer peak', () => {
    const resolved = resolveAgainstHorizon(sighting('InFront', 0, 4, 3), profile);
    expect(resolved.occludingAltitudeDeg).toBe(NO_NEARER_TERRAIN_ALTITUDE_DEG);
    expect(isPeakVisible(resolved, 0)).toBe(true);
  });
});

/**
 * A SUMMIT MUST NOT BECOME ITS OWN OCCLUDER ON A COIN TOSS.
 *
 * The cutoff in `maxAltitudeNearerThanDeg` is the peak's `distanceKm`, and the
 * comparison against a staircase step is strict so that the terrain sample AT
 * the summit does not occlude the summit. But the two numbers come from
 * different computations of the same physical distance:
 *
 *   peak    haversine(observer, peak.lat/lon)
 *   sample  the range step the ray walk asked for
 *
 * so they differ in the last few bits, with an arbitrary sign. Bearing 090° at
 * 10 000 m from 47°N 11°E round-trips through `destinationPoint` to
 * 10 000.000000000091 m — three parts in 10¹⁵ LONG — and the peak's own step is
 * then "nearer than" it. `occludingAltitudeDeg` becomes the peak's own angle and
 * the clearance collapses to ~0: a peak that clears by half a degree reported
 * as only just scraping in.
 *
 * The verdict does not flip (an equal angle still passes `>= -tolerance`), which
 * is exactly why this needs a test — it is a wrong NUMBER that nothing else
 * complains about.
 *
 * Geometry is the cone of fixtures/scenes/conical-peak.ts, whose angles are
 * derived longhand there (drop model, R_eff = 6 371 008.8/0.87):
 *
 *   apex   1500 m at 10 000 m: c = 6.82780 → atan(1491.17220/10000) = 8.481293°
 *   flank  1375 m at  9 750 m: c = 6.490681 → atan(1366.509319/9750) = 7.978309°
 *   clearance = 0.502983°
 */
describe('a peak coinciding with a terrain sample', () => {
  const observer: Observer = { lat: 47, lon: 11, groundElevationM: 0, eyeHeightM: 2 };
  const APEX_DISTANCE_M = 10_000;
  const APEX_BEARING_DEG = 90;
  const APEX_DEG = 8.481293;
  const FLANK_DEG = 7.978309;

  const profile = buildHorizonProfile(2, [
    {
      bearingDeg: APEX_BEARING_DEG,
      samples: [
        { distanceM: 9_750, elevationM: 1375 },
        { distanceM: APEX_DISTANCE_M, elevationM: 1500 },
      ],
    },
  ]);

  const apexPoint = destinationPoint(observer, APEX_BEARING_DEG, APEX_DISTANCE_M);
  const apex: Peak = {
    id: 'node/apex',
    name: 'Cone Apex',
    lat: apexPoint.lat,
    lon: apexPoint.lon,
    elevationM: 1500,
    elevationSource: 'srtm',
  };
  const sighted = sightPeak(observer, apex);

  it('really does land on the far side of the sample distance', () => {
    // Guard on the guard: if this ever stopped being true the test below would
    // pass without exercising anything. The peak is 9e-11 m FARTHER than the
    // sample that represents it.
    expect(sighted.distanceKm).toBeGreaterThan(APEX_DISTANCE_M / 1000);
    expect(sighted.distanceKm - APEX_DISTANCE_M / 1000).toBeLessThan(1e-9);
    expect(sighted.altitudeDeg).toBeCloseTo(APEX_DEG, 5);
  });

  it('is measured against the flank in front of it, not against itself', () => {
    const resolved = resolveAgainstHorizon(sighted, profile);

    expect(resolved.occludingAltitudeDeg).toBeCloseTo(FLANK_DEG, 5);
    expect(resolved.occludingAltitudeDeg).not.toBeCloseTo(APEX_DEG, 3);
    expect(resolved.clearanceDeg).toBeCloseTo(0.502983, 5);
    expect(isPeakVisible(resolved, 0)).toBe(true);
  });

  it('gives the same answer whichever side of the sample the noise falls', () => {
    // The bug's signature is that the answer depends on the sign of a rounding
    // error, so both signs are asserted explicitly — and a bearing where the
    // round trip lands SHORT (045°) must not be treated differently.
    const short = destinationPoint(observer, 45, APEX_DISTANCE_M);
    const shortSighting = sightPeak(observer, { ...apex, lat: short.lat, lon: short.lon });
    expect(shortSighting.distanceKm).toBeLessThan(APEX_DISTANCE_M / 1000);

    const shortProfile = buildHorizonProfile(2, [
      {
        bearingDeg: 45,
        samples: [
          { distanceM: 9_750, elevationM: 1375 },
          { distanceM: APEX_DISTANCE_M, elevationM: 1500 },
        ],
      },
    ]);
    expect(resolveAgainstHorizon(shortSighting, shortProfile).occludingAltitudeDeg).toBeCloseTo(
      FLANK_DEG,
      5,
    );
  });

  it('still lets genuinely nearer terrain occlude, down to metres', () => {
    // The slack must not swallow real occluders. A wall 1 m nearer than the
    // peak is 1e-7 of the range — a hundred times the slack — and still hides
    // it. (Terrain postings are ~30 m apart, so this is already unreachably
    // fine in practice.)
    const wallProfile = buildHorizonProfile(2, [
      {
        bearingDeg: APEX_BEARING_DEG,
        samples: [
          { distanceM: 9_999, elevationM: 2000 },
          { distanceM: APEX_DISTANCE_M, elevationM: 1500 },
        ],
      },
    ]);
    const resolved = resolveAgainstHorizon(sighted, wallProfile);
    expect(resolved.occludingAltitudeDeg).toBeCloseTo(
      altitudeAngleDeg(2, 2000, 9_999),
      12,
    );
    expect(resolved.clearanceDeg).toBeLessThan(0);
    expect(isPeakVisible(resolved, 0)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Occlusion classification (D8): self-occluded vs foreground-occluded
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Every scene below is hand-built so that the ANSWER follows from the shape of
 * the terrain and not from any number this code produces. Curvature drop is
 * 0.07 m at 1 km and 0.6 m at 3 km, so all the margins here (tens of metres)
 * are decided long before the third decimal place of any angle; the closed-form
 * quantities that ARE asserted numerically (`colDepthM`, the crest's distance)
 * are exact differences of the integers written into the fixtures.
 */

/** Terrain samples every `spacingM` metres, from a list of elevations. */
function evenRay(spacingM: number, elevationsM: readonly number[]): RaySample[] {
  return elevationsM.map((elevationM, index) => ({
    distanceM: (index + 1) * spacingM,
    elevationM,
  }));
}

describe('classifyOcclusion', () => {
  /**
   * THE COW HILL SHAPE. A convex hill the observer stands at the foot of:
   * ground rises without interruption from the near shoulder that gets in the
   * way (100 m out, 30 m up, subtending atan(0.30) = 16.7°) to the summit
   * (1000 m out, 180 m up, subtending atan(0.18) = 10.2°). The summit is
   * behind the shoulder of its OWN hill: there is no col anywhere between the
   * two, so both belong to one landform.
   */
  const convexHill = evenRay(100, [30, 60, 90, 115, 135, 150, 160, 168, 174, 178]);

  it('calls an unbroken rise from the blocking shoulder to the summit self-occlusion', () => {
    const classification = classifyOcclusion(
      0,
      { distanceKm: 1, altitudeDeg: altitudeAngleDeg(0, 180, 1000) },
      convexHill,
      { sampleSpacingM: 100 },
    );

    expect(classification.kind).toBe('self-occluded');
    expect(classification.evidence).toBe('unbroken-rise-to-summit');
    // The FIRST sample that gets in the way, not the highest: 30 m at 100 m
    // already out-angles the summit, so that is where the sightline enters the
    // ground.
    expect(classification.crestDistanceKm).toBe(0.1);
    expect(classification.crestElevationM).toBe(30);
    // Lowest ground between the crest and the summit is the 60 m sample, which
    // is ABOVE the crest — no col at all.
    expect(classification.colDepthM).toBe(0);
  });

  /**
   * THE BEN NEVIS / MOUNT BAKER SHAPE. The same 30 m shoulder at 100 m hides a
   * far bigger mountain 5 km away, but the ground between the two collapses to
   * a 5 m valley floor: a col 25 m below the crest separates the two landforms
   * completely. What you would be labelling is the near shoulder, not the
   * mountain.
   */
  const valleyThenMountain: RaySample[] = Array.from({ length: 49 }, (_, index) => {
    const distanceM = (index + 1) * 100;
    // 30 m shoulder at 100 m; a 5 m valley floor out to 1 km; then the far
    // mountain's flank climbing 1 m in 5 to 785 m at 4.9 km.
    if (distanceM === 100) return { distanceM, elevationM: 30 };
    if (distanceM <= 1000) return { distanceM, elevationM: 5 };
    return { distanceM, elevationM: 5 + (distanceM - 1000) * 0.2 };
  });

  it('calls a col between the blocker and the summit foreground occlusion', () => {
    const classification = classifyOcclusion(
      0,
      { distanceKm: 5, altitudeDeg: altitudeAngleDeg(0, 800, 5000) },
      valleyThenMountain,
      { sampleSpacingM: 100 },
    );

    expect(classification.kind).toBe('foreground-occluded');
    expect(classification.evidence).toBe('col-between-occluder-and-summit');
    expect(classification.crestElevationM).toBe(30);
    // Crest 30 m, valley floor 5 m: a 25 m col, exactly.
    expect(classification.colDepthM).toBe(25);
  });

  it('refuses to call it self-occlusion when the terrain between was never sampled', () => {
    // The same convex hill with the 400-700 m samples missing — an unfilled
    // void, or water the tile has no data for. Absence of a col in the record
    // is not evidence that there is no col.
    const gapped = convexHill.filter(
      (sample) => sample.distanceM < 400 || sample.distanceM > 700,
    );

    const classification = classifyOcclusion(
      0,
      { distanceKm: 1, altitudeDeg: altitudeAngleDeg(0, 180, 1000) },
      gapped,
      { sampleSpacingM: 100 },
    );

    expect(classification.kind).toBe('foreground-occluded');
    expect(classification.evidence).toBe('unsampled-gap-between-occluder-and-summit');
  });

  it('refuses to call it self-occlusion when nothing on this ray blocks at all', () => {
    // Flat 5 m ground: the caller's interpolated profile judged the peak
    // hidden (by a neighbouring ray), but THIS ray cannot show what by, so
    // self-occlusion is unproven and the peak stays unlabelled.
    const classification = classifyOcclusion(
      0,
      { distanceKm: 5, altitudeDeg: altitudeAngleDeg(0, 800, 5000) },
      evenRay(100, [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
      { sampleSpacingM: 100 },
    );

    expect(classification.kind).toBe('foreground-occluded');
    expect(classification.evidence).toBe('occluder-not-on-this-ray');
    expect(classification.crestDistanceKm).toBeUndefined();
  });

  it('does not let the summit\'s own under-read terrain sample count as a col', () => {
    // SRTM reads sharp summits 250-350 m low (MISSION.md), so the sample at
    // the peak's OWN range routinely sits below the terrain leading up to it.
    // That sample is the peak, not a col in front of it — the same reason
    // `maxAltitudeNearerThanDeg` excludes terrain at exactly the peak's range.
    const underReadSummit: RaySample[] = [
      { distanceM: 200, elevationM: 150 },
      { distanceM: 400, elevationM: 220 },
      { distanceM: 600, elevationM: 260 },
      { distanceM: 800, elevationM: 280 },
      { distanceM: 1000, elevationM: 140 },
    ];

    const classification = classifyOcclusion(
      0,
      { distanceKm: 1, altitudeDeg: altitudeAngleDeg(0, 300, 1000) },
      underReadSummit,
      { sampleSpacingM: 200 },
    );

    expect(classification.kind).toBe('self-occluded');
    expect(classification.colDepthM).toBe(0);
  });

  it('grants a col allowance only when the caller asks for one', () => {
    // A 6 m dip past the crest. At the default zero allowance that is a col and
    // the peak is not labelled; a caller who states a 10 m DEM noise budget
    // gets the other answer. Nothing is tuned silently.
    //
    // The terrain here was rebuilt when the crest became the HIGHEST nearer
    // sample rather than the first one (review 2, finding 1). It used to put
    // the dip at 200 m, BEHIND the 130 m sample at 400 m that actually forms
    // the skyline — under the corrected rule that scene is genuinely one
    // landform (the ground climbs 130 → 140 m from the crest to the summit
    // with nothing in between), so it no longer exercises the allowance at all.
    // The dip now sits where the rule looks: between the crest and the summit.
    const dippedHill: RaySample[] = [
      { distanceM: 100, elevationM: 30 },
      { distanceM: 200, elevationM: 60 },
      { distanceM: 300, elevationM: 100 },
      { distanceM: 400, elevationM: 94 },
    ];
    // atan(100/300) = 18.43 deg is the highest angle in front of the summit and
    // beats its atan(140/500) = 15.64 deg, so the 300 m sample is the crest —
    // clear of the 16.70 deg the 100 m and 200 m samples reach — and the 94 m
    // sample behind it is a 6 m col between that crest and the summit.
    const target = { distanceKm: 0.5, altitudeDeg: altitudeAngleDeg(0, 140, 500) };

    expect(classifyOcclusion(0, target, dippedHill, { sampleSpacingM: 100 }).kind).toBe(
      'foreground-occluded',
    );
    expect(
      classifyOcclusion(0, target, dippedHill, { sampleSpacingM: 100, colToleranceM: 10 }).kind,
    ).toBe('self-occluded');
    expect(classifyOcclusion(0, target, dippedHill, { sampleSpacingM: 100 }).colDepthM).toBe(6);
  });

  it('is undefined about nothing: every classification names its evidence', () => {
    const kinds = new Set<string>();
    for (const ray of [convexHill, valleyThenMountain]) {
      const classification = classifyOcclusion(
        0,
        { distanceKm: 1, altitudeDeg: altitudeAngleDeg(0, 180, 1000) },
        ray,
        { sampleSpacingM: 100 },
      );
      kinds.add(classification.kind);
      expect(classification.evidence.length).toBeGreaterThan(0);
    }
    expect(kinds.size).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE CREST IS THE ONE THE VIEWER CAN SEE (adversarial review 2, finding 1)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Terrain copied from the review, sampled at the 90 m default step, observer's
 * eye at 100 m above sea level:
 *
 *   0.95–1.15 km   150 m   a low bank — the FIRST thing in the way
 *   1.15–14.5 km   150→749 m  a foreslope that never dips
 *   14.5–15.5 km   900 m   a DIFFERENT mountain — the actual skyline
 *   15.5–19.8 km   500 m   a 400 m col
 *   19.8–20 km     500→1000 m  the target summit's own flank
 *   20 km          1000 m  the target summit
 *
 * Angles from the documented drop model (R_eff = 6 371 008.8/0.87 =
 * 7 322 998.6207 m, drop = d²/(2·R_eff), α = atan((Δh − drop)/d)), worked out
 * by hand and asserted below so the shape of the argument is checkable:
 *
 *   bank    150 m @   990 m: drop 0.0669  → atan(49.9331/990)    = 2.8874°
 *   skyline 900 m @ 14580 m: drop 14.5143 → atan(785.4857/14580) = 3.0838°
 *   summit 1000 m @ 20000 m: drop 27.3129 → atan(872.6871/20000) = 2.4985°
 *
 * Both nearer pieces of ground out-angle the summit, so both "block" it. Only
 * the 900 m mountain forms the skyline. Measuring continuity from the bank
 * gives colDepthM 0 — the foreslope never drops below 150 m — and calls a
 * summit across a 400 m col SELF-occluded, which plants a greyed label on a
 * different mountain's face, 5 km short of the summit it names. Measuring from
 * the crest that is actually in view gives 900 − 500 = 400 m of col.
 */
describe('classifyOcclusion — a taller crest standing behind the first blocker', () => {
  const EYE_ELEVATION_M = 100;
  const SUMMIT_DISTANCE_M = 20_000;
  const SUMMIT_ELEVATION_M = 1000;
  const STEP_M = 90;

  /** The review's profile as a function of ground distance. */
  function reviewTerrainM(distanceM: number): number {
    if (distanceM < 950) return 0;
    if (distanceM <= 1150) return 150;
    if (distanceM < 14_500) return 150 + ((distanceM - 1150) * (749 - 150)) / (14_500 - 1150);
    if (distanceM <= 15_500) return 900;
    if (distanceM <= 19_800) return 500;
    return 500 + ((distanceM - 19_800) * (SUMMIT_ELEVATION_M - 500)) / 200;
  }

  const ray: RaySample[] = Array.from({ length: 233 }, (_, index) => {
    const distanceM = (index + 1) * STEP_M;
    return { distanceM, elevationM: reviewTerrainM(distanceM) };
  });

  const target = {
    distanceKm: SUMMIT_DISTANCE_M / 1000,
    altitudeDeg: altitudeAngleDeg(EYE_ELEVATION_M, SUMMIT_ELEVATION_M, SUMMIT_DISTANCE_M),
  };

  it('has the shape the argument depends on: two blockers, the farther one higher', () => {
    // Hand-derived above; asserted here so the scene cannot drift silently.
    expect(altitudeAngleDeg(EYE_ELEVATION_M, 150, 990)).toBeCloseTo(2.8874, 3);
    expect(altitudeAngleDeg(EYE_ELEVATION_M, 900, 14_580)).toBeCloseTo(3.0838, 3);
    expect(target.altitudeDeg).toBeCloseTo(2.4985, 3);

    // The first sample that gets in the way is the 150 m bank at 990 m …
    const firstBlocker = ray.find(
      (sample) =>
        sample.distanceM < SUMMIT_DISTANCE_M &&
        altitudeAngleDeg(EYE_ELEVATION_M, sample.elevationM, sample.distanceM) >
          target.altitudeDeg,
    );
    expect(firstBlocker).toEqual({ distanceM: 990, elevationM: 150 });

    // … and it is NOT the highest thing in front of the summit.
    expect(altitudeAngleDeg(EYE_ELEVATION_M, 900, 14_580)).toBeGreaterThan(
      altitudeAngleDeg(EYE_ELEVATION_M, 150, 990),
    );
  });

  it('measures the col against the crest that forms the skyline, not the first blocker', () => {
    const classification = classifyOcclusion(EYE_ELEVATION_M, target, ray, {
      sampleSpacingM: STEP_M,
    });

    // The 900 m mountain at 14.58 km is what the viewer sees at this bearing.
    expect(classification.crestElevationM).toBe(900);
    expect(classification.crestDistanceKm).toBeCloseTo(14.58, 9);
    // 900 m of crest, 500 m of col floor: 400 m, exact integer arithmetic.
    expect(classification.colDepthM).toBe(400);
    expect(classification.kind).toBe('foreground-occluded');
    expect(classification.evidence).toBe('col-between-occluder-and-summit');
  });

  it('does not report the 150 m bank, whose foreslope hides the col entirely', () => {
    const classification = classifyOcclusion(EYE_ELEVATION_M, target, ray, {
      sampleSpacingM: STEP_M,
    });

    // The bug's signature: crest 150 m at 0.99 km, colDepthM 0, self-occluded.
    expect(classification.crestElevationM).not.toBe(150);
    expect(classification.colDepthM).not.toBe(0);
    expect(classification.kind).not.toBe('self-occluded');
  });
});

describe('isLabelled', () => {
  it('labels visible and self-occluded peaks, never foreground-occluded ones', () => {
    expect(isLabelled('visible')).toBe(true);
    expect(isLabelled('self-occluded')).toBe(true);
    expect(isLabelled('foreground-occluded')).toBe(false);
  });
});
