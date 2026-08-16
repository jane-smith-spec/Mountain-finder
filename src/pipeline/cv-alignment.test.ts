/**
 * The CV seam: does the one-call entry point behave the way a caller in
 * `src/app` would need it to, without any of them having to re-derive the rules?
 *
 * The geometry is proved in `src/cv/align.test.ts`; nothing is re-proved here.
 * What is asserted is the contract at the boundary — that a failure produces no
 * corrected pose, that a success produces one that differs from the input by
 * exactly the reported offsets, and that the human-readable summary never comes
 * out empty for any branch.
 */

import { describe, expect, it } from 'vitest';

import { cameraPoseFromFocalLength } from '../core/projection.js';
import type { CameraPose } from '../core/types.js';
import { signatureProfile } from '../cv/testing/profiles.js';
import { renderFog, renderSkylinePhoto } from '../cv/testing/raster.js';
import { annotateScene } from './annotate.js';
import { alignSceneToPhoto, describeAlignment } from './cv-alignment.js';
import { loadCaseTerrain } from './testing/case-terrain.js';

const WIDTH_PX = 900;
const HEIGHT_PX = 675;
const PROFILE = signatureProfile(265, 60);

const TRUE_POSE: CameraPose = cameraPoseFromFocalLength({
  headingDeg: 265.4,
  pitchDeg: 2,
  focalLength35mm: 28,
  imageWidthPx: WIDTH_PX,
  imageHeightPx: HEIGHT_PX,
});

const PHOTO = renderSkylinePhoto({
  widthPx: WIDTH_PX,
  heightPx: HEIGHT_PX,
  pose: TRUE_POSE,
  profile: PROFILE,
});

/** The pose the scene was computed with: wrong by exactly these offsets. */
const INJECTED_HEADING_DEG = 9.5;
const INJECTED_PITCH_DEG = 1.25;
const NOMINAL_POSE: CameraPose = {
  ...TRUE_POSE,
  headingDeg: TRUE_POSE.headingDeg - INJECTED_HEADING_DEG,
  pitchDeg: TRUE_POSE.pitchDeg - INJECTED_PITCH_DEG,
};

describe('alignSceneToPhoto', () => {
  it('recovers the injected offsets and hands back a usable corrected pose', () => {
    const result = alignSceneToPhoto({
      image: PHOTO,
      scene: { camera: NOMINAL_POSE, horizon: PROFILE },
    });

    expect(result.alignment.status).toBe('aligned');
    expect(result.correctedCamera).toBeDefined();
    if (result.alignment.status === 'failed' || result.correctedCamera === undefined) return;

    expect(Math.abs(result.alignment.headingOffsetDeg - INJECTED_HEADING_DEG)).toBeLessThan(0.5);
    expect(Math.abs(result.alignment.pitchOffsetDeg - INJECTED_PITCH_DEG)).toBeLessThan(0.5);

    // The corrected pose is the input plus the offsets, and nothing else moved.
    expect(result.correctedCamera.headingDeg).toBeCloseTo(
      NOMINAL_POSE.headingDeg + result.alignment.headingOffsetDeg,
      10,
    );
    expect(result.correctedCamera.pitchDeg).toBeCloseTo(
      NOMINAL_POSE.pitchDeg + result.alignment.pitchOffsetDeg,
      10,
    );
    expect(result.correctedCamera.hFovDeg).toBe(NOMINAL_POSE.hFovDeg);
    expect(result.correctedCamera.vFovDeg).toBe(NOMINAL_POSE.vFovDeg);
    expect(result.correctedCamera.rollDeg).toBe(NOMINAL_POSE.rollDeg);

    // …and it lands on the pose the photograph was actually taken with.
    expect(result.correctedCamera.headingDeg).toBeCloseTo(TRUE_POSE.headingDeg, 1);
  });

  it('returns the extracted skyline alongside, for diagnostics and overlays', () => {
    const result = alignSceneToPhoto({
      image: PHOTO,
      scene: { camera: NOMINAL_POSE, horizon: PROFILE },
    });
    expect(result.skyline.widthPx).toBe(WIDTH_PX);
    expect(result.skyline.heightPx).toBe(HEIGHT_PX);
    expect(result.skyline.coverage01).toBeGreaterThan(0.9);
  });

  it('withholds the corrected pose entirely when the alignment fails', () => {
    const result = alignSceneToPhoto({
      image: renderFog(WIDTH_PX, HEIGHT_PX, 11),
      scene: { camera: NOMINAL_POSE, horizon: PROFILE },
    });
    expect(result.alignment.status).toBe('failed');
    expect(result.correctedCamera).toBeUndefined();
  });

  it('passes options through to both stages', () => {
    // A 12° window cannot contain a 9.5° offset's peak plus a margin, so the
    // option must actually reach the aligner for this to change the verdict.
    const narrow = alignSceneToPhoto({
      image: PHOTO,
      scene: { camera: NOMINAL_POSE, horizon: PROFILE },
      align: { headingRangeDeg: 6 },
    });
    expect(narrow.alignment.status).toBe('failed');

    const coarse = alignSceneToPhoto({
      image: PHOTO,
      scene: { camera: NOMINAL_POSE, horizon: PROFILE },
      skyline: { columnCount: 64 },
    });
    expect(coarse.skyline.columns).toHaveLength(64);
  });
});

describe('describeAlignment', () => {
  it('says something specific for every branch, so no state renders as blank', () => {
    const good = alignSceneToPhoto({
      image: PHOTO,
      scene: { camera: NOMINAL_POSE, horizon: PROFILE },
    });
    expect(describeAlignment(good.alignment)).toMatch(/^heading -?\d+\.\d\d°, pitch/);

    const bad = alignSceneToPhoto({
      image: renderFog(WIDTH_PX, HEIGHT_PX, 11),
      scene: { camera: NOMINAL_POSE, horizon: PROFILE },
    });
    const description = describeAlignment(bad.alignment);
    expect(description).toContain('no alignment');
    expect(description).toContain('insufficient-skyline');
    expect(description.length).toBeGreaterThan(20);
  });

  it('marks a low-confidence result as tentative and lists the concerns', () => {
    const thin = alignSceneToPhoto({
      image: renderSkylinePhoto({
        widthPx: WIDTH_PX,
        heightPx: HEIGHT_PX,
        pose: TRUE_POSE,
        profile: PROFILE,
        fogBands: [
          [0, 0.3],
          [0.45, 0.75],
        ],
      }),
      scene: { camera: NOMINAL_POSE, horizon: PROFILE },
    });
    expect(thin.alignment.status).toBe('low-confidence');
    const description = describeAlignment(thin.alignment);
    expect(description).toContain('tentative');
    expect(description).toContain('insufficient-skyline');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REAL SRTM TERRAIN
 * ═══════════════════════════════════════════════════════════════════════════
 * Everything above runs against a closed-form analytic profile — three Gaussian
 * bumps, smooth and well behaved. Real terrain is not: the Gornergrat skyline
 * is a staircase of ray-sampling steps with 4 000 m pyramids in it, and an
 * aligner that only works on smooth signals would pass every test so far.
 *
 * So this runs the identical round trip over the horizon the *pipeline* builds
 * from the committed real-SRTM window (`fixtures/tiles/cases/gornergrat`,
 * genuine bytes cut out of tile N45E007). Offline, from committed data, no
 * dependence on the gitignored `data/tiles/`.
 *
 * The photograph is still synthetic — this repository has no photograph of
 * Gornergrat, and inventing one would be exactly the dishonesty
 * `src/render/synthetic-backdrop.ts` exists to prevent. What is real here is
 * the terrain, which is the half that decides whether the correlation has
 * anything to lock onto.
 */
describe('over the real Gornergrat SRTM horizon', () => {
  const WIDTH = 900;
  const HEIGHT = 675;

  /** The Gornergrat fixture photo's own EXIF framing: 265.4° true, 28 mm-equiv. */
  const gornergratCamera = cameraPoseFromFocalLength({
    headingDeg: 265.4,
    focalLength35mm: 28,
    imageWidthPx: WIDTH,
    imageHeightPx: HEIGHT,
  });

  async function gornergratHorizon() {
    const terrain = await loadCaseTerrain('gornergrat', { preferFullTiles: false });
    const scene = await annotateScene({
      observer: {
        lat: 45.98333,
        lon: 7.78222,
        eyeHeightM: 1.6,
        fallbackGroundElevationM: 3089,
      },
      camera: gornergratCamera,
      elevation: terrain.elevation,
      // No peaks are needed: the aligner only ever reads `scene.horizon`.
      peaks: { peaksWithin: async () => [] },
      config: {
        // A sector sweep, which is what a single-photo run would do: 130° of
        // compass centred on the frame, comfortably wider than the 65.5° hFOV
        // plus the ±25° heading search.
        sweep: { ...terrain.spec.sweep, bearingStepDeg: 0.25, startBearingDeg: 200, spanDeg: 130 },
        peakRadiusKm: 1,
      },
    });
    return scene.horizon;
  }

  it('recovers offsets injected against a genuine SRTM skyline, to within 0.5°', async () => {
    const horizon = await gornergratHorizon();
    // The sweep really did produce a skyline with shape in it — asserted, not
    // assumed, because a profile of 0.0° everywhere would make the rest of this
    // test vacuous.
    expect(horizon.length).toBeGreaterThan(400);
    const altitudes = horizon.map((point) => point.altitudeDeg);
    expect(Math.max(...altitudes) - Math.min(...altitudes)).toBeGreaterThan(5);

    const photo = renderSkylinePhoto({
      widthPx: WIDTH,
      heightPx: HEIGHT,
      pose: gornergratCamera,
      profile: horizon,
      noise01: 0.02,
      seed: 4242,
      clouds: [{ xNorm: 0.3, yNorm: 0.2, radiusNorm: 0.2, strength: 0.7 }],
    });

    for (const [headingOffsetDeg, pitchOffsetDeg] of [
      [0, 0],
      [7.3, 1.4],
      [-12.5, -2.2],
      [18, 0],
    ] as const) {
      const result = alignSceneToPhoto({
        image: photo,
        scene: {
          camera: {
            ...gornergratCamera,
            headingDeg: gornergratCamera.headingDeg - headingOffsetDeg,
            pitchDeg: gornergratCamera.pitchDeg - pitchOffsetDeg,
          },
          horizon,
        },
      });

      const label = `Δh=${headingOffsetDeg}° Δp=${pitchOffsetDeg}°`;
      expect(result.alignment.status, `${label}: ${describeAlignment(result.alignment)}`).toBe(
        'aligned',
      );
      if (result.alignment.status === 'failed') continue;
      expect(Math.abs(result.alignment.headingOffsetDeg - headingOffsetDeg)).toBeLessThan(0.5);
      expect(Math.abs(result.alignment.pitchOffsetDeg - pitchOffsetDeg)).toBeLessThan(0.5);
    }
  });

  it('still refuses fog when the terrain profile is a real one', async () => {
    const horizon = await gornergratHorizon();
    const result = alignSceneToPhoto({
      image: renderFog(WIDTH, HEIGHT, 17),
      scene: { camera: gornergratCamera, horizon },
    });
    expect(result.alignment.status).toBe('failed');
    expect(result.correctedCamera).toBeUndefined();
  });
});
