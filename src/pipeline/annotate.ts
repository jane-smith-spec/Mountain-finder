/**
 * The pipeline: photograph (or a stated viewpoint) → annotated scene.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE WHOLE RUN IN ONE PLACE
 * ───────────────────────────────────────────────────────────────────────────
 *   1. resolve the observer          ground height from the terrain if unknown
 *   2. sweep the terrain             rays of elevation samples, near → far
 *   3. build the horizon profile     running maximum per ray = the skyline
 *   4. fetch named peaks             from the peak database, NEVER from the DEM
 *   5. sight each peak               bearing, range, altitude angle
 *   5b. set aside peaks on a bearing the sweep asked about and got no terrain
 *       for — they are `unmeasured`, and get NO verdict rather than one read
 *       off a horizon interpolated across the hole
 *   6. filter by the NEARER-terrain rule
 *   7. classify each occlusion    self-occluded (labelled, greyed) or
 *                                 foreground-occluded (never drawn) — D8
 *   8. project each peak to the image
 *
 * Every outside dependency is an argument: the elevation source, the peak
 * source, the tolerances, and the clock. There is no module-level state and no
 * default provider, so a test run is exactly the production run with fixtures
 * in place of tiles.
 *
 * Step 7 is the decision D8 rests on and is described in full on
 * `classifyOcclusion` in src/core/visibility.ts: a summit behind a shoulder of
 * its OWN hill, with no col between the two, is still named — the hill fills
 * the view and the label lands on ground continuous with the summit. A summit
 * behind a DIFFERENT landform is not named at all, because the label would sit
 * on somebody else's hillside. It changes no verdict; it splits the losers.
 *
 * Step 6 is the one worth restating, because it is the bug this project already
 * found and fixed once: a peak is occluded ONLY by terrain NEARER than itself.
 * The far ridge behind a summit is its backdrop, not its lid. `src/core`
 * implements that with the per-bearing skyline staircase; the pipeline's job is
 * to feed it a profile that actually carries those steps, which
 * `buildHorizonProfile` does for every ray it walks.
 *
 * Output is data. The renderer (`src/render`, another agent's) takes this
 * result — horizon profile included, deliberately — and draws it.
 */

import { buildHorizonProfile, hasTerrainAtBearing, horizonCoverage } from '../core/horizon.js';
import { projectToImage } from '../core/projection.js';
import { sightPeak } from '../core/sightline.js';
import type { HorizonProfile, PeakSighting } from '../core/types.js';
import {
  filterVisiblePeaks,
  isLabelled,
  isPeakVisible,
  resolveAgainstHorizon,
} from '../core/visibility.js';

import { PipelineError, throwIfAborted } from './errors.js';
import { classifyPeakOcclusion, describeOccluder } from './occlusion.js';
import { eyeElevationM, resolveObserver } from './observer.js';
import { buildTerrainRays, resolveSweep, sweepBearingsDeg } from './terrain.js';
import type {
  AnnotateSceneRequest,
  AnnotatedPeak,
  AnnotatedScene,
  PipelineConfig,
  ResolvedPipelineConfig,
} from './types.js';

/** Peaks are looked for this far out unless the caller says otherwise. */
export const DEFAULT_PEAK_RADIUS_KM = 200;

/**
 * A peak closer than this counts as "the summit you are standing on".
 *
 * 50 m is comfortably larger than the position error of a summit coordinate and
 * far smaller than any peak worth labelling from another peak. Below it the
 * geometry stops meaning anything: the bearing is whatever direction the two
 * rounding errors point, and the altitude angle heads for ±90°.
 */
export const DEFAULT_MIN_PEAK_DISTANCE_KM = 0.05;

/** How many names a warning lists before it starts counting instead. */
const WARNING_NAME_LIMIT = 5;

/** `"A, B and 7 more"` — enough to recognise the case without a wall of text. */
function describePeakNames(sightings: readonly PeakSighting[]): string {
  const names = sightings.slice(0, WARNING_NAME_LIMIT).map((peak) => `"${peak.name}"`);
  const remaining = sightings.length - names.length;
  return remaining > 0 ? `${names.join(', ')} and ${remaining} more` : names.join(', ');
}

/** Fill in every default, so the result can report what the run actually used. */
export function resolveConfig(config: PipelineConfig = {}): ResolvedPipelineConfig {
  const toleranceDeg = config.toleranceDeg ?? 0;
  if (toleranceDeg < 0) {
    throw new RangeError(`toleranceDeg must be >= 0, received ${toleranceDeg}`);
  }
  const colToleranceM = config.colToleranceM ?? 0;
  if (colToleranceM < 0) {
    throw new RangeError(`colToleranceM must be >= 0, received ${colToleranceM}`);
  }
  return {
    sweep: resolveSweep(config.sweep),
    sightline: config.sightline ?? {},
    toleranceDeg,
    peakRadiusKm: config.peakRadiusKm ?? DEFAULT_PEAK_RADIUS_KM,
    minPeakDistanceKm: config.minPeakDistanceKm ?? DEFAULT_MIN_PEAK_DISTANCE_KM,
    colToleranceM,
  };
}

/**
 * Run the whole pipeline for one viewpoint.
 *
 * @throws PipelineError `no-terrain` when the sweep found no usable elevation
 *   anywhere. That is not a scene with an empty horizon — it is a run with no
 *   evidence, and answering "everything is visible" would be a fabrication.
 */
export async function annotateScene(request: AnnotateSceneRequest): Promise<AnnotatedScene> {
  const config = resolveConfig(request.config);
  const clock = request.config?.clock ?? ((): Date => new Date());
  const warnings: string[] = [];

  throwIfAborted(request.signal);
  const observerResolution = await resolveObserver(request.observer, request.elevation, {
    signal: request.signal,
  });
  const { observer } = observerResolution;
  if (observerResolution.groundElevationSource === 'fallback') {
    warnings.push(
      `Observer ground elevation fell back to ${observer.groundElevationM} m: ` +
        `${observerResolution.terrainNote ?? 'no terrain data'}.`,
    );
  }

  const { rays, report } = await buildTerrainRays(
    request.elevation,
    { lat: observer.lat, lon: observer.lon },
    config.sweep,
    { signal: request.signal, earthRadiusM: config.sightline.earthRadiusM },
  );

  if (rays.length === 0) {
    throw new PipelineError(
      'no-terrain',
      `The terrain sweep around ${observer.lat}, ${observer.lon} returned no usable ` +
        `elevations in ${report.samplesRequested} samples` +
        `${report.gaps.length === 0 ? '' : ` (${report.gaps.join(', ')})`}. ` +
        'Without terrain there is no horizon and no honest visibility verdict.',
    );
  }
  if (report.raysWithTerrain < report.raysRequested) {
    warnings.push(
      `${report.raysRequested - report.raysWithTerrain} of ${report.raysRequested} rays had no ` +
        'terrain data and contribute no horizon point, leaving holes in the profile. Peaks on ' +
        'those bearings get no verdict — see `unmeasured`.',
    );
  }
  if (report.samplesWithElevation < report.samplesRequested) {
    warnings.push(
      `${report.samplesRequested - report.samplesWithElevation} of ${report.samplesRequested} ` +
        `terrain samples had no elevation (${report.gaps.join(', ') || 'no reason reported'}).`,
    );
  }

  const horizon: HorizonProfile = buildHorizonProfile(
    eyeElevationM(observer),
    rays,
    config.sightline,
  );

  throwIfAborted(request.signal);
  const found = await request.peaks.peaksWithin(
    { lat: observer.lat, lon: observer.lon },
    config.peakRadiusKm,
  );

  // Which bearings the sweep asked about and lost. A profile is a list of
  // successes and cannot tell a hole from its own edge, so the sweep's own
  // bearing list is what separates "39 rays failed here" from "the sector
  // stopped here" — see `hasTerrainAtBearing` in src/core/horizon.ts.
  const coverage = horizonCoverage(horizon, sweepBearingsDeg(config.sweep));

  const sightings: PeakSighting[] = [];
  const unmeasured: PeakSighting[] = [];
  for (const peak of found) {
    const sighting = sightPeak(observer, peak, config.sightline);
    if (sighting.distanceKm < config.minPeakDistanceKm) {
      warnings.push(
        `Dropped "${peak.name}" at ${(sighting.distanceKm * 1000).toFixed(0)} m — closer than the ` +
          `${config.minPeakDistanceKm * 1000} m minimum, i.e. the observer is standing on it.`,
      );
      continue;
    }
    // No terrain at this bearing means no evidence either way: the horizon
    // there would be a straight line drawn across the hole, and a peak judged
    // against it is called visible or hidden by ground nobody measured. Both
    // answers would be fabrications, so the peak gets no verdict at all — the
    // same refusal `classifyOcclusion` makes when a ray's record has a hole in
    // it wide enough to hide a col.
    if (!hasTerrainAtBearing(horizon, sighting.bearingDeg, coverage)) {
      unmeasured.push(sighting);
      continue;
    }
    sightings.push(sighting);
  }
  sightings.sort((a, b) => a.distanceKm - b.distanceKm);
  unmeasured.sort((a, b) => a.distanceKm - b.distanceKm);
  if (unmeasured.length > 0) {
    warnings.push(
      `No visible/hidden verdict for ${unmeasured.length} peak(s) on bearings the sweep asked ` +
        `about and got no terrain data for: ${describePeakNames(unmeasured)}. Judging them ` +
        'would mean measuring against a horizon interpolated across the hole.',
    );
  }

  const eyeM = eyeElevationM(observer);
  const peaks: AnnotatedPeak[] = sightings.map((sighting) => {
    const resolved = resolveAgainstHorizon(sighting, horizon);
    const visible = isPeakVisible(resolved, config.toleranceDeg);
    const image = projectToImage(request.camera, sighting.bearingDeg, sighting.altitudeDeg);
    const occludedBy = visible ? undefined : describeOccluder(horizon, sighting);
    // D8: an occluded summit is split by WHAT hides it — its own hill's
    // shoulder (labelled, de-emphasised) or a different landform (not drawn).
    // The visible/hidden verdict above is untouched by this; the classifier is
    // asked only about peaks that already lost.
    const occlusion = visible
      ? undefined
      : classifyPeakOcclusion(eyeM, sighting, rays, {
          sampleSpacingM: config.sweep.rangeStepM,
          toleranceDeg: config.toleranceDeg,
          colToleranceM: config.colToleranceM,
          sightline: config.sightline,
        });
    return {
      ...resolved,
      visible,
      visibility: occlusion?.kind ?? 'visible',
      image,
      ...(occludedBy === undefined ? {} : { occludedBy }),
      ...(occlusion === undefined ? {} : { occlusion }),
    };
  });

  // Cross-check: the annotated verdicts must agree with core's own filter run
  // over the same inputs. They are computed by the same functions, so a
  // disagreement means this file grew a second opinion — fail loudly rather
  // than ship a result whose `visible` list and `visible` flags differ.
  const filtered = filterVisiblePeaks(sightings, horizon, { toleranceDeg: config.toleranceDeg });
  const visible = peaks.filter((peak) => peak.visible);
  if (filtered.length !== visible.length) {
    throw new PipelineError(
      'internal-inconsistency',
      `filterVisiblePeaks kept ${filtered.length} peaks but the ` +
        `pipeline marked ${visible.length} visible.`,
    );
  }

  return {
    observer,
    observerResolution,
    camera: request.camera,
    horizon,
    sweep: report,
    peaks,
    visible,
    occluded: peaks.filter((peak) => !peak.visible),
    unmeasured,
    selfOccluded: peaks.filter((peak) => peak.visibility === 'self-occluded'),
    foregroundOccluded: peaks.filter((peak) => peak.visibility === 'foreground-occluded'),
    labelled: peaks.filter((peak) => isLabelled(peak.visibility)),
    warnings,
    config,
    generatedAt: clock(),
  };
}
