/**
 * Walking the terrain: turning an elevation source into bearing rays.
 *
 * This is the I/O half of the horizon builder. `buildHorizonProfile` in core is
 * pure and takes rays of already-sampled terrain; getting those samples out of
 * a tile store is what happens here, which is why this file lives in
 * `src/pipeline` and not in `src/core`.
 *
 * ## Sampling geometry
 *
 * Rays leave the observer every `bearingStepDeg`, and along each ray terrain is
 * sampled every `rangeStepM` out to `maxRangeKm`. Range starts at ONE step, not
 * zero: the observer's own coordinate subtends no meaningful angle (the
 * altitude formula divides by the distance) and it is not terrain the observer
 * can see anyway.
 *
 * ## Holes are holes
 *
 * A point with no elevation — ocean, void, or a tile that was never downloaded
 * — is DROPPED from the ray, never coerced to 0 m. Sea level is a real height,
 * and a fake one in the middle of a ray either invents a ridge or digs a
 * trench, both of which corrupt the skyline silently. The dropped points are
 * counted and their reasons reported in {@link SweepReport}, so a run over
 * terrain that was never fetched is loud rather than plausible.
 */

import { destinationPoint } from '../core/geodesy.js';
import type { BearingRay } from '../core/horizon.js';
import type { RaySample } from '../core/sightline.js';
import type { LatLng } from '../core/types.js';
import type { ElevationProvider } from '../providers/elevation.js';

import { throwIfAborted } from './errors.js';
import type { SweepConfig, SweepReport } from './types.js';

/**
 * Sweep defaults.
 *
 * `rangeStepM: 90` samples three times coarser than the 30 m SRTM1 posting.
 * That is a deliberate trade: a 1° × 30 km sweep at 30 m spacing is a million
 * point reads, and the horizon is a running maximum over a ray, which is far
 * less sensitive to step size than a single reading is. Cases that need finer
 * resolution — a knife-edge shoulder 1.2 km away deciding a peak — pass their
 * own step; the Fort William acceptance run uses 30 m for exactly that reason.
 */
export const DEFAULT_SWEEP: SweepConfig = {
  bearingStepDeg: 1,
  rangeStepM: 90,
  maxRangeKm: 30,
  startBearingDeg: 0,
  spanDeg: 360,
};

/** Fill in the defaults and reject a sweep that cannot be walked. */
export function resolveSweep(partial: Partial<SweepConfig> = {}): SweepConfig {
  const sweep: SweepConfig = { ...DEFAULT_SWEEP, ...partial };
  if (!(sweep.bearingStepDeg > 0)) {
    throw new RangeError(`bearingStepDeg must be > 0, received ${sweep.bearingStepDeg}`);
  }
  if (!(sweep.rangeStepM > 0)) {
    throw new RangeError(`rangeStepM must be > 0, received ${sweep.rangeStepM}`);
  }
  if (!(sweep.maxRangeKm > 0)) {
    throw new RangeError(`maxRangeKm must be > 0, received ${sweep.maxRangeKm}`);
  }
  if (!(sweep.spanDeg > 0) || sweep.spanDeg > 360) {
    throw new RangeError(`spanDeg must be in (0, 360], received ${sweep.spanDeg}`);
  }
  if (sweep.maxRangeKm * 1000 < sweep.rangeStepM) {
    throw new RangeError(
      `maxRangeKm (${sweep.maxRangeKm} km) is shorter than one range step ` +
        `(${sweep.rangeStepM} m), so no ray would hold a sample`,
    );
  }
  return sweep;
}

/**
 * The bearings the sweep will walk.
 *
 * A full circle uses `round(360 / step)` rays and never repeats bearing 0 at
 * both ends: the profile is a closed loop, and a duplicate seam sample would
 * have to be merged away again.
 */
export function sweepBearingsDeg(sweep: SweepConfig): readonly number[] {
  const rayCount = Math.max(1, Math.round(sweep.spanDeg / sweep.bearingStepDeg));
  const bearings: number[] = [];
  for (let index = 0; index < rayCount; index += 1) {
    bearings.push(sweep.startBearingDeg + index * sweep.bearingStepDeg);
  }
  return bearings;
}

/** Ground distances sampled along every ray, near → far. */
export function sweepRangesM(sweep: SweepConfig): readonly number[] {
  const maxRangeM = sweep.maxRangeKm * 1000;
  const stepCount = Math.floor(maxRangeM / sweep.rangeStepM);
  const ranges: number[] = [];
  for (let step = 1; step <= stepCount; step += 1) ranges.push(step * sweep.rangeStepM);
  return ranges;
}

/** The coordinates one ray visits, in the same order as {@link sweepRangesM}. */
export function rayPoints(
  origin: LatLng,
  bearingDeg: number,
  rangesM: readonly number[],
  earthRadiusM?: number,
): readonly LatLng[] {
  return rangesM.map((distanceM) =>
    earthRadiusM === undefined
      ? destinationPoint(origin, bearingDeg, distanceM)
      : destinationPoint(origin, bearingDeg, distanceM, earthRadiusM),
  );
}

export interface TerrainSweepResult {
  readonly rays: readonly BearingRay[];
  readonly report: SweepReport;
}

/**
 * Sample the terrain along every ray of the sweep.
 *
 * One provider call per ray: small enough that a batching provider is not
 * defeated, large enough that 360 rays do not become 90 000 round trips. The
 * abort signal is checked between rays, so a cancelled run stops within one
 * ray rather than at the end.
 */
export async function buildTerrainRays(
  elevation: ElevationProvider,
  origin: LatLng,
  sweep: SweepConfig,
  options: { readonly signal?: AbortSignal; readonly earthRadiusM?: number } = {},
): Promise<TerrainSweepResult> {
  const bearings = sweepBearingsDeg(sweep);
  const rangesM = sweepRangesM(sweep);

  const rays: BearingRay[] = [];
  const gaps = new Set<string>();
  let samplesRequested = 0;
  let samplesWithElevation = 0;

  for (const bearingDeg of bearings) {
    throwIfAborted(options.signal);

    const points = rayPoints(origin, bearingDeg, rangesM, options.earthRadiusM);
    const readings = await elevation.fetchElevations(points, { signal: options.signal });
    samplesRequested += points.length;

    const samples: RaySample[] = [];
    for (let index = 0; index < rangesM.length; index += 1) {
      const distanceM = rangesM[index];
      const reading = readings[index];
      if (distanceM === undefined || reading === undefined) continue;
      if (reading.elevationM === null) {
        gaps.add(reading.dataset);
        continue;
      }
      samples.push({ distanceM, elevationM: reading.elevationM });
      samplesWithElevation += 1;
    }

    if (samples.length > 0) rays.push({ bearingDeg, samples });
  }

  return {
    rays,
    report: {
      raysRequested: bearings.length,
      raysWithTerrain: rays.length,
      samplesRequested,
      samplesWithElevation,
      gaps: [...gaps].sort(),
    },
  };
}
