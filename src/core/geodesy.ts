/**
 * Spherical geodesy: distances, bearings and destination points on a sphere,
 * plus the wrap-safe angle arithmetic every other core module depends on.
 *
 * The Earth is modelled as a sphere of mean radius R. For the distances this
 * project cares about (a few hundred kilometres at most) the sphere differs
 * from the WGS-84 ellipsoid by roughly 0.3 %, which is an order of magnitude
 * below the uncertainty in a hand-held compass heading and two orders below
 * the uncertainty in SRTM terrain heights. Ellipsoidal (Vincenty) formulae
 * would add cost and iteration-convergence failure modes for no benefit here.
 *
 * Every function is a pure function of its arguments — see src/core/README.md.
 */

import type { LatLng } from './types';

/**
 * IUGG mean Earth radius R1 = (2a + b)/3 for WGS-84, in metres.
 * a = 6378137.0, b = 6356752.314245 → R1 = 6371008.7714…
 */
export const EARTH_RADIUS_M = 6371008.8;

/** Degrees → radians. */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Radians → degrees. */
export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Fold any angle onto the compass circle [0, 360).
 *
 * Used everywhere a bearing crosses north: 350° + 20° must become 10°, not
 * 370°, or every subsequent comparison and interpolation silently breaks.
 * Negative zero is collapsed to +0 so that equality tests behave.
 */
export function normaliseBearingDeg(bearingDeg: number): number {
  const wrapped = bearingDeg % 360;
  if (wrapped < 0) return wrapped + 360;
  return wrapped === 0 ? 0 : wrapped;
}

/**
 * Fold a longitude onto (-180, +180].
 *
 * The antimeridian is the only place this matters, and it matters a lot:
 * a destination-point computation that steps east from 179.9° must report
 * -179.9°, not 180.1°, or distance calculations against it go three-quarters
 * of the way around the planet.
 */
export function normaliseLongitudeDeg(longitudeDeg: number): number {
  // Shift so that the seam sits at 0, fold into [0, 360), shift back.
  const shifted = (((longitudeDeg - 180) % 360) + 360) % 360;
  return shifted === 0 ? 180 : shifted - 180;
}

/**
 * Signed shortest angular difference from → to, in (-180, +180].
 *
 * Positive means `to` lies clockwise of `from` (the short way round).
 * An exact half-turn is reported as +180 by convention, since the two
 * directions are equally short and a sign has to be chosen.
 */
export function angularDifferenceDeg(fromDeg: number, toDeg: number): number {
  const forward = normaliseBearingDeg(toDeg - fromDeg);
  return forward > 180 ? forward - 360 : forward;
}

/**
 * Great-circle distance in metres, by the haversine formula.
 *
 *   a = sin²(Δφ/2) + cos φ₁ · cos φ₂ · sin²(Δλ/2)
 *   d = 2 R · atan2(√a, √(1−a))
 *
 * The haversine form (rather than the spherical law of cosines) is used
 * because it stays numerically well-conditioned for small separations, where
 * `acos` of a number very close to 1 loses most of its significant digits.
 */
export function haversineDistanceM(
  from: LatLng,
  to: LatLng,
  radiusM: number = EARTH_RADIUS_M,
): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLon = toRadians(to.lon - from.lon);

  const sinHalfLat = Math.sin(deltaLat / 2);
  const sinHalfLon = Math.sin(deltaLon / 2);
  const a =
    sinHalfLat * sinHalfLat + Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;
  // Clamp guards against a drifting a hair above 1 for antipodal inputs.
  const clamped = Math.min(1, Math.max(0, a));

  return 2 * radiusM * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

/**
 * Initial bearing (forward azimuth) of the great-circle route from → to,
 * in degrees clockwise from true north, normalised to [0, 360).
 *
 * "Initial" is not a caveat to skip over: a great circle is not a rhumb line,
 * so the bearing changes continuously along the path. For the observer→peak
 * sight lines in this project only the initial bearing is meaningful, because
 * that is the direction the light actually arrives from.
 */
export function initialBearingDeg(from: LatLng, to: LatLng): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const deltaLon = toRadians(to.lon - from.lon);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  return normaliseBearingDeg(toDegrees(Math.atan2(y, x)));
}

/**
 * The point reached by travelling `distanceM` along the great circle leaving
 * `from` on initial bearing `bearingDeg`.
 *
 *   φ₂ = asin( sin φ₁ · cos δ + cos φ₁ · sin δ · cos θ )
 *   λ₂ = λ₁ + atan2( sin θ · sin δ · cos φ₁ , cos δ − sin φ₁ · sin φ₂ )
 *
 * where δ = d/R is the angular distance. The formula handles crossing a pole
 * on its own — the longitude jumps by 180° because atan2's second argument
 * changes sign — and the result's longitude is folded back onto (-180, 180].
 */
export function destinationPoint(
  from: LatLng,
  bearingDeg: number,
  distanceM: number,
  radiusM: number = EARTH_RADIUS_M,
): LatLng {
  const angularDistance = distanceM / radiusM;
  const bearing = toRadians(bearingDeg);
  const lat1 = toRadians(from.lat);
  const lon1 = toRadians(from.lon);

  const sinLat2 =
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing);
  const lat2 = Math.asin(Math.min(1, Math.max(-1, sinLat2)));

  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * sinLat2,
    );

  return { lat: toDegrees(lat2), lon: normaliseLongitudeDeg(toDegrees(lon2)) };
}
