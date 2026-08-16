/**
 * Local peak database — named summits from a committed dataset, queried offline.
 *
 * WHY THIS EXISTS ALONGSIDE `peaks.ts`
 *   `peaks.ts` talks to Overpass. Overpass is unreachable from this environment
 *   (403 at the egress proxy) and, more importantly, decision D7 says the
 *   product must work with no network at all: mountain photographs are taken
 *   where there is no signal. So the runtime peak source is a JSON file that
 *   ships with the app, and the Overpass client demotes to the IMPORTER that
 *   refreshes that file when egress is open. Both implement `PeaksProvider`, so
 *   anything already written against the seam takes either one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SUMMIT HEIGHTS COME FROM HERE AND NEVER FROM THE TERRAIN TILES
 * ═══════════════════════════════════════════════════════════════════════════
 * MISSION.md, "What the real SRTM data taught us": a 30 m radar grid cannot
 * resolve a pyramid. It under-reads sharp summits by 250–350 m AND displaces
 * them — the Matterhorn's highest posting in N45E007 is 4230 m against a
 * surveyed 4478 m, and it sits ~320 m WSW of the true summit, which itself
 * reads 3567 m. Sampling peak heights from SRTM would therefore put every
 * alpine label hundreds of metres low and sideways.
 *
 * Hence the division of labour, which this module exists to enforce:
 *   terrain horizon  → SRTM tiles      (broad relief; Zermatt reads 1608 m ✓)
 *   summit height    → this database   (surveyed / published figures)
 *
 * `resolvePeakElevations` in `peaks.ts` fills a MISSING height from the DEM as
 * a last resort and marks it `elevationSource: 'srtm'`. Records in this store
 * always carry their own height, so that path is never taken for them.
 *
 * ── On `Peak.elevationSource` ──────────────────────────────────────────────
 * The frozen core contract offers `'osm' | 'srtm' | 'unknown'`. The heights in
 * the shipped dataset are neither: they are published survey/gazetteer figures
 * with citations. Rather than mislabel them `'osm'` (they are not OSM tags) or
 * `'srtm'` (they are emphatically not DEM reads), a record declares its own
 * `elevationSourceKind` and the honest default is `'unknown'` — "core cannot
 * name this provenance" — while the real citation lives on the record in
 * `elevationSourceId` and resolves to an entry in `dataset.sources`. A record
 * imported from OSM sets `'osm'` and keeps the tag provenance.
 */

import { haversineDistanceM } from '../core/geodesy.js';
import type { ElevationSource, LatLng, Peak } from '../core/types.js';
import { ProviderError } from './errors.js';
import type {
  BoundingBox,
  PeakCandidate,
  PeakSearchArea,
  PeaksProvider,
  PeaksRequestOptions,
} from './peaks.js';
import { lonWithinBounds } from './tile-store.js';

/** How a source document was read. Mirrors the ground-truth case schema. */
export type PeakSourceAccess = 'fetched' | 'via-search-index' | 'derived';

/** A citation. Every number in the dataset points at one of these. */
export interface PeakSourceRecord {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  /** ISO-8601 date the claim was read. */
  readonly retrieved: string;
  readonly access: PeakSourceAccess;
  readonly note?: string;
}

/** One summit, with its provenance attached. */
export interface PeakRecord extends LatLng {
  /** Stable identifier, e.g. `mf/matterhorn`. Unique within a dataset. */
  readonly id: string;
  readonly name: string;
  readonly elevationM: number;
  /** `sources[].id` the coordinate came from. */
  readonly positionSourceId: string;
  /** `sources[].id` the height came from. */
  readonly elevationSourceId: string;
  /** What core should be told about the height's provenance. See module docs. */
  readonly elevationSourceKind: ElevationSource;
  /** Ground-truth case ids this record was assembled for. */
  readonly usedBy: readonly string[];
  readonly note?: string;
}

/** A committed peak dataset: citations plus the summits that cite them. */
export interface PeakDataset {
  readonly version: number;
  readonly description: string;
  readonly sources: readonly PeakSourceRecord[];
  readonly peaks: readonly PeakRecord[];
}

/** A record with its range and direction from a query point. */
export interface PeakRecordSighting {
  readonly record: PeakRecord;
  readonly distanceKm: number;
}

const ELEVATION_SOURCE_KINDS: readonly ElevationSource[] = ['osm', 'srtm', 'unknown'];
const ACCESS_KINDS: readonly PeakSourceAccess[] = ['fetched', 'via-search-index', 'derived'];

function fail(label: string, message: string): never {
  throw new ProviderError('bad-response', `${label}: ${message}`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(label, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function asString(raw: Record<string, unknown>, field: string, label: string): string {
  const value = raw[field];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(label, `${field} must be a non-empty string`);
  }
  return value.trim();
}

function asOptionalString(
  raw: Record<string, unknown>,
  field: string,
  label: string,
): string | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(label, `${field} must be a string when present`);
  return value;
}

function asFiniteNumber(raw: Record<string, unknown>, field: string, label: string): number {
  const value = raw[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(label, `${field} must be a finite number`);
  }
  return value;
}

function asStringArray(raw: Record<string, unknown>, field: string, label: string): string[] {
  const value = raw[field];
  if (!Array.isArray(value)) fail(label, `${field} must be an array`);
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      fail(label, `${field}[${index}] must be a non-empty string`);
    }
    return entry.trim();
  });
}

/**
 * Validate an untrusted value (a parsed JSON file) into a {@link PeakDataset}.
 *
 * Strict on purpose. A peak dataset with a swapped lat/lon or a missing height
 * produces labels that look plausible and are in the wrong place, which is the
 * exact failure mode this project keeps designing against — so every field is
 * checked, every citation must resolve, and ids must be unique.
 */
export function parsePeakDataset(value: unknown, label = 'peak dataset'): PeakDataset {
  const raw = asRecord(value, label);
  const version = asFiniteNumber(raw, 'version', label);
  const description = asString(raw, 'description', label);

  const rawSources = raw['sources'];
  if (!Array.isArray(rawSources)) fail(label, 'sources must be an array');
  const sources: PeakSourceRecord[] = rawSources.map((entry, index) => {
    const sourceLabel = `${label}.sources[${index}]`;
    const source = asRecord(entry, sourceLabel);
    const access = asString(source, 'access', sourceLabel);
    if (!ACCESS_KINDS.includes(access as PeakSourceAccess)) {
      fail(sourceLabel, `access must be one of ${ACCESS_KINDS.join(', ')}`);
    }
    return {
      id: asString(source, 'id', sourceLabel),
      title: asString(source, 'title', sourceLabel),
      url: asString(source, 'url', sourceLabel),
      retrieved: asString(source, 'retrieved', sourceLabel),
      access: access as PeakSourceAccess,
      ...optionalNote(asOptionalString(source, 'note', sourceLabel)),
    };
  });

  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.id)) fail(label, `duplicate source id ${source.id}`);
    sourceIds.add(source.id);
  }

  const rawPeaks = raw['peaks'];
  if (!Array.isArray(rawPeaks)) fail(label, 'peaks must be an array');
  const peaks: PeakRecord[] = rawPeaks.map((entry, index) => {
    const peakLabel = `${label}.peaks[${index}]`;
    const peak = asRecord(entry, peakLabel);
    const lat = asFiniteNumber(peak, 'lat', peakLabel);
    const lon = asFiniteNumber(peak, 'lon', peakLabel);
    if (lat < -90 || lat > 90) fail(peakLabel, `lat ${lat} is outside [-90, 90]`);
    if (lon < -180 || lon > 180) fail(peakLabel, `lon ${lon} is outside [-180, 180]`);

    const kind = asString(peak, 'elevationSourceKind', peakLabel);
    if (!ELEVATION_SOURCE_KINDS.includes(kind as ElevationSource)) {
      fail(peakLabel, `elevationSourceKind must be one of ${ELEVATION_SOURCE_KINDS.join(', ')}`);
    }

    const positionSourceId = asString(peak, 'positionSourceId', peakLabel);
    const elevationSourceId = asString(peak, 'elevationSourceId', peakLabel);
    for (const [field, id] of [
      ['positionSourceId', positionSourceId],
      ['elevationSourceId', elevationSourceId],
    ] as const) {
      if (!sourceIds.has(id)) fail(peakLabel, `${field} "${id}" resolves to no source`);
    }

    return {
      id: asString(peak, 'id', peakLabel),
      name: asString(peak, 'name', peakLabel),
      lat,
      lon,
      elevationM: asFiniteNumber(peak, 'elevationM', peakLabel),
      positionSourceId,
      elevationSourceId,
      elevationSourceKind: kind as ElevationSource,
      usedBy: asStringArray(peak, 'usedBy', peakLabel),
      ...optionalNote(asOptionalString(peak, 'note', peakLabel)),
    };
  });

  const peakIds = new Set<string>();
  for (const peak of peaks) {
    if (peakIds.has(peak.id)) fail(label, `duplicate peak id ${peak.id}`);
    peakIds.add(peak.id);
  }

  return { version, description, sources, peaks };
}

/** Spread helper: keeps `note` off the object entirely when it is absent. */
function optionalNote(note: string | undefined): { note?: string } {
  return note === undefined ? {} : { note };
}

/** The core-facing view of a record. Height and provenance travel together. */
export function toPeak(record: PeakRecord): Peak {
  return {
    id: record.id,
    name: record.name,
    lat: record.lat,
    lon: record.lon,
    elevationM: record.elevationM,
    elevationSource: record.elevationSourceKind,
  };
}

/** The `PeaksProvider` view of a record. `elevationM` is never null here. */
export function toPeakCandidate(record: PeakRecord): PeakCandidate {
  return {
    id: record.id,
    name: record.name,
    lat: record.lat,
    lon: record.lon,
    elevationM: record.elevationM,
    elevationSource: record.elevationSourceKind,
  };
}

/** Total order on peak ids — the tie-break both stores use. */
export function compareRecordId(a: PeakRecord, b: PeakRecord): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Is this peak inside the box?
 *
 * Longitude is compared through `lonWithinBounds`, the same rule
 * `tileNamesForBounds` uses to decide which CELLS a box touches. They used to
 * disagree: cell selection normalised, this comparison did not, so a box near
 * the antimeridian (`boundingBoxAround` emits 179.33 … 180.47 there) loaded
 * both cells and then discarded every peak stored as a negative longitude —
 * and, with `allowEmpty` unset, called that "no named peaks in this area" about
 * records it was holding in memory. One box, one meaning.
 */
function withinBox(record: PeakRecord, box: BoundingBox): boolean {
  return (
    record.lat >= box.south &&
    record.lat <= box.north &&
    lonWithinBounds(record.lon, box.west, box.east)
  );
}

/**
 * A peak database held in memory, queried by radius or bounding box.
 *
 * Linear scans, deliberately: the committed dataset holds tens of peaks, a
 * full world import of `natural=peak` holds ~10⁶, and a spatial index for the
 * former is unearned complexity. If this ever carries the world, the seam to
 * change is `recordsWithin`, and its tests will still hold.
 */
export class LocalPeakStore implements PeaksProvider {
  readonly dataset: PeakDataset;

  private readonly byIdIndex: ReadonlyMap<string, PeakRecord>;

  constructor(dataset: PeakDataset) {
    this.dataset = dataset;
    this.byIdIndex = new Map(dataset.peaks.map((peak) => [peak.id, peak]));
  }

  /** Build from an untrusted parsed-JSON value, validating it first. */
  static fromUnknown(value: unknown, label = 'peak dataset'): LocalPeakStore {
    return new LocalPeakStore(parsePeakDataset(value, label));
  }

  get size(): number {
    return this.dataset.peaks.length;
  }

  byId(id: string): PeakRecord | undefined {
    return this.byIdIndex.get(id);
  }

  /** Every record whose `name` matches exactly. Names are not unique in OSM. */
  byName(name: string): readonly PeakRecord[] {
    return this.dataset.peaks.filter((peak) => peak.name === name);
  }

  /** Resolve a citation id to the source it names. */
  source(id: string): PeakSourceRecord | undefined {
    return this.dataset.sources.find((source) => source.id === id);
  }

  /**
   * Records within `radiusKm` of a point, NEAREST FIRST, each with its range.
   *
   * Distance is the great-circle distance on the datum sphere — the same
   * measure `sightPeak` uses — so a peak that passes this filter is at the
   * range the geometry core will later compute for it.
   *
   * Equal distances break on the peak id, which is what `TiledPeakStore` does
   * when it merges the sightings of several cells. Without it the two stores
   * answer the same question in different orders — dataset order here, id order
   * there — and anything that takes "the nearest n" or lays labels out in order
   * silently depends on which store it was handed.
   */
  recordsWithin(center: LatLng, radiusKm: number): readonly PeakRecordSighting[] {
    if (!(radiusKm >= 0)) {
      throw new RangeError(`radiusKm must be >= 0, received ${radiusKm}`);
    }
    const sightings: PeakRecordSighting[] = [];
    for (const record of this.dataset.peaks) {
      const distanceKm = haversineDistanceM(center, record) / 1000;
      if (distanceKm <= radiusKm) sightings.push({ record, distanceKm });
    }
    return sightings.sort(
      (a, b) => a.distanceKm - b.distanceKm || compareRecordId(a.record, b.record),
    );
  }

  /** Core-typed peaks within a radius, nearest first. The pipeline's entry point. */
  peaksWithin(center: LatLng, radiusKm: number): Promise<readonly Peak[]> {
    return Promise.resolve(this.recordsWithin(center, radiusKm).map(({ record }) => toPeak(record)));
  }

  /** Records inside a bounding box, in dataset order. */
  recordsInBox(box: BoundingBox): readonly PeakRecord[] {
    return this.dataset.peaks.filter((record) => withinBox(record, box));
  }

  /**
   * `PeaksProvider` contract, so this store is drop-in for the Overpass client.
   * Empty results reject with `empty-result` unless the caller opts out,
   * matching `OverpassPeaksProvider` exactly — `async` so that failures arrive
   * as a rejected promise rather than a synchronous throw, which is the
   * difference between a caller's `.catch` running and not running.
   */
  async fetchPeaks(
    area: PeakSearchArea,
    options: PeaksRequestOptions = {},
  ): Promise<readonly PeakCandidate[]> {
    if (options.signal?.aborted === true) {
      throw new ProviderError('aborted', 'Peak lookup was aborted by the caller');
    }
    const records =
      'bbox' in area
        ? this.recordsInBox(area.bbox)
        : this.recordsWithin(area.center, area.radiusKm).map(({ record }) => record);

    if (records.length === 0 && options.allowEmpty !== true) {
      throw new ProviderError(
        'empty-result',
        'The local peak dataset holds no named peaks in this area',
      );
    }
    return records.map(toPeakCandidate);
  }
}
