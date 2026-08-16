/**
 * peakService.ts
 *
 * Fetches mountain peaks from OpenStreetMap (Overpass API), annotates each
 * one with observer-relative geometry, and filters for line-of-sight
 * visibility against the terrain horizon profile from horizonCalculator.
 *
 * Pipeline
 * ────────
 *  1. Validate the observer position.
 *  2. Build and POST an Overpass QL query — fetches named peaks (nodes and
 *     way centroids) within the requested radius.
 *  3. Parse the response: extract name, coordinates, and OSM elevation tag.
 *     Ways use their centre point; both metres and feet tags are handled.
 *  4. Optionally resolve missing elevations in batch from OpenTopoData
 *     (same SRTM dataset used by horizonCalculator) so that verticalAngleDeg
 *     is meaningful even when OSM omits the `ele` tag.
 *  5. Annotate each peak with: bearingDeg, verticalAngleDeg, distanceKm.
 *     Uses elevationAngleRefracted() — the same refraction model as
 *     horizonCalculator — so the angles are directly comparable to the
 *     horizon profile without a systematic offset at long range.
 *  6. Sort by distance and cap at maxResults.
 *
 * filterVisiblePeaks()
 * ────────────────────
 *  Takes the annotated list and the HorizonPoint[] profile returned by
 *  computeHorizon(), and returns the subset of peaks that are at or above
 *  the terrain horizon line at their bearing.
 *
 *  Uses linear interpolation between the two bracketing horizon profile
 *  points (with correct 0°/360° wrap handling) rather than a nearest-
 *  neighbour lookup, so peaks near the angular midpoint between two sample
 *  bearings are classified correctly.
 *
 *  Also returns the interpolated horizon angle and clearance for each
 *  visible peak, which the UI can use to fade out peaks just cresting the
 *  ridge, or to show an "almost visible" indicator.
 */

import axios, { AxiosError, CanceledError } from 'axios';
import {
  Observer,
  HorizonPoint,
  calculateBearing,
  elevationAngleRefracted,
  haversineDistance,
} from '../utils/terrainProjection';
import { fetchElevationBatch } from '../services/elevationService';
import { CONFIG } from '../constants/config';

// ─── Error types ──────────────────────────────────────────────────────────────

export type PeakErrorCode =
  | 'INVALID_INPUT'   // observer coordinates missing or out of range
  | 'API_FAILURE'     // all retries exhausted
  | 'API_TIMEOUT'     // AbortSignal fired
  | 'EMPTY_RESPONSE'; // query succeeded but returned zero peaks

/**
 * Typed error thrown by fetchAnnotatedPeaks.
 *
 * code → suggested UI response:
 *   'INVALID_INPUT'   — bug in calling code; log and fix
 *   'API_FAILURE'     — network error; show retry button; `partial` may contain
 *                       any peaks parsed before the failure
 *   'API_TIMEOUT'     — AbortSignal cancelled; safe to ignore on navigation
 *   'EMPTY_RESPONSE'  — no OSM peaks tagged in this area; not an error per se
 */
export class PeakError extends Error {
  public readonly code: PeakErrorCode;
  /** Peaks successfully parsed before a failure occurred (may be empty). */
  public readonly partial: AnnotatedPeak[];

  constructor(code: PeakErrorCode, message: string, partial: AnnotatedPeak[] = []) {
    super(message);
    this.name = 'PeakError';
    this.code = code;
    this.partial = partial;
  }
}

// ─── Data types ───────────────────────────────────────────────────────────────

/** Where the peak's elevation value came from. */
export type ElevationSource =
  | 'osm'     // tagged directly in OpenStreetMap (ele / ele:ft)
  | 'srtm'    // fetched from OpenTopoData SRTM 90m
  | 'unknown'; // not available; verticalAngleDeg computed as if at sea level

/** A peak as returned by the Overpass API, before observer geometry is added. */
export interface RawPeak {
  /** Stable OpenStreetMap node / way ID. */
  id: string;
  name: string;
  /** English or alternative name, when tagged in OSM. */
  altName?: string;
  latitude: number;
  longitude: number;
  /** Elevation in metres (0 when source is 'unknown'). */
  elevationM: number;
  elevationSource: ElevationSource;
}

/**
 * A peak fully annotated with observer-relative geometry.
 * All angular values use the same refraction model as horizonCalculator so
 * they are directly comparable to the terrain horizon profile.
 */
export interface AnnotatedPeak extends RawPeak {
  /** Compass bearing from the observer to this peak (0–359°, 0 = North). */
  bearingDeg: number;

  /**
   * Vertical angle from the observer's eye to the peak summit (degrees).
   * Positive = above the observer's apparent horizon.
   * Negative = geometrically below it (due to Earth's curvature).
   * Computed with atmospheric refraction (k = 0.13) — matches horizonCalculator.
   */
  verticalAngleDeg: number;

  /** Great-circle surface distance from the observer to the peak (km). */
  distanceKm: number;
}

/**
 * An AnnotatedPeak that passed the filterVisiblePeaks() test, enriched with
 * the horizon angle and clearance values that determined its visibility.
 */
export interface VisiblePeak extends AnnotatedPeak {
  /**
   * The interpolated terrain horizon elevation angle at this peak's bearing
   * (degrees). This is the "skyline" — everything above this is sky.
   */
  horizonAngleDeg: number;

  /**
   * How far the peak sits above (positive) or below (negative) the skyline.
   * clearanceAngleDeg = verticalAngleDeg − horizonAngleDeg.
   * The UI can use this to fade out peaks that only just clear the ridge.
   */
  clearanceAngleDeg: number;
}

// ─── Fetch options ─────────────────────────────────────────────────────────────

export interface FetchPeaksOptions {
  /**
   * Search radius in km. Defaults to 50 km — a practical limit that returns
   * peaks visible to the naked eye under clear conditions without an
   * overwhelming number of results.
   */
  radiusKm?: number;

  /**
   * Maximum number of peaks to return after sorting.
   * Defaults to CONFIG.MAX_PEAKS_DISPLAYED.
   */
  maxResults?: number;

  /**
   * When true, peaks that lack an OSM elevation tag are batch-fetched from
   * the OpenTopoData SRTM API so that verticalAngleDeg is meaningful.
   * When false (default), such peaks have elevationSource = 'unknown' and
   * their verticalAngleDeg is computed as if the peak were at sea level.
   *
   * Set to true for the highest accuracy at the cost of one or more extra
   * API round-trips. Set to false for a faster initial load.
   */
  resolveElevations?: boolean;

  /** AbortSignal for cancellation (component unmount / position change). */
  signal?: AbortSignal;

  /**
   * Progress callback: 0 → query sent, 50 → response parsed,
   * 50–90 → elevation resolution (if enabled), 100 → done.
   */
  onProgress?: (percentComplete: number) => void;
}

export interface FilterOptions {
  /**
   * A peak whose verticalAngleDeg is within this many degrees below the
   * interpolated horizon angle is still counted as visible.
   *
   * A small non-zero value (default 0.3°) absorbs angular quantisation error
   * introduced by the horizon profile's finite angular resolution (1–2°).
   * Set to 0 for a strict geometric test.
   */
  toleranceDeg?: number;
}

// ─── API constants ────────────────────────────────────────────────────────────

const OVERPASS_TIMEOUT_S = 30;
const AXIOS_TIMEOUT_MS = 35_000; // slightly longer than Overpass server timeout
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;
const DEFAULT_RADIUS_KM = 50;

// ─── Overpass API helpers ─────────────────────────────────────────────────────

interface OverpassElement {
  id: number;
  type: 'node' | 'way' | 'relation';
  // Nodes have lat/lon at the top level; ways expose it via `center`
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

/**
 * Build an Overpass QL query for named peaks within `radiusM` metres.
 *
 * Fetches both nodes (point markers) and ways (summit-area polygons), using
 * `out center` so way elements include their centroid coordinates.
 * `qt` (quadtile) sorting is faster than the default lat-sort on large results.
 */
function buildOverpassQuery(lat: number, lng: number, radiusM: number): string {
  return (
    `[out:json][timeout:${OVERPASS_TIMEOUT_S}];` +
    `(` +
    `node["natural"="peak"]["name"](around:${radiusM},${lat},${lng});` +
    `way["natural"="peak"]["name"](around:${radiusM},${lat},${lng});` +
    `);` +
    `out body center qt;`
  );
}

/**
 * Extract elevation from OSM tags.
 *
 * OSM convention: `ele` = metres (most common); `ele:ft` = feet (used in
 * some US datasets). We also handle strings with a trailing unit suffix
 * (e.g. "4808 m", "14691 ft") as some editors produce those.
 */
function parseOsmElevation(
  tags: Record<string, string>,
): { elevationM: number; source: ElevationSource } {
  const tryParse = (raw: string | undefined, toMetres: (v: number) => number) => {
    if (!raw) return null;
    // Strip any trailing unit text and parse the numeric part
    const numeric = parseFloat(raw.replace(/[^\d.\-]/g, ''));
    return isNaN(numeric) ? null : toMetres(numeric);
  };

  const fromEle = tryParse(tags.ele, (v) => v);
  if (fromEle !== null) return { elevationM: fromEle, source: 'osm' };

  const fromElegFt = tryParse(tags['ele:ft'], (v) => v * 0.3048);
  if (fromElegFt !== null) return { elevationM: Math.round(fromElegFt), source: 'osm' };

  return { elevationM: 0, source: 'unknown' };
}

/**
 * Convert raw Overpass elements into RawPeak objects.
 * Skips elements with no usable coordinate (shouldn't happen, but defensive).
 */
function parseElements(elements: OverpassElement[]): RawPeak[] {
  const peaks: RawPeak[] = [];

  for (const el of elements) {
    // Resolve coordinates: nodes have lat/lon; ways expose them via center
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;

    const name = el.tags?.name;
    if (!name) continue; // filter unnamed (belt-and-suspenders; query already filters)

    const { elevationM, source } = parseOsmElevation(el.tags ?? {});

    peaks.push({
      id: `${el.type}/${el.id}`,
      name,
      altName: el.tags?.['name:en'] ?? el.tags?.alt_name,
      latitude: lat,
      longitude: lon,
      elevationM,
      elevationSource: source,
    });
  }

  return peaks;
}

// ─── Retry wrapper for Overpass ───────────────────────────────────────────────

/**
 * POST a query to the Overpass API, retrying up to MAX_RETRIES times.
 * Uses the same back-off strategy as horizonCalculator for consistency.
 */
async function postOverpassWithRetry(
  query: string,
  signal: AbortSignal | undefined,
): Promise<OverpassResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new PeakError('API_TIMEOUT', 'Request cancelled before attempt.');
    }

    try {
      const { data } = await axios.post<OverpassResponse>(
        CONFIG.OVERPASS_API_URL,
        `data=${encodeURIComponent(query)}`,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal,
          timeout: AXIOS_TIMEOUT_MS,
        },
      );
      return data;
    } catch (err) {
      lastError = err;

      if (err instanceof CanceledError || axios.isCancel(err)) {
        throw new PeakError('API_TIMEOUT', 'Overpass request cancelled.');
      }

      const status = (err as AxiosError).response?.status;
      const delayMs =
        status === 429
          ? RETRY_BASE_MS * 4
          : RETRY_BASE_MS * Math.pow(2, attempt);

      if (attempt < MAX_RETRIES - 1) {
        await new Promise<void>((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw new PeakError(
    'API_FAILURE',
    `Overpass API failed after ${MAX_RETRIES} attempts: ${String(lastError)}`,
  );
}

// ─── Elevation resolution ─────────────────────────────────────────────────────

/**
 * For peaks that have no OSM elevation tag, fetch terrain elevation from
 * OpenTopoData in batches, then mutate the peaks in-place.
 *
 * This makes verticalAngleDeg meaningful: a peak at "0 m" would appear
 * far below the horizon when the observer is at altitude, which would
 * incorrectly classify it as occluded.
 */
async function resolveUnknownElevations(
  peaks: RawPeak[],
  signal: AbortSignal | undefined,
  onProgress: ((pct: number) => void) | undefined,
): Promise<void> {
  const unknowns = peaks.filter((p) => p.elevationSource === 'unknown');
  if (unknowns.length === 0) return;

  // fetchElevationBatch accepts up to 100 points per call
  const BATCH = 100;
  const totalBatches = Math.ceil(unknowns.length / BATCH);

  for (let i = 0; i < unknowns.length; i += BATCH) {
    if (signal?.aborted) throw new PeakError('API_TIMEOUT', 'Elevation resolution cancelled.');

    const batch = unknowns.slice(i, i + BATCH);
    const batchIdx = Math.floor(i / BATCH);

    try {
      const results = await fetchElevationBatch(
        batch.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
      );
      results.forEach((r, j) => {
        batch[j].elevationM = r.elevationM;
        batch[j].elevationSource = 'srtm';
      });
    } catch {
      // Non-fatal: leave elevationSource as 'unknown', verticalAngleDeg will
      // be inaccurate for these peaks but the rest of the list is unaffected.
    }

    // Progress band 50–90 % is allocated to elevation resolution
    onProgress?.(50 + Math.round(((batchIdx + 1) / totalBatches) * 40));

    if (i + BATCH < unknowns.length) {
      await new Promise<void>((r) => setTimeout(r, CONFIG.API_BATCH_DELAY_MS));
    }
  }
}

// ─── Geometry annotation ──────────────────────────────────────────────────────

/**
 * Attach bearing, verticalAngleDeg, and distanceKm to a raw peak.
 *
 * elevationAngleRefracted() is used (rather than the plain elevationAngle)
 * so the angle is computed with the same atmospheric refraction correction
 * (k = 0.13) as the horizon profile built by horizonCalculator.
 * This is critical at distances > 30 km where the refraction correction
 * shifts apparent angles by several tenths of a degree.
 */
function annotate(peak: RawPeak, observer: Observer): AnnotatedPeak {
  const bearingDeg = calculateBearing(
    observer.latitude, observer.longitude,
    peak.latitude, peak.longitude,
  );
  const verticalAngleDeg = elevationAngleRefracted(
    observer,
    peak.latitude, peak.longitude,
    peak.elevationM,
  );
  const distanceKm = haversineDistance(
    observer.latitude, observer.longitude,
    peak.latitude, peak.longitude,
  );

  return { ...peak, bearingDeg, verticalAngleDeg, distanceKm };
}

// ─── Horizon interpolation ────────────────────────────────────────────────────

/**
 * Linearly interpolate the horizon elevation angle at an arbitrary bearing.
 *
 * The horizon profile is a sparse sorted array of { bearingDeg, elevAngle }
 * pairs. For a given target bearing we find the two adjacent profile points
 * that bracket it, then linearly interpolate.
 *
 * The tricky part is the 0°/360° wrap-around: bearing 359° is adjacent to
 * bearing 1°, and the angular span between them crosses the origin. This is
 * handled by treating the profile as circular — the "last" point wraps to
 * the "first" with an effective bearing of firstBearing + 360.
 *
 * Returns null only when the profile is empty.
 *
 * Exported so it can be unit-tested independently.
 */
export function interpolateHorizonAngle(
  profile: HorizonPoint[],
  bearingDeg: number,
): number | null {
  if (profile.length === 0) return null;
  if (profile.length === 1) return profile[0].elevationAngleDeg;

  // Normalise target bearing to [0, 360)
  const target = ((bearingDeg % 360) + 360) % 360;

  // Find the index of the first profile point with bearing >= target
  let hiIdx = profile.findIndex((p) => p.bearingDeg >= target);

  if (hiIdx === -1) {
    // target is beyond the last profile bearing → wrap: upper = first point
    // treated as if it were at firstBearing + 360
    hiIdx = 0;
  }

  const loIdx = (hiIdx - 1 + profile.length) % profile.length;

  const lo = profile[loIdx];
  const hi = profile[hiIdx];

  // Exact hit on a profile bearing
  if (lo.bearingDeg === target) return lo.elevationAngleDeg;
  if (hi.bearingDeg === target) return hi.elevationAngleDeg;

  // Angular span from lo → hi in the clockwise direction.
  // Must be positive; add 360 when hi has wrapped to a lower bearing number.
  let span = hi.bearingDeg - lo.bearingDeg;
  if (span <= 0) span += 360;

  // Distance from lo → target in the same clockwise direction
  let dist = target - lo.bearingDeg;
  if (dist < 0) dist += 360;

  // t ∈ [0, 1]: 0 = exactly at lo, 1 = exactly at hi
  const t = dist / span;

  return lo.elevationAngleDeg + t * (hi.elevationAngleDeg - lo.elevationAngleDeg);
}

// ─── Public: fetch ────────────────────────────────────────────────────────────

/**
 * Fetch and annotate all named mountain peaks within `radiusKm` of the
 * observer, enriching each one with bearing, vertical angle, and distance.
 *
 * @param observer  The observer's position and elevation (from horizonCalculator
 *                  or directly from GPS + eye-height offset).
 * @param options   Radius, result cap, elevation resolution, cancellation.
 * @returns         Annotated peaks sorted by distance (nearest first),
 *                  capped at `maxResults`.
 *
 * @throws {PeakError} with code:
 *   'INVALID_INPUT'   — coordinates missing or out of range
 *   'API_FAILURE'     — Overpass unavailable after MAX_RETRIES
 *   'API_TIMEOUT'     — AbortSignal fired (safe to ignore on nav changes)
 *   'EMPTY_RESPONSE'  — query succeeded but no named peaks found in area
 *
 * @example
 * ```ts
 * const controller = new AbortController();
 *
 * const peaks = await fetchAnnotatedPeaks(observer, {
 *   radiusKm: 50,
 *   resolveElevations: true,
 *   signal: controller.signal,
 *   onProgress: setLoadingPct,
 * });
 * ```
 */
export async function fetchAnnotatedPeaks(
  observer: Observer,
  options: FetchPeaksOptions = {},
): Promise<AnnotatedPeak[]> {
  const {
    radiusKm = DEFAULT_RADIUS_KM,
    maxResults = CONFIG.MAX_PEAKS_DISPLAYED,
    resolveElevations = false,
    signal,
    onProgress,
  } = options;

  // ── 1. Validate ─────────────────────────────────────────────────────────
  if (
    observer.latitude == null || observer.longitude == null ||
    observer.latitude < -90 || observer.latitude > 90 ||
    observer.longitude < -180 || observer.longitude > 180
  ) {
    throw new PeakError('INVALID_INPUT', 'Observer coordinates are missing or out of range.');
  }
  if (radiusKm <= 0 || radiusKm > 500) {
    throw new PeakError('INVALID_INPUT', `radiusKm must be between 0 and 500; got ${radiusKm}.`);
  }

  onProgress?.(0);

  // ── 2. Fetch from Overpass ───────────────────────────────────────────────
  const query = buildOverpassQuery(observer.latitude, observer.longitude, radiusKm * 1000);
  const response = await postOverpassWithRetry(query, signal);

  onProgress?.(50);

  // ── 3. Parse ─────────────────────────────────────────────────────────────
  const rawPeaks = parseElements(response.elements);

  if (rawPeaks.length === 0) {
    throw new PeakError(
      'EMPTY_RESPONSE',
      `No named peaks found within ${radiusKm} km. ` +
      'The area may have sparse OSM coverage, or all peaks may be unnamed.',
    );
  }

  // ── 4. Optionally resolve missing elevations ─────────────────────────────
  if (resolveElevations) {
    await resolveUnknownElevations(rawPeaks, signal, onProgress);
  }

  onProgress?.(90);

  // ── 5. Annotate with observer geometry ──────────────────────────────────
  const annotated = rawPeaks.map((peak) => annotate(peak, observer));

  // ── 6. Sort by distance, cap ─────────────────────────────────────────────
  // Nearest-first is most useful for AR overlays (closest peaks are biggest
  // and most likely to block the view; further peaks fill the label layer).
  const result = annotated
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, maxResults);

  onProgress?.(100);
  return result;
}

// ─── Public: visibility filter ────────────────────────────────────────────────

/**
 * Filter an annotated peak list to those visible above the terrain horizon.
 *
 * A peak is considered visible when:
 *   peak.verticalAngleDeg >= interpolatedHorizonAngle(peak.bearingDeg) − toleranceDeg
 *
 * The horizon angle is linearly interpolated between the two adjacent
 * HorizonPoint entries that bracket the peak's bearing (see
 * interpolateHorizonAngle for the exact arithmetic). This avoids the
 * nearest-neighbour quantisation error that would misclassify peaks
 * sitting angularly between two profile samples.
 *
 * Peaks in a direction with no horizon data (empty profile) are assumed
 * visible — we show rather than hide when uncertain.
 *
 * @param peaks          Output of fetchAnnotatedPeaks().
 * @param horizonProfile Output of computeHorizon().profile from horizonCalculator.
 * @param options        toleranceDeg (default 0.3°).
 * @returns              Visible peaks, preserving input order, each enriched
 *                       with horizonAngleDeg and clearanceAngleDeg.
 *
 * @example
 * ```ts
 * const visible = filterVisiblePeaks(peaks, horizonResult.profile);
 * // visible[0].clearanceAngleDeg > 0  → clearly above the skyline
 * // visible[0].clearanceAngleDeg ≈ 0  → just cresting the ridge
 * ```
 */
export function filterVisiblePeaks(
  peaks: AnnotatedPeak[],
  horizonProfile: HorizonPoint[],
  options: FilterOptions = {},
): VisiblePeak[] {
  const { toleranceDeg = 0.3 } = options;

  const visible: VisiblePeak[] = [];

  for (const peak of peaks) {
    const horizonAngleDeg = interpolateHorizonAngle(horizonProfile, peak.bearingDeg);

    // No horizon data for this bearing → assume visible
    if (horizonAngleDeg === null) {
      visible.push({
        ...peak,
        horizonAngleDeg: 0,
        clearanceAngleDeg: peak.verticalAngleDeg,
      });
      continue;
    }

    const clearanceAngleDeg = peak.verticalAngleDeg - horizonAngleDeg;

    // Peak is visible if it sits at or above the horizon (within tolerance)
    if (clearanceAngleDeg >= -toleranceDeg) {
      visible.push({ ...peak, horizonAngleDeg, clearanceAngleDeg });
    }
  }

  return visible;
}
