/**
 * horizonCalculator.ts
 *
 * Computes the terrain horizon silhouette visible from a GPS position and
 * optional compass bearing.
 *
 * Pipeline
 * ────────
 *  1. Validate input — detect missing GPS, poor accuracy (indoors), bad bearing.
 *  2. Resolve observer elevation — use GPS altitude when reliable; otherwise
 *     fetch the SRTM value at the observer's exact coordinate.
 *  3. Generate sample grid — cast rays outward at configurable angular and
 *     distance intervals. In "focused" mode (compass bearing given) the rays
 *     are denser and restricted to the visible FOV; in "full" mode they cover
 *     all 360°.
 *  4. Fetch terrain elevation — call OpenTopoData in batches of 100 with
 *     automatic retry (exponential back-off) and cancellation support.
 *  5. Line-of-sight sweep — walk each ray near → far, maintaining a running
 *     "skyline angle". A terrain point is on the visible horizon only when it
 *     raises the skyline, i.e. it is not occluded by closer terrain.
 *  6. Atmospheric refraction correction — uses an effective Earth radius of
 *     R / (1 − k), k = 0.13, so distant objects appear slightly higher than
 *     the pure geometric model would predict.
 *  7. Return a sorted { bearingDeg, elevationAngleDeg }[] profile plus
 *     diagnostic metadata and any non-fatal warnings.
 *
 * All public functions are async and throw typed HorizonError on failure.
 */

import axios, { AxiosError, CanceledError } from 'axios';
import {
  Observer,
  HorizonPoint,
  ElevationSample,
  haversineDistance,
  destinationPoint,
  elevationAngleRefracted,
  EARTH_RADIUS_EFF_KM,
} from '../utils/terrainProjection';
import { CONFIG } from '../constants/config';

// ─── API & retry constants ────────────────────────────────────────────────────

/** OpenTopoData hard limit: max coordinates per single GET request. */
const BATCH_SIZE = 100;

/** Maximum retry attempts before a batch is declared failed. */
const MAX_RETRIES = 3;

/**
 * Base delay in ms for exponential back-off.
 * Delays are: 1 s, 2 s, 4 s for attempts 0, 1, 2.
 * On HTTP 429 (rate-limited) we use 4× the base to be polite.
 */
const RETRY_BASE_MS = 1_000;

/** Per-batch HTTP timeout (ms). Prevents indefinite hangs on poor connections. */
const BATCH_TIMEOUT_MS = 15_000;

// ─── Sample-grid constants ────────────────────────────────────────────────────

/**
 * Distances along each bearing ray (km), ordered near → far.
 *
 * Dense spacing close in (0.5–3 km) catches local ridgelines that would
 * otherwise occlude distant peaks. Sparse beyond 30 km trades accuracy for
 * fewer API calls, which is acceptable at long range.
 */
const RAY_DISTANCES_KM = [0.5, 1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 75, 100] as const;

/** Angular step between rays in full-360° mode (degrees). */
const FULL_CIRCLE_RESOLUTION_DEG = 2;

/**
 * Angular step between rays in focused (FOV) mode (degrees).
 * Finer than full-circle because we cover far fewer bearings.
 */
const FOCUSED_RESOLUTION_DEG = 1;

/** Extra angular margin added on each side of the camera FOV (degrees). */
const FOV_MARGIN_DEG = 10;

/**
 * GPS horizontal accuracy threshold (metres).
 * Above this we warn the caller. Devices typically report > 30 m
 * accuracy indoors or when under heavy canopy / in urban canyons.
 */
const GPS_POOR_ACCURACY_THRESHOLD_M = 30;

// ─── Error types ──────────────────────────────────────────────────────────────

export type HorizonErrorCode =
  | 'NO_GPS'          // latitude/longitude not provided at all
  | 'POOR_GPS'        // GPS accuracy too low (indoors / weak signal)
  | 'INVALID_BEARING' // bearing value outside [0, 360)
  | 'API_FAILURE'     // all retries exhausted on one or more batches
  | 'API_TIMEOUT';    // AbortSignal cancelled the request mid-flight

/**
 * Structured error thrown by computeHorizon on non-recoverable failures.
 *
 * Check `code` to decide how to present the error to the user:
 *
 *   'NO_GPS'          → prompt the user to enable Location Services
 *   'POOR_GPS'        → "You may be indoors — move to an open area"
 *   'INVALID_BEARING' → bug in calling code (bearing out of range)
 *   'API_FAILURE'     → network error; show retry button; `partial` may
 *                       contain a degraded profile from successful batches
 *   'API_TIMEOUT'     → user navigated away; safe to ignore
 */
export class HorizonError extends Error {
  public readonly code: HorizonErrorCode;

  /**
   * Any horizon profile computed before the failure occurred.
   * May be an empty array. Allows the caller to render a degraded
   * silhouette rather than showing nothing at all.
   */
  public readonly partial: HorizonPoint[];

  constructor(
    code: HorizonErrorCode,
    message: string,
    partial: HorizonPoint[] = [],
  ) {
    super(message);
    this.name = 'HorizonError';
    this.code = code;
    this.partial = partial;
  }
}

// ─── Public I/O types ─────────────────────────────────────────────────────────

export interface HorizonInput {
  /** WGS-84 latitude in degrees. Required. */
  latitude: number;

  /** WGS-84 longitude in degrees. Required. */
  longitude: number;

  /**
   * GPS horizontal accuracy in metres, as reported by the device.
   * Used to detect indoor / poor-signal conditions.
   * If omitted, accuracy is assumed to be good.
   */
  gpsAccuracyM?: number;

  /**
   * GPS altitude in metres above sea level (WGS-84 ellipsoid).
   * When provided and positive, the module skips the SRTM observer-elevation
   * lookup (saving one API call and ~250 ms).
   * GPS altitude is typically accurate to ± 3× the horizontal accuracy, so
   * a fresh clear-sky fix is needed for this to be reliable.
   */
  gpsAltitudeM?: number;

  /**
   * The compass direction the user is currently facing (0–359°, 0 = North).
   *
   * When supplied, sample rays are concentrated within this bearing ± fovDeg/2
   * at finer angular resolution. This reduces total API calls from ~13 batches
   * (full circle) to ~6 batches while doubling angular resolution in the
   * visible direction. Ideal for real-time updates as the user pans.
   *
   * Omit to compute a full 360° profile (used for the initial load or when
   * the compass is unavailable).
   */
  compassBearingDeg?: number;

  /**
   * Horizontal field of view to cover around `compassBearingDeg` (degrees).
   * Defaults to CONFIG.CAMERA_HFOV. Only used when compassBearingDeg is set.
   * A 10° margin is automatically added on each side.
   */
  fovDeg?: number;

  /**
   * AbortSignal to cancel in-flight requests (e.g. on component unmount or
   * when the user has moved far enough to warrant a fresh fetch).
   */
  signal?: AbortSignal;

  /**
   * Progress callback, called with a value from 0 to 100.
   *
   * Approximate milestones:
   *   0   → computation started
   *  10   → observer elevation resolved
   *  10–90 → elevation batches arriving (linear with batch count)
   *  90   → all API calls done; running LoS sweep
   * 100   → profile ready
   */
  onProgress?: (percentComplete: number) => void;
}

export interface HorizonResult {
  /**
   * The terrain horizon silhouette, sorted by bearingDeg (ascending).
   *
   * Each entry represents the highest terrain elevation angle visible from
   * the observer in that compass direction — everything above this line is
   * "sky"; everything below is terrain (or occluded by terrain).
   *
   * Bearings with no sample data are absent from the array; interpolate
   * between neighbours when rendering a continuous line.
   */
  profile: HorizonPoint[];

  /** Terrain elevation at the observer's exact position (metres, MSL). */
  observerElevationM: number;

  /** Total number of elevation points fetched from the API. */
  sampleCount: number;

  /** Whether the profile covers all 360° or a focused arc. */
  coverage: 'full' | 'focused';

  /** Quality of the GPS fix used for computation. */
  gpsQuality: 'good' | 'poor' | 'estimated';

  /**
   * Non-fatal warnings raised during computation.
   * Present these to the user as informational messages, not errors.
   * Examples: "GPS accuracy poor", "1 API batch used fallback elevation".
   */
  warnings: string[];
}

// ─── Internal type ────────────────────────────────────────────────────────────

/** An elevation sample point tagged with which ray it belongs to. */
interface RaySample {
  bearingDeg: number;    // ray index (integer compass degree)
  distanceKm: number;    // distance from observer along this ray
  latitude: number;
  longitude: number;
  elevationM: number;    // filled in after the API fetch
}

// ─── Step 1: Input validation ─────────────────────────────────────────────────

interface ValidationResult {
  warnings: string[];
  gpsQuality: HorizonResult['gpsQuality'];
}

/**
 * Validates the input object and derives an initial GPS quality rating.
 * Throws HorizonError for hard failures; returns warnings for soft ones.
 */
function validateInput(input: HorizonInput): ValidationResult {
  const warnings: string[] = [];
  let gpsQuality: HorizonResult['gpsQuality'] = 'good';

  // Hard failure: coordinates missing entirely
  if (input.latitude == null || input.longitude == null) {
    throw new HorizonError(
      'NO_GPS',
      'No GPS coordinates provided. Ensure Location Services are enabled.',
    );
  }

  // Hard failure: coordinates out of valid WGS-84 range
  if (
    input.latitude < -90 || input.latitude > 90 ||
    input.longitude < -180 || input.longitude > 180
  ) {
    throw new HorizonError(
      'NO_GPS',
      `GPS coordinates (${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}) ` +
      'are outside the valid WGS-84 range. The fix is likely invalid.',
    );
  }

  // Soft warning: poor GPS accuracy (common indoors or under canopy)
  if (input.gpsAccuracyM != null && input.gpsAccuracyM > GPS_POOR_ACCURACY_THRESHOLD_M) {
    warnings.push(
      `GPS accuracy is ${Math.round(input.gpsAccuracyM)} m ` +
      `(threshold: ${GPS_POOR_ACCURACY_THRESHOLD_M} m). ` +
      'You may be indoors or have a weak signal — move to an open area for best results.',
    );
    gpsQuality = 'poor';
  }

  // Hard failure: bearing value is out of range
  if (
    input.compassBearingDeg != null &&
    (input.compassBearingDeg < 0 || input.compassBearingDeg >= 360)
  ) {
    throw new HorizonError(
      'INVALID_BEARING',
      `Compass bearing ${input.compassBearingDeg}° is outside [0, 360). ` +
      'Normalise the magnetometer output before calling computeHorizon.',
    );
  }

  return { warnings, gpsQuality };
}

// ─── Step 2: Observer elevation ───────────────────────────────────────────────

/**
 * Resolve the terrain elevation at the observer's position.
 *
 * Prefers the GPS altitude when it is provided and positive (which skips a
 * network round-trip). Falls back to an SRTM lookup via OpenTopoData.
 *
 * Returns the terrain elevation in metres (eye height is added by the caller).
 */
async function resolveObserverElevation(
  latitude: number,
  longitude: number,
  gpsAltitudeM: number | undefined,
  signal: AbortSignal | undefined,
): Promise<{ elevationM: number; wasEstimated: boolean }> {
  // Use GPS altitude if available
  if (gpsAltitudeM != null && gpsAltitudeM > 0) {
    return { elevationM: gpsAltitudeM, wasEstimated: false };
  }

  // Fetch from SRTM
  try {
    const samples = await fetchBatchWithRetry(
      [{ latitude, longitude }],
      signal,
      /* batchIndex= */ -1, // sentinel: used in error messages
    );
    return { elevationM: samples[0].elevationM, wasEstimated: true };
  } catch (err) {
    // Propagate cancellation and API errors with meaningful messages
    if (err instanceof HorizonError) throw err;
    throw new HorizonError(
      'API_FAILURE',
      `Could not fetch observer elevation: ${String(err)}`,
    );
  }
}

// ─── Step 3: Sample grid generation ──────────────────────────────────────────

/**
 * Build the full set of (bearing, distance) pairs to sample.
 *
 * Focused mode (compassBearingDeg provided):
 *   • Covers compassBearingDeg ± (fovDeg/2 + FOV_MARGIN_DEG)
 *   • Angular resolution: FOCUSED_RESOLUTION_DEG (1°)
 *   • Roughly 60°+20° = 80 bearings × 13 distances = 1 040 points
 *
 * Full-circle mode (no compassBearingDeg):
 *   • Covers 0–358° at FULL_CIRCLE_RESOLUTION_DEG (2°)
 *   • 180 bearings × 13 distances = 2 340 points → ~24 batches
 */
function generateRaySamples(
  observerLat: number,
  observerLng: number,
  compassBearingDeg: number | undefined,
  fovDeg: number,
): RaySample[] {
  const samples: RaySample[] = [];
  const distances = RAY_DISTANCES_KM;

  let bearings: number[];

  if (compassBearingDeg != null) {
    // Focused mode: enumerate every integer degree within the FOV + margin
    const halfSpan = fovDeg / 2 + FOV_MARGIN_DEG;
    const step = FOCUSED_RESOLUTION_DEG;
    const rawBearings = new Set<number>();

    for (let dAz = -halfSpan; dAz <= halfSpan; dAz += step) {
      // Wrap into [0, 360)
      const b = ((compassBearingDeg + dAz) % 360 + 360) % 360;
      rawBearings.add(Math.round(b) % 360);
    }

    bearings = Array.from(rawBearings).sort((a, b) => a - b);
  } else {
    // Full-circle mode
    bearings = Array.from(
      { length: Math.floor(360 / FULL_CIRCLE_RESOLUTION_DEG) },
      (_, i) => i * FULL_CIRCLE_RESOLUTION_DEG,
    );
  }

  for (const bearing of bearings) {
    for (const dist of distances) {
      const { latitude, longitude } = destinationPoint(
        observerLat, observerLng, bearing, dist,
      );
      samples.push({
        bearingDeg: bearing,
        distanceKm: dist,
        latitude,
        longitude,
        elevationM: 0, // populated in Step 4
      });
    }
  }

  return samples;
}

// ─── Step 4: Batched API fetching ─────────────────────────────────────────────

// OpenTopoData API response shape
interface OpenTopoResult {
  location: { lat: number; lng: number };
  elevation: number | null;
}

/**
 * Fetch elevation for up to BATCH_SIZE coordinates in a single API call.
 * Retries up to MAX_RETRIES times with exponential back-off.
 *
 * @param points     The coordinates to fetch.
 * @param signal     Optional AbortSignal for cancellation.
 * @param batchIndex Used only in error messages.
 */
async function fetchBatchWithRetry(
  points: Array<{ latitude: number; longitude: number }>,
  signal: AbortSignal | undefined,
  batchIndex: number,
): Promise<ElevationSample[]> {
  // Build the pipe-delimited location string required by OpenTopoData
  const locations = points
    .map((p) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`)
    .join('|');

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Honour cancellation before each attempt so we don't start work that
    // will immediately be discarded (important for quick navigation changes).
    if (signal?.aborted) {
      throw new HorizonError('API_TIMEOUT', 'Request cancelled before attempt.');
    }

    try {
      const { data } = await axios.get<{ results: OpenTopoResult[] }>(
        `${CONFIG.ELEVATION_API_BASE}/${CONFIG.ELEVATION_DATASET}`,
        {
          params: { locations },
          signal,
          timeout: BATCH_TIMEOUT_MS,
        },
      );

      // Map results back to our ElevationSample type.
      // OpenTopoData preserves request order, so index mapping is safe.
      return data.results.map((r) => ({
        latitude: r.location.lat,
        longitude: r.location.lng,
        // Treat null elevation (ocean / no data) as sea level (0 m)
        elevationM: r.elevation ?? 0,
      }));

    } catch (err) {
      lastError = err;

      // Cancellation is not retriable — propagate immediately
      if (
        err instanceof CanceledError ||
        axios.isCancel(err) ||
        (err as Error).name === 'AbortError'
      ) {
        throw new HorizonError('API_TIMEOUT', 'Request cancelled mid-flight.');
      }

      const httpStatus = (err as AxiosError).response?.status;

      // Choose back-off delay:
      //   HTTP 429 (rate limited) → wait 4× base (4 s)
      //   Other errors           → standard exponential (1 s, 2 s, 4 s)
      const delayMs =
        httpStatus === 429
          ? RETRY_BASE_MS * 4
          : RETRY_BASE_MS * Math.pow(2, attempt);

      if (attempt < MAX_RETRIES - 1) {
        await delay(delayMs);
      }
    }
  }

  throw new HorizonError(
    'API_FAILURE',
    `Batch ${batchIndex} failed after ${MAX_RETRIES} attempts. ` +
    `Last error: ${String(lastError)}`,
  );
}

/**
 * Populate the `elevationM` field on every RaySample by fetching from
 * OpenTopoData in BATCH_SIZE chunks.
 *
 * On partial API failure (some batches succeed, some fail):
 *   • Failed samples are filled with `fallbackElevM` (the observer's elevation).
 *     This is conservative: it assumes the terrain is flat at the observer's
 *     altitude, which will under-estimate occlusion. Better than crashing.
 *   • A non-fatal warning is appended for each failed batch.
 *   • Progress is reported linearly across all batches (10 % → 90 %).
 */
async function fetchAllElevations(
  samples: RaySample[],
  fallbackElevM: number,
  signal: AbortSignal | undefined,
  onProgress: ((pct: number) => void) | undefined,
  warnings: string[],
): Promise<void> {
  const totalBatches = Math.ceil(samples.length / BATCH_SIZE);
  let doneBatches = 0;

  for (let i = 0; i < samples.length; i += BATCH_SIZE) {
    const batchSamples = samples.slice(i, i + BATCH_SIZE);
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1; // 1-based for messages

    try {
      const results = await fetchBatchWithRetry(batchSamples, signal, batchIndex);

      // API returns results in the same order as the request
      results.forEach((r, j) => {
        batchSamples[j].elevationM = r.elevationM;
      });

    } catch (err) {
      // Cancellation must propagate immediately — don't degrade, just stop
      if (err instanceof HorizonError && err.code === 'API_TIMEOUT') throw err;

      // Other failures: fill with fallback and record a warning
      batchSamples.forEach((s) => { s.elevationM = fallbackElevM; });
      warnings.push(
        `Elevation batch ${batchIndex}/${totalBatches} failed — ` +
        'using observer altitude as fallback. Horizon may be less accurate.',
      );
    }

    doneBatches++;

    // Report progress in the 10–90 % band (observer elevation used 0–10 %)
    onProgress?.(10 + Math.round((doneBatches / totalBatches) * 80));

    // Rate-limit pause between batches — skip after the final one
    if (i + BATCH_SIZE < samples.length) {
      await delay(CONFIG.API_BATCH_DELAY_MS);
    }
  }
}

// ─── Step 5 & 6: Line-of-sight sweep with refraction ─────────────────────────
// elevationAngleRefracted() is imported from terrainProjection — shared with
// peakService so both modules use an identical physical model.

/**
 * Walk each ray near → far and compute the visible horizon angle.
 *
 * Line-of-sight (LoS) model:
 *   Imagine standing at the observer and looking along a given compass bearing.
 *   As you sweep your gaze from the ground to the sky at that bearing, the
 *   first terrain feature you see sets the "skyline angle". Anything at the
 *   same bearing but at a lower elevation angle is hidden behind that feature.
 *
 *   Algorithmically, for each ray we maintain:
 *     maxSkylineAngle = the highest elevation angle seen so far (near → far)
 *
 *   For each sample along the ray (in distance order):
 *     • Compute its elevation angle from the observer.
 *     • If angle > maxSkylineAngle → this point is visible and raises the
 *       skyline. Update maxSkylineAngle.
 *     • Otherwise → this point is occluded by closer terrain; skip it.
 *
 *   The final maxSkylineAngle for each bearing is the elevation angle of the
 *   visible horizon in that direction. This is what we draw on screen.
 *
 * Returns one HorizonPoint per ray, sorted by bearingDeg (ascending).
 */
function computeLineOfSightProfile(
  observer: Observer,
  samples: RaySample[],
): HorizonPoint[] {
  // Group samples by bearing, then sort each group near → far
  const rayMap = new Map<number, RaySample[]>();
  for (const s of samples) {
    const ray = rayMap.get(s.bearingDeg) ?? [];
    ray.push(s);
    rayMap.set(s.bearingDeg, ray);
  }

  const profile: HorizonPoint[] = [];

  for (const [bearingDeg, raySamples] of rayMap) {
    // Sort near → far — essential for the LoS sweep to work correctly
    raySamples.sort((a, b) => a.distanceKm - b.distanceKm);

    // Start below any possible terrain — every first sample will update this
    let maxSkylineAngle = -90;

    for (const sample of raySamples) {
      const angle = elevationAngleRefracted(
        observer,
        sample.latitude,
        sample.longitude,
        sample.elevationM,
      );

      // Raise the skyline whenever we encounter a visible, higher point
      if (angle > maxSkylineAngle) {
        maxSkylineAngle = angle;
      }
      // Points that don't raise the skyline are occluded — nothing to do
    }

    profile.push({ bearingDeg, elevationAngleDeg: maxSkylineAngle });
  }

  // Sort by bearing so downstream consumers can do binary search / interpolation
  return profile.sort((a, b) => a.bearingDeg - b.bearingDeg);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Promisified setTimeout (avoids ESLint no-restricted-globals issues). */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ─── Main public API ──────────────────────────────────────────────────────────

/**
 * Compute the terrain horizon silhouette visible from the given position.
 *
 * @param input  Observer position, optional compass bearing, and fetch options.
 * @returns      Sorted horizon profile + diagnostic metadata.
 *
 * @throws {HorizonError} with code:
 *   'NO_GPS'          — latitude/longitude missing or out of range
 *   'POOR_GPS'        — never thrown (poor GPS is downgraded to a warning)
 *   'INVALID_BEARING' — compassBearingDeg outside [0, 360)
 *   'API_FAILURE'     — all retries exhausted; partial profile in error.partial
 *   'API_TIMEOUT'     — AbortSignal fired; safe to ignore on navigation changes
 *
 * @example
 * ```ts
 * // Real-time focused update as the user pans:
 * const { profile, warnings } = await computeHorizon({
 *   latitude: 46.853,
 *   longitude: 10.126,
 *   gpsAccuracyM: 8,
 *   gpsAltitudeM: 2650,
 *   compassBearingDeg: 220,
 *   fovDeg: 60,
 *   signal: abortController.signal,
 *   onProgress: (pct) => setProgress(pct),
 * });
 *
 * // Initial full-circle load on app start:
 * const fullProfile = await computeHorizon({
 *   latitude: 46.853,
 *   longitude: 10.126,
 * });
 * ```
 */
export async function computeHorizon(
  input: HorizonInput,
): Promise<HorizonResult> {

  // ── 1. Validate ─────────────────────────────────────────────────────────
  const { warnings, gpsQuality } = validateInput(input);

  const {
    latitude,
    longitude,
    gpsAltitudeM,
    compassBearingDeg,
    fovDeg = CONFIG.CAMERA_HFOV,
    signal,
    onProgress,
  } = input;

  onProgress?.(0);

  // ── 2. Resolve observer elevation ────────────────────────────────────────
  const { elevationM: terrainElevM, wasEstimated } = await resolveObserverElevation(
    latitude, longitude, gpsAltitudeM, signal,
  );

  // Demote GPS quality if we had to fetch elevation from the API instead of
  // using the device GPS altitude (the result is less precise)
  const resolvedGpsQuality: HorizonResult['gpsQuality'] =
    wasEstimated && gpsQuality === 'good' ? 'estimated' : gpsQuality;

  // Add eye height — the observer is standing, not lying on the ground
  const observer: Observer = {
    latitude,
    longitude,
    elevationM: terrainElevM + CONFIG.OBSERVER_EYE_HEIGHT_M,
  };

  onProgress?.(10);

  // ── 3. Generate sample grid ──────────────────────────────────────────────
  const samples = generateRaySamples(latitude, longitude, compassBearingDeg, fovDeg);

  // ── 4. Fetch elevations in batches ───────────────────────────────────────
  await fetchAllElevations(samples, terrainElevM, signal, onProgress, warnings);

  onProgress?.(90);

  // ── 5 & 6. Line-of-sight sweep (with refraction baked in) ───────────────
  const profile = computeLineOfSightProfile(observer, samples);

  onProgress?.(100);

  return {
    profile,
    observerElevationM: terrainElevM,
    sampleCount: samples.length,
    coverage: compassBearingDeg != null ? 'focused' : 'full',
    gpsQuality: resolvedGpsQuality,
    warnings,
  };
}

/**
 * Convenience: compute a focused horizon for the current compass heading.
 *
 * Wraps computeHorizon with the common real-time-update pattern: abort
 * the previous call when a new heading arrives, and only cover the FOV
 * the user is currently looking at.
 *
 * Typical usage in a React component:
 * ```ts
 * const controllerRef = useRef<AbortController | null>(null);
 *
 * useEffect(() => {
 *   controllerRef.current?.abort();
 *   controllerRef.current = new AbortController();
 *
 *   computeFocusedHorizon(location, heading, controllerRef.current.signal)
 *     .then(setProfile)
 *     .catch((err) => {
 *       if (err instanceof HorizonError && err.code === 'API_TIMEOUT') return;
 *       setError(err);
 *     });
 * }, [location, heading]);
 * ```
 */
export async function computeFocusedHorizon(
  location: { latitude: number; longitude: number; gpsAccuracyM?: number; gpsAltitudeM?: number },
  compassBearingDeg: number,
  signal?: AbortSignal,
  onProgress?: (pct: number) => void,
): Promise<HorizonResult> {
  return computeHorizon({
    ...location,
    compassBearingDeg,
    fovDeg: CONFIG.CAMERA_HFOV,
    signal,
    onProgress,
  });
}
