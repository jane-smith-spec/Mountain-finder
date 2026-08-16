/**
 * Analytic horizon profiles for the CV round-trip tests.
 *
 * These are NOT produced by the pipeline. The whole value of the round-trip
 * self-check is that the injected offset is known independently of every piece
 * of code being tested, so the terrain has to come from a closed form too:
 * a base altitude plus a sum of Gaussian bumps in bearing,
 *
 *     α(β) = α₀ + Σᵢ hᵢ · exp( −½ · ((β − cᵢ) / wᵢ)² )
 *
 * evaluated on a uniform bearing grid. Smooth, non-periodic, and with a
 * distinctive signature — the last property matters, because a skyline of
 * identical evenly spaced bumps is genuinely ambiguous in heading and the
 * aligner would be right to refuse it. `ambiguousProfile` builds exactly that
 * case on purpose.
 *
 * `distanceKm` and `elevationM` are filled in consistently with the angle
 * rather than left at zero, so the fixtures are self-consistent if anything
 * ever reads them: at range d and eye height 0, an altitude α means the terrain
 * top is at d·tan α. Nothing in the aligner reads either field — only
 * `bearingDeg` and `altitudeDeg` — but a fixture that contradicts itself is a
 * trap for the next reader.
 */

import type { HorizonPoint, HorizonProfile } from '../../core/types.js';
import { toRadians } from '../../core/geodesy.js';

export interface ProfileBump {
  readonly centerDeg: number;
  /** Gaussian σ in degrees of bearing. */
  readonly widthDeg: number;
  readonly heightDeg: number;
}

export interface AnalyticProfileSpec {
  readonly fromBearingDeg: number;
  readonly toBearingDeg: number;
  readonly stepDeg: number;
  readonly baseAltitudeDeg: number;
  readonly bumps: readonly ProfileBump[];
  /** Range assigned to every point, used only to fill `elevationM` coherently. */
  readonly distanceKm?: number;
}

/** The closed form, exposed so tests can state expectations without the profile. */
export function analyticAltitudeDeg(spec: AnalyticProfileSpec, bearingDeg: number): number {
  let altitude = spec.baseAltitudeDeg;
  for (const bump of spec.bumps) {
    const z = (bearingDeg - bump.centerDeg) / bump.widthDeg;
    altitude += bump.heightDeg * Math.exp(-0.5 * z * z);
  }
  return altitude;
}

export function analyticProfile(spec: AnalyticProfileSpec): HorizonProfile {
  if (!(spec.stepDeg > 0)) throw new RangeError('stepDeg must be > 0');
  const distanceKm = spec.distanceKm ?? 10;
  const points: HorizonPoint[] = [];
  const count = Math.round((spec.toBearingDeg - spec.fromBearingDeg) / spec.stepDeg);
  for (let index = 0; index <= count; index += 1) {
    const bearingDeg = spec.fromBearingDeg + index * spec.stepDeg;
    const altitudeDeg = analyticAltitudeDeg(spec, bearingDeg);
    points.push({
      bearingDeg,
      altitudeDeg,
      distanceKm,
      elevationM: distanceKm * 1000 * Math.tan(toRadians(altitudeDeg)),
    });
  }
  // Sorted, wrapped and de-duplicated the same way the pipeline's profiles are.
  return points
    .map((point) => ({ ...point, bearingDeg: ((point.bearingDeg % 360) + 360) % 360 }))
    .sort((a, b) => a.bearingDeg - b.bearingDeg);
}

/**
 * A profile with a clear, non-repeating signature: three bumps of different
 * heights and widths. The stand-in for "an ordinary alpine skyline".
 */
export function signatureProfile(centreBearingDeg = 265, halfSpanDeg = 60): HorizonProfile {
  return analyticProfile({
    fromBearingDeg: centreBearingDeg - halfSpanDeg,
    toBearingDeg: centreBearingDeg + halfSpanDeg,
    stepDeg: 0.25,
    baseAltitudeDeg: 3,
    bumps: [
      { centerDeg: centreBearingDeg - 18, widthDeg: 4, heightDeg: 5.5 },
      { centerDeg: centreBearingDeg - 2, widthDeg: 1.6, heightDeg: 9 },
      { centerDeg: centreBearingDeg + 14, widthDeg: 7, heightDeg: 3 },
    ],
  });
}

/** A dead-flat horizon: the sea, or a high plateau. No heading information at all. */
export function flatProfile(centreBearingDeg = 265, halfSpanDeg = 60): HorizonProfile {
  return analyticProfile({
    fromBearingDeg: centreBearingDeg - halfSpanDeg,
    toBearingDeg: centreBearingDeg + halfSpanDeg,
    stepDeg: 0.25,
    baseAltitudeDeg: 1.5,
    bumps: [],
  });
}

/**
 * A periodic ridgeline: identical bumps every 8°. Every heading offset that is
 * a multiple of 8° fits as well as the truth, so the correct answer here is a
 * refusal — this is the fixture for the ambiguity gate, not for accuracy.
 */
export function ambiguousProfile(centreBearingDeg = 265, halfSpanDeg = 60): HorizonProfile {
  const bumps: ProfileBump[] = [];
  for (let offset = -halfSpanDeg; offset <= halfSpanDeg; offset += 8) {
    bumps.push({ centerDeg: centreBearingDeg + offset, widthDeg: 1.8, heightDeg: 4 });
  }
  return analyticProfile({
    fromBearingDeg: centreBearingDeg - halfSpanDeg,
    toBearingDeg: centreBearingDeg + halfSpanDeg,
    stepDeg: 0.25,
    baseAltitudeDeg: 3,
    bumps,
  });
}
