/**
 * elevationService.ts
 *
 * Fetches terrain elevation data from the free OpenTopoData SRTM API.
 * https://www.opentopodata.org/
 *
 * Quota: 1 call/s, 100 locations/call for the public endpoint.
 * All sampling points for the 360° horizon profile are batched to stay within limits.
 */

import axios from 'axios';
import { CONFIG } from '../constants/config';
import { destinationPoint, ElevationSample } from '../utils/terrainProjection';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LatLng {
  latitude: number;
  longitude: number;
}

interface OpenTopoResult {
  location: { lat: number; lng: number };
  elevation: number | null;
}

// ─── Low-level API call ───────────────────────────────────────────────────────

/**
 * Fetch elevation for up to 100 coordinates in a single HTTP request.
 * Returns results in the same order as `points`.
 */
export async function fetchElevationBatch(
  points: LatLng[],
): Promise<ElevationSample[]> {
  if (points.length === 0) return [];

  const locations = points
    .map((p) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`)
    .join('|');

  const { data } = await axios.get<{ results: OpenTopoResult[] }>(
    `${CONFIG.ELEVATION_API_BASE}/${CONFIG.ELEVATION_DATASET}`,
    { params: { locations } },
  );

  return data.results.map((r) => ({
    latitude: r.location.lat,
    longitude: r.location.lng,
    elevationM: r.elevation ?? 0,
  }));
}

// ─── Observer elevation ───────────────────────────────────────────────────────

/**
 * Fetch the terrain elevation at a single point (the user's position).
 * Used when GPS altitude is unavailable or inaccurate.
 */
export async function fetchObserverElevation(
  latitude: number,
  longitude: number,
): Promise<number> {
  const results = await fetchElevationBatch([{ latitude, longitude }]);
  return results[0]?.elevationM ?? 0;
}

// ─── Horizon sample grid ──────────────────────────────────────────────────────

/**
 * Build a list of sample coordinates that cover the full 360° horizon.
 *
 * For each bearing (every `angularResolutionDeg` degrees) we place one sample
 * at each distance in `distancesKm`.  The resulting elevation angles form the
 * terrain silhouette.
 *
 * With defaults (2° resolution, 7 distances) this produces 180 × 7 = 1 260
 * points (13 batches of 100).
 */
export function generateHorizonSamplePoints(
  observerLat: number,
  observerLng: number,
  angularResolutionDeg = CONFIG.HORIZON_ANGULAR_RESOLUTION_DEG,
  distancesKm = CONFIG.HORIZON_SAMPLE_DISTANCES_KM,
): LatLng[] {
  const points: LatLng[] = [];
  for (let bearing = 0; bearing < 360; bearing += angularResolutionDeg) {
    for (const dist of distancesKm) {
      points.push(destinationPoint(observerLat, observerLng, bearing, dist));
    }
  }
  return points;
}

/**
 * Fetch elevation for every horizon sample point, batching requests of 100
 * and inserting a short delay between batches to respect the API rate limit.
 */
export async function fetchHorizonElevations(
  observerLat: number,
  observerLng: number,
): Promise<ElevationSample[]> {
  const points = generateHorizonSamplePoints(observerLat, observerLng);
  const results: ElevationSample[] = [];

  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100);
    const batchResults = await fetchElevationBatch(batch);
    results.push(...batchResults);

    // Polite pause between requests (free public API)
    if (i + 100 < points.length) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, CONFIG.API_BATCH_DELAY_MS),
      );
    }
  }

  return results;
}
