import { describe, expect, it } from 'vitest';

import { destinationPoint } from './geodesy';
import { buildHorizonProfile, normaliseHorizonProfile } from './horizon';
import type { BearingRay } from './horizon';
import { sightPeak } from './sightline';
import type { RaySample } from './sightline';
import { filterVisiblePeaks, isPeakVisible, resolveAgainstHorizon } from './visibility';
import type { HorizonPoint, Observer, Peak, PeakSighting } from './types';

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
