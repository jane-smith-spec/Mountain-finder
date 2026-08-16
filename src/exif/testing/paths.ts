/** Where the generated fixture photos live on disk. Node-only. */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PhotoFixture } from './fixtures';

/** Absolute path of fixtures/photos/, resolved relative to this source file. */
export const FIXTURE_PHOTO_DIR = fileURLToPath(
  new URL('../../../fixtures/photos/', import.meta.url),
);

export function fixturePhotoPath(fixture: PhotoFixture): string {
  return join(FIXTURE_PHOTO_DIR, fixture.fileName);
}
