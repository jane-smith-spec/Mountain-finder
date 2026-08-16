/**
 * The photo entry point: what a file supplies, what the terrain supplies, and
 * what nobody supplies.
 *
 * The interesting behaviour is the middle one. A photograph never carries the
 * height of the ground under the photographer, and that is exactly the quantity
 * the elevation tiles are good at — so it is looked up, and the pose is
 * re-resolved with the answer. A missing HEADING, by contrast, is left missing:
 * guessing which way the camera pointed would put every label somewhere
 * plausible and wrong.
 */

import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_M } from '../core/geodesy';
import type { Peak } from '../core/types';
import { STANDARD_DEFAULTS } from '../exif/resolve';
import type { PhotoExif } from '../exif/types';

import { annotatePhoto } from './photo';
import { FunctionElevationSource, StaticPeakSource } from './testing/elevation-sources';

const METRES_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;
const PLAIN_ELEVATION_M = 250;

/** A 4478 m summit 10 km due east of (0, 0), on the equator. */
const peaks: readonly Peak[] = [
  {
    id: 'test/high',
    name: 'High Peak',
    lat: 0,
    lon: 10_000 / METRES_PER_DEG,
    elevationM: 4478,
    elevationSource: 'unknown',
  },
];

/** A photo taken at (0, 0) looking due east on a 24 mm-equivalent lens. */
const fullExif: PhotoExif = {
  lat: 0,
  lon: 0,
  imgDirectionDeg: 90,
  imgDirectionRef: 'T',
  focalLength35mmMm: 24,
  imageWidthPx: 4000,
  imageHeightPx: 3000,
  hFovDeg: 73.73979529168804,
  vFovDeg: 53.13010235415598,
};

function sources(): {
  elevation: FunctionElevationSource;
  peaks: StaticPeakSource;
} {
  return {
    elevation: new FunctionElevationSource(() => PLAIN_ELEVATION_M, 'flat-test-plain'),
    peaks: new StaticPeakSource(peaks),
  };
}

const config = {
  sweep: { bearingStepDeg: 5, rangeStepM: 1000, maxRangeKm: 20 },
  peakRadiusKm: 50,
  clock: (): Date => new Date('2026-08-16T12:00:00.000Z'),
};

describe('annotatePhoto', () => {
  it('fills the ground elevation from the terrain and runs the scene', async () => {
    const { elevation, peaks: peakSource } = sources();
    const result = await annotatePhoto({
      exif: fullExif,
      resolveOptions: { defaults: STANDARD_DEFAULTS },
      elevation,
      peaks: peakSource,
      config,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    expect(result.groundElevationFromTerrain).toBe(true);
    expect(result.scene.observer.groundElevationM).toBe(PLAIN_ELEVATION_M);
    // STANDARD_DEFAULTS puts the camera 1.6 m above the ground.
    expect(result.scene.observer.eyeHeightM).toBe(1.6);
    expect(result.scene.camera.headingDeg).toBe(90);
    expect(result.scene.visible.map((peak) => peak.name)).toEqual(['High Peak']);
    // Dead ahead of a camera heading 90°.
    expect(result.scene.visible[0]?.image.x).toBeCloseTo(0.5, 12);
  });

  it('lets a user override beat the terrain reading', async () => {
    const { elevation, peaks: peakSource } = sources();
    const result = await annotatePhoto({
      exif: fullExif,
      overrides: { groundElevationM: 900 },
      resolveOptions: { defaults: STANDARD_DEFAULTS },
      elevation,
      peaks: peakSource,
      config,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.scene.observer.groundElevationM).toBe(900);
    expect(result.groundElevationFromTerrain).toBe(false);
  });

  it('refuses to guess a missing heading', async () => {
    const { elevation, peaks: peakSource } = sources();
    const { imgDirectionDeg: _drop, imgDirectionRef: _dropRef, ...noHeading } = fullExif;

    const result = await annotatePhoto({
      exif: noHeading,
      resolveOptions: { defaults: STANDARD_DEFAULTS },
      elevation,
      peaks: peakSource,
      config,
    });

    expect(result.status).toBe('needs-manual');
    if (result.status !== 'needs-manual') return;
    expect(result.missing).toContain('headingDeg');
    // Everything the file DID carry is still resolved, so a UI can prefill.
    expect(result.pose.fields.lat.status).toBe('resolved');
    expect(result.pose.fields.groundElevationM.status).toBe('resolved');
  });

  it('does not consult the terrain when the pose already has the ground height', async () => {
    const { elevation, peaks: peakSource } = sources();
    await annotatePhoto({
      exif: fullExif,
      overrides: { groundElevationM: 900 },
      resolveOptions: { defaults: STANDARD_DEFAULTS },
      elevation,
      peaks: peakSource,
      config,
    });
    // One point per ray sample only — no extra observer lookup. 72 rays × 20.
    expect(elevation.pointsRequested).toBe(72 * 20);
  });
});
