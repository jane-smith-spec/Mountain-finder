/**
 * A peak database split into 1°×1° cells, so a query loads only what it needs.
 *
 * WHY NOT ONE FILE
 *   `LocalPeakStore` holds the whole dataset in memory and scans it linearly.
 *   That is right for the 15 cited ground-truth summits and wrong the moment
 *   real coverage arrives: an Overture import of the Alps alone is tens of
 *   thousands of summits, and the app's actual question is always the same
 *   narrow one — "which named peaks are within ~200 km of this one point?".
 *   Loading a continent to answer that is the sort of thing that works on a
 *   laptop and fails on the phone this is eventually going to run on.
 *
 * WHY 1° CELLS NAMED LIKE SRTM TILES
 *   Because `N45E007` already means something in this repository. The terrain
 *   side is already cut into 1° tiles with `tileNameFor` / `tileNamesForBounds`
 *   handling the hemispheres, the antimeridian and the poles, and those
 *   functions are tested. Reusing them means the peak index and the elevation
 *   index are addressed identically — the same query resolves to the same cell
 *   names in both — and no second, subtly different, cell-naming rule exists to
 *   go wrong at 0° or 180°.
 *
 * WHY THE LOADER IS INJECTED
 *   Same seam as `TileStore`. This module never opens a file or issues a
 *   request; it is handed a function from cell name to parsed JSON. A node
 *   script passes a filesystem loader, the browser would pass a fetch loader,
 *   and tests pass a map — so the store itself is testable with no I/O at all.
 *
 * The store implements `PeaksProvider`, so the pipeline is unchanged: it is a
 * drop-in for `LocalPeakStore` and for the Overpass client.
 */

import { EARTH_RADIUS_M, toDegrees, toRadians } from '../core/geodesy.js';
import type { LatLng, Peak } from '../core/types.js';
import { ProviderError } from './errors.js';
import {
  LocalPeakStore,
  parsePeakDataset,
  type PeakDataset,
  type PeakRecord,
  type PeakRecordSighting,
  type PeakSourceRecord,
} from './peak-store.js';
import type {
  BoundingBox,
  PeakCandidate,
  PeakSearchArea,
  PeaksProvider,
  PeaksRequestOptions,
} from './peaks.js';
import { tileNameFor, tileNamesForBounds } from './tile-store.js';

/**
 * The smallest degree box that contains every point within `radiusKm`.
 *
 * Derivation (spherical Earth, not taken from the code it feeds):
 *   Let δ = r/R be the angular radius and φ the centre latitude. The circle
 *   reaches δ north and δ south of the centre, so the latitude span is φ ± δ.
 *   Its extreme longitudes occur where the circle is tangent to a meridian;
 *   the spherical right triangle formed by the pole, the centre and the point
 *   of tangency gives sin(Δλ) = sin(δ) / cos(φ), so Δλ = asin(sin δ / cos φ).
 *   When sin δ / cos φ ≥ 1 the circle encloses a pole and every longitude is
 *   inside it.
 *
 * The naive `Δλ = δ / cos φ` used for tile fetching is NOT a substitute here:
 * at φ = 60°, δ = 1° it gives 2.000° where the true bound is 2.00035°, so it
 * under-covers, and a peak in the missing sliver would be silently absent
 * rather than visibly wrong. This box must be a superset — the caller filters
 * by true great-circle distance afterwards, so being generous costs at most one
 * extra cell load, while being tight loses summits.
 */
export function boundingBoxAround(center: LatLng, radiusKm: number): BoundingBox {
  if (!Number.isFinite(radiusKm) || radiusKm < 0) {
    throw new RangeError(`radiusKm must be a non-negative number, received ${radiusKm}`);
  }
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon)) {
    throw new RangeError(`Cannot build a box around lat ${center.lat}, lon ${center.lon}`);
  }
  const deltaDeg = toDegrees((radiusKm * 1000) / EARTH_RADIUS_M);
  const south = center.lat - deltaDeg;
  const north = center.lat + deltaDeg;
  const cosLat = Math.cos(toRadians(center.lat));
  const sinDelta = Math.sin(toRadians(deltaDeg));
  const ratio = cosLat <= 0 ? Infinity : sinDelta / cosLat;
  if (!(ratio < 1) || south <= -90 || north >= 90) {
    return {
      south: Math.max(-90, south),
      north: Math.min(90, north),
      west: -180,
      east: 180,
    };
  }
  const deltaLonDeg = toDegrees(Math.asin(ratio));
  return {
    south,
    north,
    west: center.lon - deltaLonDeg,
    east: center.lon + deltaLonDeg,
  };
}

/** One cell listed in the index. */
export interface PeakCellEntry {
  /** `N45E007` — the SRTM tile name of the cell's south-west corner. */
  readonly name: string;
  /** How many peaks the cell file holds. Checked on load. */
  readonly peaks: number;
  /** Path to the cell file, relative to the index. */
  readonly file: string;
}

/**
 * The manifest of a tiled peak dataset: the citations, and which cells exist.
 *
 * Citations live here rather than in every cell file so a peak's provenance is
 * stated once and cannot drift between cells — and so `parsePeakDataset` can
 * still be the single validator: a cell is checked by handing it the index's
 * `sources` and running the existing strict parser over the result.
 */
export interface PeakCellIndex {
  readonly version: number;
  readonly description: string;
  /** The upstream release this was cut from, e.g. an Overture release id. */
  readonly release: string;
  /** Command that reproduces this dataset. */
  readonly generatedBy: string;
  /** The area asked for. Peaks outside it are absent by design, not by loss. */
  readonly bounds: BoundingBox;
  readonly sources: readonly PeakSourceRecord[];
  readonly cells: readonly PeakCellEntry[];
  readonly peakCount: number;
}

const CELL_INDEX_VERSION = 1;

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

function asFiniteNumber(raw: Record<string, unknown>, field: string, label: string): number {
  const value = raw[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(label, `${field} must be a finite number`);
  }
  return value;
}

function asBox(value: unknown, label: string): BoundingBox {
  const raw = asRecord(value, label);
  const south = asFiniteNumber(raw, 'south', label);
  const north = asFiniteNumber(raw, 'north', label);
  const west = asFiniteNumber(raw, 'west', label);
  const east = asFiniteNumber(raw, 'east', label);
  if (north < south) fail(label, `north ${north} is below south ${south}`);
  return { south, north, west, east };
}

/**
 * Validate a parsed manifest. Strict for the same reason `parsePeakDataset` is:
 * a peak index that quietly lists a cell it does not have produces an empty
 * answer that looks exactly like "there are no mountains here".
 */
export function parsePeakCellIndex(value: unknown, label = 'peak cell index'): PeakCellIndex {
  const raw = asRecord(value, label);
  const version = asFiniteNumber(raw, 'version', label);
  if (version !== CELL_INDEX_VERSION) {
    fail(label, `version must be ${CELL_INDEX_VERSION}, received ${version}`);
  }

  // Sources are validated by the same code that validates a flat dataset, so
  // there is exactly one definition of what a citation must look like.
  const probe = parsePeakDataset(
    {
      version,
      description: asString(raw, 'description', label),
      sources: raw['sources'],
      peaks: [],
    },
    `${label} (sources)`,
  );

  const rawCells = raw['cells'];
  if (!Array.isArray(rawCells)) fail(label, 'cells must be an array');
  const seen = new Set<string>();
  const cells: PeakCellEntry[] = rawCells.map((entry, index) => {
    const cellLabel = `${label}.cells[${index}]`;
    const cell = asRecord(entry, cellLabel);
    const name = asString(cell, 'name', cellLabel).toUpperCase();
    if (seen.has(name)) fail(label, `duplicate cell ${name}`);
    seen.add(name);
    const peaks = asFiniteNumber(cell, 'peaks', cellLabel);
    if (!Number.isInteger(peaks) || peaks < 0) fail(cellLabel, 'peaks must be a count');
    return { name, peaks, file: asString(cell, 'file', cellLabel) };
  });

  const peakCount = asFiniteNumber(raw, 'peakCount', label);
  const summed = cells.reduce((total, cell) => total + cell.peaks, 0);
  if (peakCount !== summed) {
    fail(label, `peakCount ${peakCount} disagrees with the cells' ${summed}`);
  }

  return {
    version,
    description: probe.description,
    release: asString(raw, 'release', label),
    generatedBy: asString(raw, 'generatedBy', label),
    bounds: asBox(raw['bounds'], `${label}.bounds`),
    sources: probe.sources,
    cells,
    peakCount,
  };
}

/**
 * Where a cell's JSON comes from. `null` means "this cell file is not held",
 * which is an error when the index lists it — the index is the promise.
 */
export type PeakCellLoader = (entry: PeakCellEntry) => Promise<unknown | null>;

/** The parsed contents of one cell file. */
export function parsePeakCell(
  value: unknown,
  entry: PeakCellEntry,
  sources: readonly PeakSourceRecord[],
  label = `peak cell ${entry.name}`,
): PeakDataset {
  const raw = asRecord(value, label);
  const cellName = asString(raw, 'cell', label).toUpperCase();
  if (cellName !== entry.name) {
    fail(label, `file declares cell ${cellName} but the index lists it as ${entry.name}`);
  }
  const dataset = parsePeakDataset(
    {
      version: CELL_INDEX_VERSION,
      description: label,
      sources,
      peaks: raw['peaks'],
    },
    label,
  );
  if (dataset.peaks.length !== entry.peaks) {
    fail(label, `holds ${dataset.peaks.length} peaks, the index says ${entry.peaks}`);
  }
  // A peak filed in the wrong cell would be invisible to every query whose box
  // does not happen to include both cells — the one failure this layout can
  // produce that no downstream test would catch.
  for (const peak of dataset.peaks) {
    const belongs = tileNameFor(peak.lat, peak.lon);
    if (belongs !== entry.name) {
      fail(label, `peak ${peak.id} at ${peak.lat},${peak.lon} belongs in cell ${belongs}`);
    }
  }
  return dataset;
}

/**
 * A peak database addressed by 1° cell, loading only the cells a query touches.
 *
 * Loaded cells are cached for the life of the store, so a session that pans
 * around one valley pays for that valley once.
 */
export class TiledPeakStore implements PeaksProvider {
  readonly index: PeakCellIndex;

  private readonly loader: PeakCellLoader;
  private readonly entries: ReadonlyMap<string, PeakCellEntry>;
  private readonly loaded = new Map<string, LocalPeakStore>();
  private readonly inFlight = new Map<string, Promise<LocalPeakStore>>();

  constructor(index: PeakCellIndex, loader: PeakCellLoader) {
    this.index = index;
    this.loader = loader;
    this.entries = new Map(index.cells.map((cell) => [cell.name, cell]));
  }

  /** Cell names held by this dataset, in index order. */
  get cellNames(): readonly string[] {
    return this.index.cells.map((cell) => cell.name);
  }

  /** How many cells have actually been read so far. The point of the layout. */
  get loadedCellCount(): number {
    return this.loaded.size;
  }

  /** Total peaks across every cell, from the index — no cell is loaded to answer. */
  get size(): number {
    return this.index.peakCount;
  }

  /** Cells the dataset holds that a box touches. Cells it does not hold are skipped. */
  cellsForBox(box: BoundingBox): readonly PeakCellEntry[] {
    const wanted = tileNamesForBounds({
      south: Math.max(-90, box.south),
      north: Math.min(90, box.north),
      west: box.west,
      east: box.east,
    });
    const entries: PeakCellEntry[] = [];
    for (const name of wanted) {
      const entry = this.entries.get(name);
      if (entry !== undefined) entries.push(entry);
    }
    return entries;
  }

  private async cell(entry: PeakCellEntry): Promise<LocalPeakStore> {
    const cached = this.loaded.get(entry.name);
    if (cached !== undefined) return cached;
    const pending = this.inFlight.get(entry.name);
    if (pending !== undefined) return pending;

    const promise = (async (): Promise<LocalPeakStore> => {
      const raw = await this.loader(entry);
      if (raw === null) {
        throw new ProviderError(
          'bad-response',
          `The peak index lists cell ${entry.name} (${entry.file}) but it could not be loaded`,
        );
      }
      const store = new LocalPeakStore(parsePeakCell(raw, entry, this.index.sources));
      this.loaded.set(entry.name, store);
      return store;
    })();
    this.inFlight.set(entry.name, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(entry.name);
    }
  }

  /** Records within `radiusKm` of a point, nearest first, each with its range. */
  async recordsWithin(
    center: LatLng,
    radiusKm: number,
  ): Promise<readonly PeakRecordSighting[]> {
    const entries = this.cellsForBox(boundingBoxAround(center, radiusKm));
    const stores = await Promise.all(entries.map((entry) => this.cell(entry)));
    const sightings: PeakRecordSighting[] = [];
    for (const store of stores) sightings.push(...store.recordsWithin(center, radiusKm));
    return sightings.sort((a, b) => a.distanceKm - b.distanceKm || compareId(a, b));
  }

  /** Records inside a bounding box. */
  async recordsInBox(box: BoundingBox): Promise<readonly PeakRecord[]> {
    const entries = this.cellsForBox(box);
    const stores = await Promise.all(entries.map((entry) => this.cell(entry)));
    const records: PeakRecord[] = [];
    for (const store of stores) records.push(...store.recordsInBox(box));
    return records;
  }

  /** Core-typed peaks within a radius, nearest first. The pipeline's entry point. */
  async peaksWithin(center: LatLng, radiusKm: number): Promise<readonly Peak[]> {
    const sightings = await this.recordsWithin(center, radiusKm);
    return sightings.map(({ record }) => toCorePeak(record));
  }

  /** `PeaksProvider` contract — identical semantics to `LocalPeakStore`. */
  async fetchPeaks(
    area: PeakSearchArea,
    options: PeaksRequestOptions = {},
  ): Promise<readonly PeakCandidate[]> {
    if (options.signal?.aborted === true) {
      throw new ProviderError('aborted', 'Peak lookup was aborted by the caller');
    }
    const records =
      'bbox' in area
        ? await this.recordsInBox(area.bbox)
        : (await this.recordsWithin(area.center, area.radiusKm)).map(({ record }) => record);

    if (records.length === 0 && options.allowEmpty !== true) {
      throw new ProviderError(
        'empty-result',
        'The local peak dataset holds no named peaks in this area',
      );
    }
    return records.map((record) => ({
      id: record.id,
      name: record.name,
      lat: record.lat,
      lon: record.lon,
      elevationM: record.elevationM,
      elevationSource: record.elevationSourceKind,
    }));
  }
}

function compareId(a: PeakRecordSighting, b: PeakRecordSighting): number {
  return a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0;
}

function toCorePeak(record: PeakRecord): Peak {
  return {
    id: record.id,
    name: record.name,
    lat: record.lat,
    lon: record.lon,
    elevationM: record.elevationM,
    elevationSource: record.elevationSourceKind,
  };
}

/** Which 1° cell a peak belongs in. The single rule used by importer and store. */
export function cellNameForPeak(peak: LatLng): string {
  return tileNameFor(peak.lat, peak.lon);
}
