/**
 * Shared data contract for the whole pipeline.
 *
 * NAMING RULES — enforced throughout. v1 failed partly by conflating two
 * different things both called "elevation":
 *
 *   elevationM    metres above sea level        (a height)
 *   altitudeDeg   vertical angle above horizontal (an angle, + up / − down)
 *   bearingDeg    horizontal compass angle, 0 = true north, 90 = east, clockwise
 *
 * Never introduce a field named `elevationAngle`. Heights are metres and end
 * in `M`; angles are degrees and end in `Deg`.
 *
 * All bearings are TRUE north referenced. Magnetic-to-true conversion happens
 * at the ingestion boundary (src/exif), never in core.
 */

/** A geographic coordinate, WGS-84 degrees. */
export interface LatLng {
  lat: number;
  lon: number;
}

/** A terrain elevation reading at a coordinate. */
export interface ElevationSample extends LatLng {
  elevationM: number;
}

/**
 * Where the viewer is and how high their eye sits.
 * Eye altitude above sea level = groundElevationM + eyeHeightM.
 */
export interface Observer extends LatLng {
  /** Terrain height at the observer's coordinate. */
  groundElevationM: number;
  /** Viewer's eye above that terrain (camera height; ~1.6 m handheld). */
  eyeHeightM: number;
}

/**
 * One sample of the terrain skyline: at this compass bearing, terrain rises to
 * this vertical angle, and the terrain responsible sits this far away.
 */
export interface HorizonPoint {
  bearingDeg: number;
  altitudeDeg: number;
  /** Distance to the terrain forming the skyline here. */
  distanceKm: number;
  /** Height above sea level of that terrain. */
  elevationM: number;
}

/** A 360°-capable skyline, sorted ascending by bearingDeg. */
export type HorizonProfile = readonly HorizonPoint[];

/** Where a peak's elevation figure came from — affects trust in visibility results. */
export type ElevationSource = 'osm' | 'srtm' | 'unknown';

/** A named summit from the peak database. */
export interface Peak extends LatLng {
  /** Stable identifier, e.g. "node/12345". */
  id: string;
  name: string;
  elevationM: number;
  elevationSource: ElevationSource;
}

/** A peak resolved into observer-relative geometry. */
export interface PeakSighting extends Peak {
  bearingDeg: number;
  altitudeDeg: number;
  distanceKm: number;
}

/** A sighting that survived the horizon occlusion test. */
export interface VisiblePeak extends PeakSighting {
  /** Skyline angle at this peak's bearing. */
  horizonAltitudeDeg: number;
  /** altitudeDeg − horizonAltitudeDeg. Near zero = only just clearing the ridge. */
  clearanceDeg: number;
}

/**
 * Camera orientation and optics. Angles in degrees.
 * headingDeg is where the optical axis points (true north referenced).
 */
export interface CameraPose {
  headingDeg: number;
  /** + = tilted up toward the sky, − = down. */
  pitchDeg: number;
  /** + = clockwise rotation of the frame. 0 for most photos. */
  rollDeg: number;
  /** Horizontal field of view. */
  hFovDeg: number;
  /** Vertical field of view (derived from hFov and the image aspect ratio). */
  vFovDeg: number;
}

/**
 * A position in normalised image space.
 * x: 0 = left edge, 1 = right edge. y: 0 = top edge, 1 = bottom edge.
 * Values may fall outside [0,1]; `inFrame` reports whether they land on-image.
 */
export interface ImagePoint {
  x: number;
  y: number;
  inFrame: boolean;
}
