/**
 * Committed terrain for the ground-truth viewpoints — NODE ONLY.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY WINDOWS, AND WHAT THEY HONESTLY COVER
 * ═══════════════════════════════════════════════════════════════════════════
 * The acceptance suite must run offline, from committed bytes, with no
 * dependence on `data/tiles/` (gitignored, empty on a fresh clone). A whole
 * SRTM1 tile is 25 MB, so what is committed instead is a RECTANGLE cut
 * byte-for-byte out of the real tile — the same trick `fixtures/tiles/`
 * already uses for the Matterhorn and Zermatt windows — sized to the terrain
 * each case's verdicts actually turn on.
 *
 * That sizing is the part to be honest about, because it decides what a green
 * test means:
 *
 *   gornergrat          10 km of terrain: covers the observer AND all three
 *                       must-see summits. A full end-to-end test.
 *   fort-william         8 km: covers Cow Hill, its north-east shoulder and
 *                       Ben Nevis. The occlusion claim is fully testable.
 *   kerry-park-seattle   3 km: covers Queen Anne Hill, which is what hides
 *                       Mount Baker. Rainier at 97 km is far outside the
 *                       window, so "Rainier is visible" here only means
 *                       "nothing within 3 km hides it".
 *   mount-diablo-summit  5 km: covers the summit and its immediate slopes.
 *                       Every must-see peak is 60–292 km away, so again the
 *                       occlusion test is local only.
 *
 * A limited window can produce a FALSE VISIBLE (terrain that would block is
 * outside it) but never a false hidden, so the must-NOT-see gates — the ones
 * the occlusion rule exists for — are exactly the ones the windows cover in
 * full. Each spec states its own limit in `coverageNote`, and the acceptance
 * suite prints it next to the verdict rather than letting a reader assume more
 * than was tested.
 *
 * `npm run fixtures:case-tiles` regenerates the windows from `data/tiles/`
 * (fetch those first with `npm run fetch:tiles`). Passing
 * `preferFullTiles: true` to {@link loadCaseTerrain} uses the full 25 MB tiles
 * when they happen to be on disk — the demo does that, tests never do.
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { TileElevationProvider } from '../../providers/tile-elevation.js';
import { DirectoryTileStore, loadTileWindow } from '../../providers/tile-directory.js';
import { MemoryTileStore, type TileStore } from '../../providers/tile-store.js';
import type { SweepConfig } from '../types.js';

/** Where the committed case windows live, relative to the repository root. */
export const CASE_TILE_FIXTURE_DIR = 'fixtures/tiles/cases';

/** Where full tiles land if someone runs `npm run fetch:tiles`. */
export const FULL_TILE_DIR = 'data/tiles';

/** Arc-seconds per degree — the SRTM1 posting the windows are cut on. */
const SAMPLES_PER_DEG = 3600;

export interface CaseTerrainBounds {
  readonly north: number;
  readonly south: number;
  readonly west: number;
  readonly east: number;
}

export interface CaseTerrainSpec {
  /** Matches `GroundTruthCase.id`. */
  readonly caseId: string;
  /** The SRTM tile the window is cut from. */
  readonly sourceTile: string;
  readonly bounds: CaseTerrainBounds;
  /** The sweep the acceptance suite and demo use for this case. */
  readonly sweep: Partial<SweepConfig>;
  /** What the window covers, and what it therefore cannot prove. */
  readonly coverageNote: string;
  /**
   * Whether this case asks the pipeline to judge peaks standing FARTHER OUT
   * than its window reaches — `PipelineConfig.judgeBeyondMeasuredTerrain`.
   *
   * The pipeline's default is to refuse (review 2, finding 2): a summit at
   * 134 km whose sightline was sampled for 3 km has not been measured, and a
   * `visible` verdict there would be a claim about ground nobody read. Two of
   * these cases are deliberately in exactly that position — their windows are
   * sized to the terrain that decides the OCCLUSION claims, not to the length
   * of the sightlines — and this flag is where they say so in code rather than
   * only in `coverageNote`. It changes what a verdict MEANS, never how hard the
   * case's assertions are: with it set, "visible" reads "nothing inside the
   * window hides it", which is precisely what the note already said.
   *
   * `false` where the window covers every peak the case names, so those cases
   * gate the refusing default end to end.
   */
  readonly judgeBeyondWindow: boolean;
}

/**
 * Per-case terrain windows.
 *
 * Bounds are on whole 1/3600° sample lines so the cut lands on real postings
 * with no resampling. Sweep steps are chosen per case: Fort William and Kerry
 * Park both turn on a shoulder a kilometre away, so they sample every 30 m —
 * the native posting — while Gornergrat's peaks are 5–10 km out and 90 m steps
 * cost a third of the reads for the same skyline.
 */
export const CASE_TERRAIN: readonly CaseTerrainSpec[] = [
  {
    caseId: 'gornergrat',
    sourceTile: 'N45E007',
    // North is capped at 46.0 because that IS the tile's northern edge; the
    // Gornergrat platform sits 1.9 km south of it. Everything the case asserts
    // lies south and west of the observer.
    bounds: { north: 46.0, south: 45.9, west: 7.62, east: 7.9 },
    sweep: { bearingStepDeg: 0.5, rangeStepM: 90, maxRangeKm: 10 },
    coverageNote:
      'Covers the observer and all three must-see summits (Matterhorn 9.6 km, ' +
      'Dufourspitze 8.4 km, Breithorn 5.4 km) with their intervening terrain. ' +
      'Rays running north leave the window after ~1.9 km, at the N45E007 tile edge.',
    judgeBeyondWindow: false,
  },
  {
    caseId: 'mount-diablo-summit',
    sourceTile: 'N37W122',
    bounds: { north: 37.93, south: 37.83, west: -121.97, east: -121.86 },
    sweep: { bearingStepDeg: 0.5, rangeStepM: 90, maxRangeKm: 5 },
    coverageNote:
      'Covers the summit and 5 km of its slopes. Every must-see peak in this ' +
      'case is 60-292 km away, so this window can only prove that nothing ' +
      'WITHIN 5 KM hides them — it says nothing about the Diablo Range at ' +
      '25 km. The case\'s own header argues that ridge line analytically.',
    // 60-292 km sightlines sampled for 5 km: every must-see verdict here is
    // "nothing within 5 km hides it", stated above and now declared in code.
    judgeBeyondWindow: true,
  },
  {
    caseId: 'kerry-park-seattle',
    sourceTile: 'N47W123',
    bounds: { north: 47.66, south: 47.6, west: -122.4, east: -122.32 },
    sweep: { bearingStepDeg: 0.5, rangeStepM: 30, maxRangeKm: 3 },
    coverageNote:
      'Covers Queen Anne Hill — the terrain that hides Mount Baker, ~500 m ' +
      'north of the park — at the native 30 m posting. Mount Rainier (97 km) ' +
      'and Baker (134 km) are far outside the window, so a "visible" verdict ' +
      'here means "nothing within 3 km hides it".',
    // Rainier (97 km) and Baker (134 km) both stand far outside the window.
    judgeBeyondWindow: true,
  },
  {
    caseId: 'fort-william',
    sourceTile: 'N56W006',
    // East stops at -5.0, the tile edge; Ben Nevis at -5.0035 is inside it by
    // 200 m, which is the whole reason this case needs only one tile.
    bounds: { north: 56.85, south: 56.77, west: -5.15, east: -5.0 },
    sweep: { bearingStepDeg: 0.5, rangeStepM: 30, maxRangeKm: 8 },
    coverageNote:
      'Covers the town, Cow Hill and its north-east shoulder, Meall an ' +
      't-Suidhe and the Ben Nevis summit (6.7 km) at the native 30 m posting. ' +
      'This is the one case where the disputed blocking ridge is inside the ' +
      'window, so the occlusion claim is fully testable here.',
    judgeBeyondWindow: false,
  },
];

export function caseTerrainSpec(caseId: string): CaseTerrainSpec | undefined {
  return CASE_TERRAIN.find((spec) => spec.caseId === caseId);
}

/** Sample offsets of a window inside its source tile, for the generator. */
export function windowCut(spec: CaseTerrainSpec): {
  readonly row0: number;
  readonly col0: number;
  readonly rows: number;
  readonly cols: number;
} {
  const { bounds } = spec;
  const tileNorth = Math.floor(bounds.south) + 1;
  const tileWest = Math.floor(bounds.west);
  return {
    row0: Math.round((tileNorth - bounds.north) * SAMPLES_PER_DEG),
    col0: Math.round((bounds.west - tileWest) * SAMPLES_PER_DEG),
    rows: Math.round((bounds.north - bounds.south) * SAMPLES_PER_DEG) + 1,
    cols: Math.round((bounds.east - bounds.west) * SAMPLES_PER_DEG) + 1,
  };
}

/** Path of a case window's sidecar. */
export function caseWindowMetaPath(caseId: string, dir = CASE_TILE_FIXTURE_DIR): string {
  return join(dir, `${caseId}-window.json`);
}

export type CaseTerrainOrigin = 'committed-window' | 'full-tile';

export interface CaseTerrain {
  readonly spec: CaseTerrainSpec;
  readonly elevation: TileElevationProvider;
  readonly store: TileStore;
  /** Which of the two sources answered. Tests must always see the window. */
  readonly origin: CaseTerrainOrigin;
  /** Human-readable provenance line for a report or a demo header. */
  readonly provenance: string;
}

/**
 * Load a case's terrain as an `ElevationProvider`.
 *
 * The committed window is registered in a `MemoryTileStore` under its SOURCE
 * TILE NAME, so `tileNameFor(lat, lon)` finds it exactly as it would find the
 * real tile — and a coordinate outside the cut reads `outside-tile`, i.e. no
 * data, rather than wrapping round to the wrong postings.
 */
export async function loadCaseTerrain(
  caseId: string,
  options: {
    readonly preferFullTiles?: boolean;
    readonly fixtureDir?: string;
    readonly tileDir?: string;
  } = {},
): Promise<CaseTerrain> {
  const spec = caseTerrainSpec(caseId);
  if (spec === undefined) {
    throw new Error(
      `No terrain window is registered for case "${caseId}". ` +
        `Known cases: ${CASE_TERRAIN.map((entry) => entry.caseId).join(', ')}.`,
    );
  }

  const tileDir = options.tileDir ?? FULL_TILE_DIR;
  if (options.preferFullTiles === true && (await exists(join(tileDir, `${spec.sourceTile}.hgt`)))) {
    const store = new DirectoryTileStore(tileDir);
    return {
      spec,
      store,
      elevation: new TileElevationProvider(store),
      origin: 'full-tile',
      provenance: `full SRTM1 tile ${spec.sourceTile} from ${tileDir}/`,
    };
  }

  const metaPath = caseWindowMetaPath(caseId, options.fixtureDir ?? CASE_TILE_FIXTURE_DIR);
  const { tile, meta } = await loadTileWindow(metaPath);
  const store = new MemoryTileStore([[meta.source.tile, tile]]);
  return {
    spec,
    store,
    elevation: new TileElevationProvider(store),
    origin: 'committed-window',
    provenance:
      `committed window ${meta.name} (${tile.geometry.rows}x${tile.geometry.cols} samples ` +
      `cut from ${meta.source.tile} at row ${meta.source.extractedFromRow}, ` +
      `col ${meta.source.extractedFromCol})`,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
