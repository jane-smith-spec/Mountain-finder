/**
 * useTerrainData.ts
 *
 * Orchestrates terrain and peak data fetching.
 *
 * Uses horizonCalculator.computeHorizon for the full terrain pipeline
 * (elevation fetch → LoS sweep → refraction-corrected horizon profile)
 * and peakService.fetchNearbyPeaks for OpenStreetMap peak data.
 *
 * Data is re-fetched only when the user moves more than REFETCH_THRESHOLD_KM.
 * In-flight requests are aborted when a new fetch is triggered or the
 * component unmounts, preventing stale updates.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { computeHorizon, HorizonError } from '../services/horizonCalculator';
import { fetchNearbyPeaks, Peak } from '../services/peakService';
import {
  Observer,
  HorizonPoint,
  isPeakVisible,
  calculateBearing,
  elevationAngle,
  haversineDistance,
} from '../utils/terrainProjection';
import { CONFIG } from '../constants/config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PeakWithVisibility extends Peak {
  /** Compass bearing from the observer to this peak (degrees). */
  bearingDeg: number;
  /** Vertical angle from observer to peak summit (degrees above horizon). */
  elevationAngleDeg: number;
  /** Surface distance from the observer (km). */
  distanceKm: number;
  /** True if the peak is not occluded by closer terrain. */
  isVisible: boolean;
}

export interface TerrainStatus {
  loading: boolean;
  /** 0–100 while the horizon profile is being fetched. */
  progress: number;
  error: string | null;
  /** Non-fatal informational messages (e.g. "poor GPS accuracy"). */
  warnings: string[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTerrainData(
  latitude: number | null,
  longitude: number | null,
  gpsAltitudeM: number | null,
  gpsAccuracyM: number | null,
) {
  const [observer, setObserver] = useState<Observer | null>(null);
  const [peaks, setPeaks] = useState<PeakWithVisibility[]>([]);
  const [horizonProfile, setHorizonProfile] = useState<HorizonPoint[]>([]);
  const [status, setStatus] = useState<TerrainStatus>({
    loading: false,
    progress: 0,
    error: null,
    warnings: [],
  });

  const lastFetchPos = useRef<{ lat: number; lng: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runFetch = useCallback(
    async (lat: number, lng: number, alt: number | null, acc: number | null) => {
      // Cancel any previous in-flight request before starting a new one
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus({ loading: true, progress: 0, error: null, warnings: [] });

      try {
        // Fetch horizon profile and nearby peaks concurrently.
        // horizonCalculator handles its own batching, retries, and refraction.
        const [horizonResult, rawPeaks] = await Promise.all([
          computeHorizon({
            latitude: lat,
            longitude: lng,
            gpsAltitudeM: alt ?? undefined,
            gpsAccuracyM: acc ?? undefined,
            signal: controller.signal,
            onProgress: (pct) =>
              setStatus((prev) => ({ ...prev, progress: pct })),
          }),
          fetchNearbyPeaks(lat, lng),
        ]);

        // Guard: ignore results if this fetch was superseded
        if (controller.signal.aborted) return;

        const obs: Observer = {
          latitude: lat,
          longitude: lng,
          elevationM: horizonResult.observerElevationM + CONFIG.OBSERVER_EYE_HEIGHT_M,
        };
        setObserver(obs);
        setHorizonProfile(horizonResult.profile);

        const annotated: PeakWithVisibility[] = rawPeaks.map((peak) => ({
          ...peak,
          bearingDeg: calculateBearing(lat, lng, peak.latitude, peak.longitude),
          elevationAngleDeg: elevationAngle(obs, peak.latitude, peak.longitude, peak.elevationM),
          distanceKm: haversineDistance(lat, lng, peak.latitude, peak.longitude),
          isVisible: isPeakVisible(
            obs, peak.latitude, peak.longitude, peak.elevationM,
            horizonResult.profile,
          ),
        }));

        setPeaks(annotated);
        setStatus({
          loading: false,
          progress: 100,
          error: null,
          warnings: horizonResult.warnings,
        });

      } catch (err: unknown) {
        if (controller.signal.aborted) return; // cancelled — not an error

        if (err instanceof HorizonError) {
          // Render whatever partial profile was computed before failure
          if (err.partial.length > 0) setHorizonProfile(err.partial);

          const userMessage: Record<string, string> = {
            NO_GPS:
              'No GPS signal. Enable Location Services and move outdoors.',
            POOR_GPS:
              'GPS signal is weak — you may be indoors. Move to an open area.',
            API_FAILURE:
              'Could not load terrain data. Check your internet connection.',
            API_TIMEOUT: '', // silent: happens on navigation changes
            INVALID_BEARING: 'Internal error: compass bearing out of range.',
            PARTIAL: 'Terrain data partially loaded — some peaks may be hidden.',
          };

          setStatus({
            loading: false,
            progress: 0,
            error: userMessage[err.code] ?? err.message,
            warnings: err.partial.length > 0 ? ['Showing partial terrain data.'] : [],
          });
        } else {
          setStatus({
            loading: false,
            progress: 0,
            error: err instanceof Error ? err.message : 'Unexpected error loading terrain.',
            warnings: [],
          });
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (latitude === null || longitude === null) return;

    // Skip if the user hasn't moved enough since the last completed fetch
    if (lastFetchPos.current) {
      const movedKm = haversineDistance(
        lastFetchPos.current.lat, lastFetchPos.current.lng,
        latitude, longitude,
      );
      if (movedKm < CONFIG.REFETCH_THRESHOLD_KM) return;
    }

    lastFetchPos.current = { lat: latitude, lng: longitude };
    runFetch(latitude, longitude, gpsAltitudeM, gpsAccuracyM);

    return () => {
      abortRef.current?.abort();
    };
  }, [latitude, longitude, gpsAltitudeM, gpsAccuracyM, runFetch]);

  return { observer, peaks, horizonProfile, status };
}
