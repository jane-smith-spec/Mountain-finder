/**
 * The committed peak dataset, parsed and ready to query (BUILD 1 / decision D7).
 *
 * Imported as JSON rather than read from disk so the same store works in the
 * browser bundle, in vitest and in a node script with no filesystem seam to
 * mock. `parsePeakDataset` still validates it: the file is data, and data that
 * is only ever validated by the type checker is not validated at all.
 *
 * WHERE THE NUMBERS COME FROM. Every coordinate and height was copied out of
 * the ground-truth case files under tests/acceptance/cases/, each of which
 * carries its own citation, retrieval date and access note. Nothing here was
 * invented, and nothing here was sampled from the elevation tiles — see the
 * module docs on src/providers/peak-store.ts for why sampling summit heights
 * from SRTM would put every alpine label hundreds of metres low and sideways.
 */

import { LocalPeakStore, type PeakDataset } from '../../src/providers/peak-store';
import datasetJson from './ground-truth-peaks.json';

/** The validated dataset. Throws at import time if the JSON ever goes bad. */
export const groundTruthPeakDataset: PeakDataset = LocalPeakStore.fromUnknown(
  datasetJson,
  'fixtures/peaks/ground-truth-peaks.json',
).dataset;

/** A ready-to-inject peak source for the pipeline, tests and the demo script. */
export const groundTruthPeakStore = new LocalPeakStore(groundTruthPeakDataset);
