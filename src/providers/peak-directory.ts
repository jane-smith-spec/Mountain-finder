/**
 * Loading a tiled peak dataset from disk.
 *
 * NODE ONLY — like `tile-directory.ts` and `fixture-store.ts`, this is the
 * filesystem edge. `peak-tile-store.ts` itself never opens a file: it takes a
 * loader, so the same store serves a node script, a browser fetch and a test
 * map without a single branch on the environment.
 */

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { ProviderError } from './errors.js';
import {
  TiledPeakStore,
  parsePeakCellIndex,
  type PeakCellEntry,
  type PeakCellLoader,
} from './peak-tile-store.js';

/**
 * A loader that reads each cell file relative to the index that names it.
 *
 * Cell paths are resolved against the index's own directory and then checked to
 * be inside it: an index is data, and data that can name `../../etc/passwd` is
 * a file-read primitive rather than a manifest.
 */
export function peakCellFileLoader(indexPath: string): PeakCellLoader {
  const root = resolve(dirname(indexPath));
  return async (entry: PeakCellEntry): Promise<unknown | null> => {
    if (isAbsolute(entry.file)) {
      throw new ProviderError('bad-response', `Cell ${entry.name} names an absolute path`);
    }
    const target = resolve(join(root, entry.file));
    if (target !== root && !target.startsWith(`${root}/`)) {
      throw new ProviderError(
        'bad-response',
        `Cell ${entry.name} names ${entry.file}, which escapes ${root}`,
      );
    }
    try {
      return JSON.parse(await readFile(target, 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };
}

/** Read `<dir>/index.json` and return a store that lazily loads its cells. */
export async function loadPeakCellIndex(indexPath: string): Promise<TiledPeakStore> {
  const raw = JSON.parse(await readFile(indexPath, 'utf8')) as unknown;
  const index = parsePeakCellIndex(raw, indexPath);
  return new TiledPeakStore(index, peakCellFileLoader(indexPath));
}
