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
 * One step of the skyline staircase along a single bearing.
 *
 * ADDED (not a rename or repurposing of anything) for the nearer-terrain
 * occlusion rule — see {@link HorizonPoint.skylineSteps}. Walking outward from
 * the observer along one bearing and keeping a running maximum of the terrain's
 * vertical angle, a step is recorded every time a sample beats everything
 * closer. `maxAltitudeDeg` is therefore the highest angle reached by any terrain
 * at or nearer than `distanceKm`, and the steps are non-decreasing in both
 * fields. Naming follows the file header: metres end in `M`, angles in `Deg`.
 */
export interface SkylineStep {
  /** Distance to the sample that set this running maximum. */
  distanceKm: number;
  /** Highest terrain angle seen at or nearer than `distanceKm`. */
  maxAltitudeDeg: number;
  /** Height above sea level of the terrain that set it. */
  elevationM: number;
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
  /**
   * The whole running-maximum staircase along this bearing, near → far.
   *
   * `altitudeDeg`/`distanceKm`/`elevationM` describe only the single sample
   * that wins the bearing outright, which is enough to draw a skyline but not
   * enough to decide occlusion: terrain BEHIND a peak cannot hide it, so the
   * question "how high does terrain reach *nearer* than this peak?" needs the
   * angle as a function of distance, not one winning value. The last step
   * always repeats the winner, so `skylineSteps.at(-1)` agrees with the three
   * fields above by construction.
   *
   * Optional, so that hand-built profiles (tests, callers that only ever knew
   * the winner) stay valid. Where it is absent the single winning sample is
   * treated as a one-step staircase — that is exactly the information such a
   * point carries, no more and no less. `buildHorizonProfile` always fills it.
   */
  skylineSteps?: readonly SkylineStep[];
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
  /**
   * The angle of the terrain that can occlude this peak: the highest angle
   * reached at this peak's bearing by terrain NEARER than the peak. Terrain
   * farther away is excluded, because it stands behind the peak and cannot
   * hide it.
   *
   * When no terrain at all lies nearer than the peak, nothing can occlude it
   * and this reports the nadir, −90° (see `NO_NEARER_TERRAIN_ALTITUDE_DEG` in
   * visibility.ts), which every real peak clears.
   */
  occludingAltitudeDeg: number;
  /** altitudeDeg − occludingAltitudeDeg. Near zero = only just clearing the ridge. */
  clearanceDeg: number;
}

/**
 * What a peak's summit point does against the terrain in front of it, and
 * therefore whether the overlay is entitled to name it.
 *
 * ADDED for decision D8 (MISSION.md). It does not replace or reinterpret
 * anything: `VisiblePeak.clearanceDeg` still answers the single geometric
 * question "does the summit point clear the ground in front of it", and
 * `'visible'` here means exactly that and nothing more. The two occluded
 * states split what used to be one bucket, because a hidden summit is hidden in
 * one of two physically different ways:
 *
 *   `'self-occluded'`
 *     The summit point is behind a shoulder of ITS OWN landform: the ground
 *     runs unbroken from the piece that gets in the way out to the summit, with
 *     no col between them. Standing at the foot of a smooth convex hill is the
 *     ordinary case — the hill fills the view, it is unmistakably there, and
 *     only the last few metres of its top are tucked behind its own curve.
 *     Naming it is honest, so the renderer labels it and de-emphasises it.
 *
 *   `'foreground-occluded'`
 *     A DIFFERENT landform, nearer and separated from the peak by a col, stands
 *     in the way — a volcano 160 km off behind the hill at the end of the
 *     street. Nothing of the peak is in the picture. A label here would put a
 *     mountain's name on somebody else's hillside, which is the one failure
 *     this project exists to prevent, so such peaks are never drawn.
 *
 * The classifier that decides between the two, and the geometric argument for
 * the rule it uses, live in {@link classifyOcclusion} in visibility.ts. Use
 * {@link isLabelled} rather than comparing strings at call sites, so the
 * "may this be drawn?" question has exactly one implementation.
 */
export type PeakVisibility = 'visible' | 'self-occluded' | 'foreground-occluded';

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
