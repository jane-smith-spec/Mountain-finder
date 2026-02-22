/**
 * terrainProjection.ts
 *
 * Core geodetic math for converting GPS + elevation data into first-person
 * AR screen coordinates. All angle conventions:
 *   - Bearings: 0° = North, 90° = East, clockwise
 *   - Elevation angles: positive = above horizon, negative = below
 *   - Screen coords: x/y in [0, 1], origin top-left
 */

export const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// ─── Data types ──────────────────────────────────────────────────────────────

export interface Observer {
  latitude: number;
  longitude: number;
  /** Elevation in metres (GPS altitude + eye height) */
  elevationM: number;
}

export interface ElevationSample {
  latitude: number;
  longitude: number;
  elevationM: number;
}

/** One point on the pre-computed 360° horizon profile */
export interface HorizonPoint {
  /** Compass bearing (0–359°) */
  bearingDeg: number;
  /** Maximum elevation angle to any terrain at this bearing */
  elevationAngleDeg: number;
}

/** Projected screen position (normalised 0–1) */
export interface ScreenPosition {
  /** 0 = left edge, 1 = right edge */
  x: number;
  /** 0 = top edge, 1 = bottom edge */
  y: number;
  /** False when the target is outside the current camera FOV */
  inView: boolean;
}

// ─── Geodetic helpers ─────────────────────────────────────────────────────────

/**
 * Great-circle distance between two coordinates (km).
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, a)));
}

/**
 * Initial compass bearing from point A → point B (degrees, 0 = North, CW).
 */
export function calculateBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const lat1R = lat1 * DEG_TO_RAD;
  const lat2R = lat2 * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const x = Math.cos(lat2R) * Math.sin(dLng);
  const y =
    Math.cos(lat1R) * Math.sin(lat2R) -
    Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return ((Math.atan2(x, y) * RAD_TO_DEG) + 360) % 360;
}

/**
 * Destination coordinate given a start point, bearing, and distance.
 */
export function destinationPoint(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceKm: number,
): { latitude: number; longitude: number } {
  const d = distanceKm / EARTH_RADIUS_KM;
  const brng = bearingDeg * DEG_TO_RAD;
  const lat1 = lat * DEG_TO_RAD;
  const lng1 = lng * DEG_TO_RAD;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    latitude: lat2 * RAD_TO_DEG,
    longitude: (((lng2 * RAD_TO_DEG) + 540) % 360) - 180,
  };
}

// ─── Elevation angle ──────────────────────────────────────────────────────────

/**
 * Vertical angle (degrees) from the observer to a target, accounting for
 * Earth's curvature (which makes distant objects appear to "sink").
 *
 * Positive = target is above the observer's true horizon.
 * Negative = target is below it.
 */
export function elevationAngle(
  observer: Observer,
  targetLat: number,
  targetLng: number,
  targetElevM: number,
): number {
  const distKm = haversineDistance(
    observer.latitude,
    observer.longitude,
    targetLat,
    targetLng,
  );
  const distM = distKm * 1000;
  if (distM < 1) return 90; // Same point — straight up

  // Earth-curvature correction: at horizontal distance d, a flat surface
  // appears to drop by d² / (2R) metres (standard refraction ignored).
  const curvatureDropM = (distM * distM) / (2 * EARTH_RADIUS_KM * 1000);
  const heightDiffM = targetElevM - observer.elevationM - curvatureDropM;

  return Math.atan2(heightDiffM, distM) * RAD_TO_DEG;
}

// ─── Horizon profile ──────────────────────────────────────────────────────────

/**
 * From a set of elevation samples scattered around the observer, compute the
 * highest terrain elevation angle at each integer bearing degree.
 *
 * This becomes the "silhouette" used to:
 *   1. Draw the terrain horizon line on the camera feed.
 *   2. Test whether a peak is visible or hidden behind terrain.
 */
export function computeHorizonProfile(
  observer: Observer,
  samples: ElevationSample[],
): HorizonPoint[] {
  const bearingMap = new Map<number, number>();

  for (const sample of samples) {
    const bearing = Math.round(
      calculateBearing(
        observer.latitude,
        observer.longitude,
        sample.latitude,
        sample.longitude,
      ),
    ) % 360;

    const angle = elevationAngle(
      observer,
      sample.latitude,
      sample.longitude,
      sample.elevationM,
    );

    const prev = bearingMap.get(bearing) ?? -90;
    if (angle > prev) bearingMap.set(bearing, angle);
  }

  return Array.from(bearingMap.entries())
    .map(([bearingDeg, elevationAngleDeg]) => ({ bearingDeg, elevationAngleDeg }))
    .sort((a, b) => a.bearingDeg - b.bearingDeg);
}

// ─── Projection ───────────────────────────────────────────────────────────────

/**
 * Project a world-space (bearing, elevation-angle) pair to normalised
 * screen coordinates given the camera's current heading and FOV.
 */
export function projectToScreen(
  bearingDeg: number,
  elevAngleDeg: number,
  headingDeg: number,
  hFOV: number,
  vFOV: number,
): ScreenPosition {
  // Angular offset from the camera centre
  let dAz = bearingDeg - headingDeg;
  if (dAz > 180) dAz -= 360;
  if (dAz < -180) dAz += 360;

  const inView = Math.abs(dAz) <= hFOV / 2;
  const x = 0.5 + dAz / hFOV;
  // Positive elevation angle → higher on screen → smaller y
  const y = 0.5 - elevAngleDeg / vFOV;

  return { x, y, inView };
}

// ─── Visibility test ──────────────────────────────────────────────────────────

/**
 * Returns true if the peak is not occluded by terrain.
 *
 * A peak is considered visible when its elevation angle at the observer
 * equals or exceeds the maximum horizon elevation angle in nearby bearings.
 * A small tolerance accounts for coarse angular sampling.
 */
export function isPeakVisible(
  observer: Observer,
  peakLat: number,
  peakLng: number,
  peakElevM: number,
  horizonProfile: HorizonPoint[],
  toleranceDeg = 0.5,
): boolean {
  if (horizonProfile.length === 0) return true;

  const peakBearing = Math.round(
    calculateBearing(observer.latitude, observer.longitude, peakLat, peakLng),
  );
  const peakElevAngle = elevationAngle(observer, peakLat, peakLng, peakElevM);

  // Look at horizon samples within ±5° of the peak's bearing
  const nearby = horizonProfile.filter((h) => {
    const diff = Math.abs(((h.bearingDeg - peakBearing + 540) % 360) - 180);
    return diff <= 5;
  });

  if (nearby.length === 0) return true;
  const maxHorizonElev = Math.max(...nearby.map((h) => h.elevationAngleDeg));

  return peakElevAngle >= maxHorizonElev - toleranceDeg;
}
