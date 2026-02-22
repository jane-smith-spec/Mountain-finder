/**
 * useTerrainData.ts
 *
 * Orchestrates all terrain/peak data fetching.  When the user's position
 * changes by more than REFETCH_THRESHOLD_KM the hook:
 *   1. Fetches observer elevation (falls back to GPS altitude).
 *   2. Fetches nearby peaks from OpenStreetMap (Overpass API).
 *   3. Fetches a 360° grid of elevation samples (OpenTopoData).
 *   4. Derives a horizon profile from those samples.
 *   5. Computes each peak's bearing, elevation angle, distance, and visibility.
 */

import { useState, useEffect, useRef } from 'react';
import {
  fetchHorizonElevations,
  fetchObserverElevation,
} from '../services/elevationService';
import { fetchNearbyPeaks, Peak } from '../services/peakService';
import {
  Observer,
  HorizonPoint,
  computeHorizonProfile,
  isPeakVisible,
  calculateBearing,
  elevationAngle,
  haversineDistance,
} from '../utils/terrainProjection';
import { CONFIG } from '../constants/config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PeakWithVisibility extends Peak {
  /** Compass bearing from the observer (degrees) */
  bearingDeg: number;
  /** Elevation angle above/below the observer's horizon (degrees) */
  elevationAngleDeg: number;
  /** Straight-line surface distance from the observer (km) */
  distanceKm: number;
  /** Whether the peak is not hidden behind terrain */
  isVisible: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTerrainData(
  latitude: number | null,
  longitude: number | null,
  gpsAltitude: number | null,
) {
  const [observer, setObserver] = useState<Observer | null>(null);
  const [peaks, setPeaks] = useState<PeakWithVisibility[]>([]);
  const [horizonProfile, setHorizonProfile] = useState<HorizonPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the last position we fetched data for, to avoid redundant calls
  const lastFetchPos = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (latitude === null || longitude === null) return;

    // Skip if the user hasn't moved far enough since the last fetch
    if (lastFetchPos.current) {
      const moved = haversineDistance(
        lastFetchPos.current.lat,
        lastFetchPos.current.lng,
        latitude,
        longitude,
      );
      if (moved < CONFIG.REFETCH_THRESHOLD_KM) return;
    }

    lastFetchPos.current = { lat: latitude, lng: longitude };
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Step 1: resolve observer elevation
        //   Prefer GPS altitude when available; fall back to SRTM lookup.
        const terrainElevM =
          gpsAltitude != null && gpsAltitude > 0
            ? gpsAltitude
            : await fetchObserverElevation(latitude, longitude);

        const obs: Observer = {
          latitude,
          longitude,
          elevationM: terrainElevM + CONFIG.OBSERVER_EYE_HEIGHT_M,
        };
        setObserver(obs);

        // Steps 2 & 3: fetch peaks and horizon samples concurrently
        const [rawPeaks, elevationSamples] = await Promise.all([
          fetchNearbyPeaks(latitude, longitude),
          fetchHorizonElevations(latitude, longitude),
        ]);

        // Step 4: derive horizon profile
        const profile = computeHorizonProfile(obs, elevationSamples);
        setHorizonProfile(profile);

        // Step 5: annotate each peak with visibility info
        const annotated: PeakWithVisibility[] = rawPeaks.map((peak) => {
          const bearing = calculateBearing(
            latitude,
            longitude,
            peak.latitude,
            peak.longitude,
          );
          const elev = elevationAngle(
            obs,
            peak.latitude,
            peak.longitude,
            peak.elevationM,
          );
          const dist = haversineDistance(
            latitude,
            longitude,
            peak.latitude,
            peak.longitude,
          );
          const visible = isPeakVisible(
            obs,
            peak.latitude,
            peak.longitude,
            peak.elevationM,
            profile,
          );

          return {
            ...peak,
            bearingDeg: bearing,
            elevationAngleDeg: elev,
            distanceKm: dist,
            isVisible: visible,
          };
        });

        setPeaks(annotated);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Failed to load terrain data';
        setError(message);
      } finally {
        setLoading(false);
      }
    })();
  }, [latitude, longitude, gpsAltitude]);

  return { observer, peaks, horizonProfile, loading, error };
}
