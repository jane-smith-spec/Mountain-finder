/**
 * Overture Maps → peak records. The PURE half of the Q5 importer.
 *
 * WHY OVERTURE AND NOT OSM DIRECTLY
 *   Every conventional peak source is blocked by this environment's egress
 *   proxy (geonames, geofabrik, naturalearthdata, planet.openstreetmap.org,
 *   taginfo; Overpass 403s). `s3.amazonaws.com` is reachable, and the Overture
 *   Maps distribution lives there as Parquet. Overture's `base` theme,
 *   `type=land`, carries OSM's `natural=peak` nodes with their tags already
 *   normalised — see the schema notes below, all of which were read off the
 *   live 2026-06-17.0 release rather than taken from documentation.
 *
 * ── WHAT A SUMMIT LOOKS LIKE IN THIS DATA (verified 2026-08-16) ────────────
 *   subtype   'physical'          — the landform group
 *   class     'peak' | 'volcano'  — the summit classes (siblings: saddle,
 *                                   ridge, valley, cliff, plateau, …)
 *   names     nested struct: `names.primary` is the display name;
 *             `names.common` is a language→name map; `names.rules[]` carries
 *             alternates. Only `primary` is imported.
 *   elevation INT32, METRES, nullable.  **It exists, and it is the OSM `ele`
 *             tag carried through unchanged** — checked against the row's own
 *             `source_tags`: Matterhorn `source_tags.ele = "4478"` and
 *             `elevation = 4478`; Weisshorn `"4505"` / 4505. This is what
 *             makes Overture usable here at all: MISSION.md forbids taking
 *             summit heights from SRTM, and this column means we never have to.
 *   sources   `[{dataset: 'OpenStreetMap', license: 'ODbL-1.0', record_id:
 *             'n26863664@50', …}]` for every peak sampled. Attribution lives
 *             on the dataset's source record; the per-row column is not read,
 *             because it is 20% of the bytes and its `@version` suffix makes
 *             the id unstable between releases.
 *   bbox      struct of four DOUBLEs that are exactly float32 values, rounded
 *             OUTWARD. For a point geometry xmin/xmax bracket the true
 *             longitude; see {@link pointFromBbox}.
 *
 * ── WHY POSITION COMES FROM `bbox` AND NOT FROM `geometry` ─────────────────
 * `geometry` is WKB and decodes to full doubles, but it is ~96% of the bytes
 * in a row group (21.9 MB of 22.7 MB in one measured group). `bbox` is 1.2%
 * and brackets the same point to within one float32 ulp: for the Matterhorn,
 * geometry says 7.6586024, 45.9764263 and the bbox midpoint says 7.6586028,
 * 45.9764290 — 0.02 m east, 0.30 m north. At the ranges this pipeline works
 * over (a peak 1 km away subtends 0.00006° per metre of lateral error) that is
 * far below anything the projection can express, and it buys a 30× reduction
 * in bytes downloaded. The trade is recorded here so it can be reversed if a
 * future use ever needs survey-grade positions.
 */

import type { ElevationSource } from '../core/types.js';
import { ProviderError } from './errors.js';
import type { PeakRecord } from './peak-store.js';

/** Overture's `subtype` for landform features. Summits are all `physical`. */
export const OVERTURE_LANDFORM_SUBTYPE = 'physical';

/**
 * The `class` values imported as summits.
 *
 * `peak` and `volcano` both. The ground-truth set alone needs both: Mount
 * Rainier, Mount Baker, Mount Hood and Lassen Peak are `natural=volcano` in
 * OSM, and importing only `peak` would silently lose every Cascade summit the
 * acceptance suite gates on.
 */
export const DEFAULT_SUMMIT_CLASSES: readonly string[] = ['peak', 'volcano'];

/**
 * The only columns read from a row group.
 *
 * Parquet stores a file column-by-column, so naming six of thirteen top-level
 * columns is not a convenience — it decides how many bytes cross the network.
 * Measured on one Alpine row group of part-00011: these six are 837,744 bytes
 * of the group's 22,734,139 (3.7%), because `geometry` alone is 21.9 MB.
 */
export const OVERTURE_LAND_COLUMNS: readonly string[] = [
  'id',
  'names',
  'subtype',
  'class',
  'elevation',
  'bbox',
];

/** An axis-aligned degree rectangle. Matches `BoundingBox` in peaks.ts. */
export interface DegreeBox {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/**
 * Do two degree boxes overlap, edges inclusive?
 *
 * This is the whole spatial-pruning test: a Parquet row group carries min/max
 * statistics for `bbox.xmin`/`xmax`/`ymin`/`ymax`, so the group's own extent is
 * known from the footer alone and a group that fails this test is never
 * fetched. Longitude is compared as given — Overture's row-group extents are in
 * [−180, 180] and none of them is recorded wrapped, so an antimeridian query
 * must be split by the caller rather than silently mis-tested here.
 */
export function boxesIntersect(a: DegreeBox, b: DegreeBox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

/** Is a point inside a box, edges inclusive? */
export function boxContains(box: DegreeBox, lat: number, lon: number): boolean {
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

/**
 * The largest possible span, in degrees, of a float32-rounded point bbox.
 *
 * Overture rounds `bbox` outward to float32. A float32 has a 24-bit
 * significand, so the gap between neighbouring values at magnitude |v| is at
 * most 2^(exponent−23); for |v| ≤ 180 (longitude) the exponent is at most 7, so
 * one ulp ≤ 2^-16 = 1.526e-5°, and outward rounding of a single point spans at
 * most two of them: 3.05e-5°. This constant is that bound rounded up to 1e-4°
 * (≈11 m of latitude) so the test is decisive rather than marginal: anything
 * wider than this is an extended feature — a ridge line, a glacier polygon —
 * not a summit point, and gets rejected rather than collapsed to a centre.
 */
export const POINT_BBOX_TOLERANCE_DEG = 1e-4;

/** Overture's `bbox` struct. */
export interface OvertureBbox {
  readonly xmin: number;
  readonly xmax: number;
  readonly ymin: number;
  readonly ymax: number;
}

/** The one summit-shaped row Overture gives us, after the nesting is stripped. */
export interface OvertureLandFeature {
  /** Overture GERS id — a UUID, stable across releases. */
  readonly id: string;
  readonly subtype: string;
  readonly featureClass: string;
  /** `names.primary`, or `null` when the feature is unnamed. */
  readonly namePrimary: string | null;
  /** Metres above sea level from the `elevation` column, or `null`. */
  readonly elevationM: number | null;
  readonly bbox: OvertureBbox;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Read one decoded Parquet row into {@link OvertureLandFeature}.
 *
 * The row arrives as an untrusted `Record<string, unknown>` — the decoder
 * cannot know Overture's schema — so every field is checked. A row that does
 * not carry the four bbox numbers has no position at all and is `null`; a row
 * missing softer fields keeps them as `null` so the caller can say *why* it
 * dropped a candidate.
 */
export function readOvertureLandRow(value: unknown): OvertureLandFeature | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;

  const rawBbox = row['bbox'];
  if (typeof rawBbox !== 'object' || rawBbox === null) return null;
  const bboxFields = rawBbox as Record<string, unknown>;
  const xmin = finiteNumber(bboxFields['xmin']);
  const xmax = finiteNumber(bboxFields['xmax']);
  const ymin = finiteNumber(bboxFields['ymin']);
  const ymax = finiteNumber(bboxFields['ymax']);
  if (xmin === null || xmax === null || ymin === null || ymax === null) return null;

  const id = nonEmptyString(row['id']);
  if (id === null) return null;

  const names = row['names'];
  const namePrimary =
    typeof names === 'object' && names !== null
      ? nonEmptyString((names as Record<string, unknown>)['primary'])
      : null;

  return {
    id,
    subtype: nonEmptyString(row['subtype']) ?? '',
    featureClass: nonEmptyString(row['class']) ?? '',
    namePrimary,
    elevationM: finiteNumber(row['elevation']),
    bbox: { xmin, xmax, ymin, ymax },
  };
}

/**
 * The point a float32-rounded bbox brackets, or `null` if the bbox is wider
 * than one point's rounding can explain.
 *
 * Returning the midpoint is not a centroid approximation: for a point geometry
 * the true coordinate provably lies inside [min, max], and the midpoint is the
 * estimate whose worst-case error is half the span — under 0.5 m in latitude
 * anywhere on Earth. Extended features are refused outright, because the centre
 * of a ridge's bounding box is not a summit and labelling it as one would be
 * exactly the plausible-looking wrong answer this project keeps designing out.
 */
export function pointFromBbox(bbox: OvertureBbox): { lat: number; lon: number } | null {
  if (bbox.xmax < bbox.xmin || bbox.ymax < bbox.ymin) return null;
  if (bbox.xmax - bbox.xmin > POINT_BBOX_TOLERANCE_DEG) return null;
  if (bbox.ymax - bbox.ymin > POINT_BBOX_TOLERANCE_DEG) return null;
  const lat = (bbox.ymin + bbox.ymax) / 2;
  const lon = (bbox.xmin + bbox.xmax) / 2;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Why a decoded row did not become a peak. Counted and reported by the importer. */
export type OvertureRejection =
  | 'unreadable-row'
  | 'not-a-landform'
  | 'not-a-summit-class'
  | 'unnamed'
  | 'no-elevation'
  | 'not-a-point'
  | 'outside-area';

/** What one row became. */
export type OvertureRowOutcome =
  | { readonly kind: 'peak'; readonly record: PeakRecord }
  | { readonly kind: 'rejected'; readonly reason: OvertureRejection };

export interface OvertureImportOptions {
  /** `class` values kept. Defaults to {@link DEFAULT_SUMMIT_CLASSES}. */
  readonly classes?: readonly string[];
  /** Only keep summits inside this box. Omit to keep every summit read. */
  readonly area?: DegreeBox;
  /** `sources[].id` written onto every record. Must resolve in the dataset. */
  readonly sourceId: string;
  /** Prefix for `PeakRecord.id`. Defaults to `overture/`. */
  readonly idPrefix?: string;
}

/**
 * `overture/<gers-uuid>`.
 *
 * Not an OSM id. The existing hand-built dataset uses `mf/` and the Overpass
 * importer uses `node/<id>`; a third namespace keeps the three
 * distinguishable, which matters because `Peak.id` is what the renderer keys
 * labels on and a silent id collision between two sources would merge two
 * different summits.
 */
export const OVERTURE_ID_PREFIX = 'overture/';

/**
 * Overture's elevations ARE OSM `ele` tags (see the module header for the
 * verification), so the frozen contract's `'osm'` is the honest label — not
 * `'unknown'`, and emphatically not `'srtm'`.
 */
export const OVERTURE_ELEVATION_SOURCE: ElevationSource = 'osm';

/** Turn one decoded row into a peak record, or say why it is not one. */
export function classifyOvertureRow(
  value: unknown,
  options: OvertureImportOptions,
): OvertureRowOutcome {
  const feature = readOvertureLandRow(value);
  if (feature === null) return { kind: 'rejected', reason: 'unreadable-row' };
  if (feature.subtype !== OVERTURE_LANDFORM_SUBTYPE) {
    return { kind: 'rejected', reason: 'not-a-landform' };
  }
  const classes = options.classes ?? DEFAULT_SUMMIT_CLASSES;
  if (!classes.includes(feature.featureClass)) {
    return { kind: 'rejected', reason: 'not-a-summit-class' };
  }
  if (feature.namePrimary === null) return { kind: 'rejected', reason: 'unnamed' };
  // A summit with no height cannot be projected, and MISSION.md forbids filling
  // one in from the DEM (SRTM under-reads sharp summits by 250–350 m and
  // displaces them ~320 m). So it is dropped, loudly, rather than invented.
  if (feature.elevationM === null) return { kind: 'rejected', reason: 'no-elevation' };

  const point = pointFromBbox(feature.bbox);
  if (point === null) return { kind: 'rejected', reason: 'not-a-point' };
  if (options.area !== undefined && !boxContains(options.area, point.lat, point.lon)) {
    return { kind: 'rejected', reason: 'outside-area' };
  }

  const sourceId = options.sourceId;
  return {
    kind: 'peak',
    record: {
      id: `${options.idPrefix ?? OVERTURE_ID_PREFIX}${feature.id}`,
      name: feature.namePrimary,
      lat: point.lat,
      lon: point.lon,
      elevationM: feature.elevationM,
      positionSourceId: sourceId,
      elevationSourceId: sourceId,
      elevationSourceKind: OVERTURE_ELEVATION_SOURCE,
      usedBy: [],
    },
  };
}

/** Running tally of what an import did, per rejection reason. */
export type OvertureRejectionCounts = Readonly<Record<OvertureRejection, number>>;

export function emptyRejectionCounts(): Record<OvertureRejection, number> {
  return {
    'unreadable-row': 0,
    'not-a-landform': 0,
    'not-a-summit-class': 0,
    unnamed: 0,
    'no-elevation': 0,
    'not-a-point': 0,
    'outside-area': 0,
  };
}

/**
 * Import a batch of decoded rows, keeping summits and tallying the rest.
 *
 * De-duplicates by record id. Overture's parts are disjoint, so a duplicate
 * means the same row was read twice (overlapping row-group ranges, a re-run
 * merging into an existing dataset) — silently keeping both would put two
 * labels on one summit.
 */
export function importOvertureRows(
  rows: Iterable<unknown>,
  options: OvertureImportOptions,
): {
  readonly peaks: readonly PeakRecord[];
  readonly rejected: OvertureRejectionCounts;
  readonly duplicates: number;
} {
  const rejected = emptyRejectionCounts();
  const byId = new Map<string, PeakRecord>();
  let duplicates = 0;
  for (const row of rows) {
    const outcome = classifyOvertureRow(row, options);
    if (outcome.kind === 'rejected') {
      rejected[outcome.reason] += 1;
      continue;
    }
    if (byId.has(outcome.record.id)) {
      duplicates += 1;
      continue;
    }
    byId.set(outcome.record.id, outcome.record);
  }
  return { peaks: [...byId.values()], rejected, duplicates };
}

/**
 * Fail the way the rest of `src/providers` fails, so callers keep one catch.
 */
export function overtureError(message: string): ProviderError {
  return new ProviderError('bad-response', message);
}
