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
 *   5b. set aside peaks whose verdict would rest on terrain nobody measured —
 *       a bearing the sweep asked about and got nothing for, or a range past
 *       the end of the sampled ray. Both are `unmeasured` and get NO verdict
 *       rather than one read off a horizon interpolated across the hole or a
 *       sightline examined for its first half only
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
  clearanceBandDeg,
  filterVisiblePeaks,
  isLabelled,
  isMarginalVisibility,
  isPeakVisible,
  rangeIsMeasured,
  resolveAgainstHorizon,
} from '../core/visibility.js';

import { PipelineError, throwIfAborted } from './errors.js';
import { classifyPeakOcclusion, describeOccluder, nearestRay } from './occlusion.js';
import { eyeElevationM, resolveObserver } from './observer.js';
import { buildTerrainRays, resolveSweep, sweepBearingsDeg } from './terrain.js';
import type {
  AnnotateSceneRequest,
  AnnotatedPeak,
  AnnotatedScene,
  PipelineConfig,
  ResolvedPipelineConfig,
} from './types.js';

/**
 * Peaks are looked for this far out unless the caller says otherwise.
 *
 * Deliberately much larger than `DEFAULT_SWEEP.maxRangeKm` (30 km), and no
 * longer a contradiction: a peak past the end of the sweep is REPORTED, as
 * `unmeasured` with a warning naming it, instead of being handed a `visible`
 * verdict nothing measured supports (review 2, finding 2). Asking wide and
 * refusing loudly beats asking narrow and going quiet — "Mount Rainier, not
 * judged, terrain measured to 3 km of a 97 km sightline" is a prompt to fetch
 * more tiles or widen the sweep, whereas a peak that was never looked up leaves
 * nothing behind at all.
 */
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
  const nearFieldRadiusM = config.nearFieldRadiusM ?? 0;
  if (!(nearFieldRadiusM >= 0)) {
    throw new RangeError(`nearFieldRadiusM must be >= 0, received ${nearFieldRadiusM}`);
  }
  return {
    sweep: resolveSweep(config.sweep),
    sightline: config.sightline ?? {},
    toleranceDeg,
    peakRadiusKm: config.peakRadiusKm ?? DEFAULT_PEAK_RADIUS_KM,
    minPeakDistanceKm: config.minPeakDistanceKm ?? DEFAULT_MIN_PEAK_DISTANCE_KM,
    colToleranceM,
    judgeBeyondMeasuredTerrain: config.judgeBeyondMeasuredTerrain ?? false,
    nearFieldRadiusM,
  };
}

/**
 * Half-width of the bearing window a peak's near-field band is measured over.
 *
 * A judgment call, recorded: the window must cover the interpolation bracket
 * the verdict itself read (±½ bearing step) plus the ground a laterally
 * mis-placed camera would actually find in the peak's direction — a 15 m GPS
 * error subtends atan(15/d) at the occluder, which is 15° at d ≈ 55 m and
 * shrinks with range. ±15° covers both down to that range; a still-nearer
 * occluder is under-covered, and the band is declared a floor for exactly
 * that kind of reason.
 */
export const NEAR_FIELD_BEARING_WINDOW_DEG = 15;

/** Absolute angular separation of two bearings, wrap-safe, 0–180. */
function bearingSeparationDeg(aDeg: number, bDeg: number): number {
  return Math.abs(((aDeg - bDeg + 540) % 360) - 180);
}

/**
 * The DEM's own local relief within `radiusM` of the camera, as a half-band on
 * "how high is the ground beside me", metres (P1.6, docs/NEAR-FIELD.md).
 *
 * Half the spread between the highest and lowest reading inside the radius —
 * the observer's own ground cell included, at distance zero. This is a floor,
 * not a distribution: it is the disagreement the DEM itself admits to within
 * the ground the camera might be standing near, before any allowance for what
 * a 30 m posting does to a ridge crest.
 *
 * With `towardBearingDeg` set, only rays within {@link
 * NEAR_FIELD_BEARING_WINDOW_DEG} of that bearing contribute. That is the form
 * a PEAK's verdict uses, and the restriction is load-bearing, found on the
 * first real run: the camera at Railroad Ridge stands on a ridge crest, so the
 * ground within 150 m spans 55 m of relief — almost all of it the slope
 * falling away BEHIND and BESIDE the camera, which no mis-placed position
 * could ever raise into the southward view. Charging a southward verdict with
 * the western valley's relief turned the band into ±17° and flagged summits
 * buried under kilometres of rock as "may be hidden". The ground that can
 * occlude a peak is the ground in the peak's direction; only its disagreement
 * belongs in the band. Omitting `towardBearingDeg` measures every direction —
 * the honest scene-level "how bad is the near field here" figure.
 *
 * 0 when the sweep holds no sample inside the radius (`minRangeM` excluded
 * them, or the radius is smaller than the first step) — with nothing sampled
 * there, the near field contributes no occluders either, and `rangeIsMeasured`
 * is already refusing on the caller's behalf.
 */
export function nearFieldElevationBandM(
  observerGroundElevationM: number,
  rays: readonly {
    readonly bearingDeg: number;
    readonly samples: readonly { distanceM: number; elevationM: number }[];
  }[],
  radiusM: number,
  towardBearingDeg?: number,
): number {
  if (!(radiusM > 0)) return 0;
  let sawSample = false;
  let lowestM = observerGroundElevationM;
  let highestM = observerGroundElevationM;
  for (const ray of rays) {
    if (
      towardBearingDeg !== undefined &&
      bearingSeparationDeg(ray.bearingDeg, towardBearingDeg) > NEAR_FIELD_BEARING_WINDOW_DEG
    ) {
      continue;
    }
    for (const sample of ray.samples) {
      if (sample.distanceM > radiusM) continue;
      sawSample = true;
      if (sample.elevationM < lowestM) lowestM = sample.elevationM;
      if (sample.elevationM > highestM) highestM = sample.elevationM;
    }
  }
  return sawSample ? (highestM - lowestM) / 2 : 0;
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

  // The aligner's profile: same samples, near field dropped (CV-10). Built
  // here rather than by callers so no second sweep is ever paid for it and no
  // caller can build it with different sightline options by accident.
  const alignmentHorizon: HorizonProfile | undefined =
    config.nearFieldRadiusM > 0
      ? buildHorizonProfile(
          eyeElevationM(observer),
          rays
            .map((ray) => ({
              ...ray,
              samples: ray.samples.filter(
                (raySample) => raySample.distanceM >= config.nearFieldRadiusM,
              ),
            }))
            .filter((ray) => ray.samples.length > 0),
          config.sightline,
        )
      : undefined;

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
  const unmeasuredBearing: PeakSighting[] = [];
  const unmeasuredRange: PeakSighting[] = [];
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
      unmeasuredBearing.push(sighting);
      continue;
    }
    // The same refusal on the RANGE axis. A sightline sampled for its first
    // 30 km cannot say what stands in the remaining 30: terrain there was never
    // read, occlusion only ever accumulates with more terrain, and so the run
    // has established "nothing in the swept part hides it" — which is not what
    // `visible` claims. Measured, not configured: a ray that stops short
    // because its tiles are missing is in exactly the same position as one that
    // stops short because the sweep asked for less.
    if (!config.judgeBeyondMeasuredTerrain) {
      const ray = nearestRay(rays, sighting.bearingDeg);
      if (
        ray === undefined ||
        !rangeIsMeasured(ray.samples, 0, sighting.distanceKm * 1000, config.sweep.rangeStepM)
      ) {
        unmeasuredRange.push(sighting);
        continue;
      }
    }
    sightings.push(sighting);
  }
  const unmeasured = [...unmeasuredBearing, ...unmeasuredRange];
  sightings.sort((a, b) => a.distanceKm - b.distanceKm);
  unmeasured.sort((a, b) => a.distanceKm - b.distanceKm);
  if (unmeasuredBearing.length > 0) {
    warnings.push(
      `No visible/hidden verdict for ${unmeasuredBearing.length} peak(s) on bearings the sweep ` +
        `asked about and got no terrain data for: ${describePeakNames(unmeasuredBearing)}. ` +
        'Judging them would mean measuring against a horizon interpolated across the hole.',
    );
  }
  if (unmeasuredRange.length > 0) {
    warnings.push(
      `No visible/hidden verdict for ${unmeasuredRange.length} peak(s) standing farther out than ` +
        `the terrain sweep measured (${config.sweep.maxRangeKm} km): ` +
        `${describePeakNames(unmeasuredRange)}. Their sightlines were examined for the swept ` +
        'part only, and "nothing within the swept part hides it" is not "visible". Widen ' +
        'sweep.maxRangeKm over terrain you hold, or set judgeBeyondMeasuredTerrain to accept ' +
        'partial evidence deliberately.',
    );
  }

  const eyeM = eyeElevationM(observer);
  // P1.6: the uncertainty of the ground beside the camera, measured from the
  // sweep's own near samples. Present only when the caller set a radius; with
  // none, every band below is 0 and every verdict is the pre-P1.6 one. The
  // scene-level figure spans every direction; each PEAK's band is measured
  // over the ground in ITS direction only — see nearFieldElevationBandM.
  const nearField =
    config.nearFieldRadiusM > 0
      ? {
          radiusM: config.nearFieldRadiusM,
          elevationBandM: nearFieldElevationBandM(
            observer.groundElevationM,
            rays,
            config.nearFieldRadiusM,
          ),
        }
      : undefined;
  const peaks: AnnotatedPeak[] = sightings.map((sighting) => {
    const resolved = resolveAgainstHorizon(sighting, horizon);
    const visible = isPeakVisible(resolved, config.toleranceDeg);
    // P1.6: a verdict measured against an occluder inside the near field is
    // only worth the band that occluder's height is known to. If the verdict
    // flips within it, neither side may be claimed.
    const directionalNearField =
      nearField === undefined
        ? undefined
        : {
            radiusM: nearField.radiusM,
            elevationBandM: nearFieldElevationBandM(
              observer.groundElevationM,
              rays,
              nearField.radiusM,
              sighting.bearingDeg,
            ),
          };
    const bandDeg = clearanceBandDeg(resolved.occluderDistanceKm, directionalNearField);
    const marginal = isMarginalVisibility(resolved.clearanceDeg, bandDeg, config.toleranceDeg);
    const image = projectToImage(request.camera, sighting.bearingDeg, sighting.altitudeDeg);
    // D8: an occluded summit is split by WHAT hides it — its own hill's
    // shoulder (labelled, de-emphasised) or a different landform (not drawn).
    // The visible/hidden verdict above is untouched by this; the classifier is
    // asked only about peaks that CONFIDENTLY lost. A marginal peak gets
    // neither occluder note nor classification: both presume an occlusion the
    // marginal state declines to assert.
    const confidentlyOccluded = !visible && !marginal;
    const occludedBy = confidentlyOccluded ? describeOccluder(horizon, sighting) : undefined;
    const occlusion = confidentlyOccluded
      ? classifyPeakOcclusion(eyeM, sighting, rays, {
          sampleSpacingM: config.sweep.rangeStepM,
          toleranceDeg: config.toleranceDeg,
          colToleranceM: config.colToleranceM,
          sightline: config.sightline,
        })
      : undefined;
    return {
      ...resolved,
      visible,
      visibility: marginal ? ('marginal' as const) : (occlusion?.kind ?? 'visible'),
      clearanceBandDeg: bandDeg,
      image,
      ...(occludedBy === undefined ? {} : { occludedBy }),
      ...(occlusion === undefined ? {} : { occlusion }),
    };
  });

  // Cross-check: the annotated verdicts must agree with core's own filter run
  // over the same inputs. They are computed by the same functions, so a
  // disagreement means this file grew a second opinion — fail loudly rather
  // than ship a result whose lists and flags differ. The check runs on the
  // band-free `visible` FLAG, deliberately: the marginal state reclassifies
  // presentation, and this guard proves the underlying geometry did not move.
  const filtered = filterVisiblePeaks(sightings, horizon, { toleranceDeg: config.toleranceDeg });
  const clearedCount = peaks.filter((peak) => peak.visible).length;
  if (filtered.length !== clearedCount) {
    throw new PipelineError(
      'internal-inconsistency',
      `filterVisiblePeaks kept ${filtered.length} peaks but the ` +
        `pipeline marked ${clearedCount} visible.`,
    );
  }

  const marginal = peaks.filter((peak) => peak.visibility === 'marginal');
  if (marginal.length > 0 && nearField !== undefined) {
    warnings.push(
      `${marginal.length} peak(s) get no confident verdict: their occluding terrain lies within ` +
        `${nearField.radiusM} m of the camera, where the DEM's own readings disagree by up to ` +
        `±${nearField.elevationBandM.toFixed(1)} m, and their clearance is inside that noise: ` +
        `${describePeakNames(marginal)}. They are labelled, de-emphasised — see docs/NEAR-FIELD.md.`,
    );
  }

  return {
    observer,
    observerResolution,
    camera: request.camera,
    horizon,
    ...(alignmentHorizon === undefined ? {} : { alignmentHorizon }),
    sweep: report,
    peaks,
    visible: peaks.filter((peak) => peak.visibility === 'visible'),
    occluded: peaks.filter(
      (peak) => peak.visibility === 'self-occluded' || peak.visibility === 'foreground-occluded',
    ),
    marginal,
    ...(nearField === undefined ? {} : { nearFieldUncertainty: nearField }),
    unmeasured,
    selfOccluded: peaks.filter((peak) => peak.visibility === 'self-occluded'),
    foregroundOccluded: peaks.filter((peak) => peak.visibility === 'foreground-occluded'),
    labelled: peaks.filter((peak) => isLabelled(peak.visibility)),
    warnings,
    config,
    generatedAt: clock(),
  };
}
