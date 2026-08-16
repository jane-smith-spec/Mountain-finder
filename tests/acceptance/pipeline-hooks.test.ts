/**
 * ACCEPTANCE — PIPELINE HOOKS (PLAN.md P6.3)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS NOW
 * ═══════════════════════════════════════════════════════════════════════════
 * The hooks are switched on. Every assertion below runs the REAL pipeline
 * (`src/pipeline`) against the fixtures' independent yardstick, offline:
 *
 *   synthetic scenes  the scene's own generator produces `ElevationSample[]`;
 *                     the pipeline samples that cloud along its own rays and
 *                     must reproduce the closed forms derived in the scene
 *                     module, which never imports src/core.
 *   real viewpoints   terrain comes from `fixtures/tiles/cases/` — rectangles
 *                     cut byte-for-byte out of real SRTM1 tiles and committed,
 *                     so nothing here depends on `data/tiles/` (gitignored).
 *                     Peaks come from `fixtures/peaks/`, whose coordinates and
 *                     heights were copied from these very case files.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE CONFIDENCE POLICY, UNCHANGED
 * ───────────────────────────────────────────────────────────────────────────
 *   confidence 'high'      HARD GATE. A failure fails the build.
 *   confidence 'medium'    REPORT ONLY. Printed loudly; never fails the build,
 *                          because the uncertainty is in the ground truth.
 *   `disputed`             INFORMATIONAL. The verdict is printed so a human can
 *                          weigh in. Never asserted, never promoted.
 *
 * No expectation in tests/acceptance/cases was weakened to make anything pass.
 * Where the pipeline contradicts a 'high' claim the assertion is left failing
 * and the finding is written up — that is the outcome this suite exists to
 * produce.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT A LIMITED TERRAIN WINDOW CAN AND CANNOT PROVE
 * ───────────────────────────────────────────────────────────────────────────
 * The committed windows are sized to what each case's verdicts turn on (see
 * `CASE_TERRAIN` in src/pipeline/testing/case-terrain.ts). A window that stops
 * at 3 km can produce a FALSE VISIBLE — terrain that would block sits outside
 * it — but never a false hidden. So the must-NOT-see gates are covered in full,
 * while a must-see verdict on a 100 km sightline means only "nothing inside the
 * window hides it". Each case prints its own `coverageNote` alongside the
 * verdicts rather than letting a reader assume more than was tested.
 */

import { afterAll, describe, expect, it } from 'vitest';

import {
  analyticScenes,
  apparentAltitudeDeg,
  greatCircleDistanceM,
  initialBearingDeg,
  type SyntheticScene,
} from '../../fixtures/scenes';
import { groundTruthPeakStore } from '../../fixtures/peaks';
import { interpolateHorizonAltitudeDeg } from '../../src/core/horizon';
import type { CameraPose } from '../../src/core/types';
import { annotateScene } from '../../src/pipeline/annotate';
import { loadCaseTerrain, caseTerrainSpec } from '../../src/pipeline/testing/case-terrain';
import {
  SampleCloudElevationSource,
  StaticPeakSource,
} from '../../src/pipeline/testing/elevation-sources';
import type { AnnotatedPeak, AnnotatedScene } from '../../src/pipeline/types';
import { groundTruthCases, type GroundTruthCase, type PeakExpectation } from './cases';

/* ══════════════════════════════════════════════════════════════════════════
 * Shared machinery
 * ══════════════════════════════════════════════════════════════════════════ */

const FIXED_CLOCK = (): Date => new Date('2026-08-16T00:00:00.000Z');

/** A camera that frames nothing in particular: visibility is frame-independent. */
function cameraFacing(bearingDeg: number): CameraPose {
  return { headingDeg: bearingDeg, pitchDeg: 0, rollDeg: 0, hFovDeg: 65.5, vFovDeg: 51.5 };
}

/** Lines printed at the end of the run — the report-only and informational half. */
const reportLines: string[] = [];

function report(line: string): void {
  reportLines.push(line);
}

/* ── Synthetic scenes ────────────────────────────────────────────────────── */

interface SceneRun {
  readonly scene: AnnotatedScene;
  readonly source: SampleCloudElevationSource;
}

const sceneRuns = new Map<string, Promise<SceneRun>>();

/**
 * Run one analytic scene through the pipeline, feeding it the scene's own
 * generated samples and the scene's own sampling geometry.
 *
 * The observer's ground elevation is SUPPLIED from the scene rather than looked
 * up: the scene states it, and a terrain lookup at range zero is not something
 * the sweep does (rays start one step out — see `sweepRangesM`).
 */
function runScene(scene: SyntheticScene): Promise<SceneRun> {
  const existing = sceneRuns.get(scene.id);
  if (existing !== undefined) return existing;

  const started = (async (): Promise<SceneRun> => {
    const source = new SampleCloudElevationSource(scene.generateSamples(), {
      dataset: `scene:${scene.id}`,
    });
    const annotated = await annotateScene({
      observer: {
        lat: scene.observer.lat,
        lon: scene.observer.lon,
        eyeHeightM: scene.observer.eyeHeightM,
        groundElevationM: scene.observer.groundElevationM,
      },
      camera: cameraFacing(0),
      elevation: source,
      peaks: new StaticPeakSource(scene.peaks),
      config: {
        sweep: {
          bearingStepDeg: scene.sampling.bearingStepDeg,
          rangeStepM: scene.sampling.rangeStepM,
          maxRangeKm: scene.sampling.maxRangeM / 1000,
        },
        peakRadiusKm: 500,
        clock: FIXED_CLOCK,
      },
    });
    return { scene: annotated, source };
  })();

  sceneRuns.set(scene.id, started);
  return started;
}

/** The profile point at a bearing that is one of the sampled rays. */
function profilePointAt(scene: AnnotatedScene, bearingDeg: number) {
  return scene.horizon.find((point) => Math.abs(point.bearingDeg - bearingDeg) < 1e-9);
}

/* ── Real viewpoints ─────────────────────────────────────────────────────── */

interface CaseRun {
  readonly scene: AnnotatedScene;
  readonly provenance: string;
  readonly origin: string;
  readonly coverageNote: string;
  /** What the DEM says the observer's ground height is, for comparison. */
  readonly terrainGroundElevationM: number | null;
}

const caseRuns = new Map<string, Promise<CaseRun>>();

/**
 * Run one real viewpoint end to end against its committed terrain window.
 *
 * The observer's ground elevation is READ FROM THE TERRAIN, with the case's
 * cited figure as the fallback if the window has no data there. That is what
 * the product does, and what the case files themselves ask for — Kerry Park's
 * says outright that its 113 m is an estimate and "a real run should take the
 * ground height from the DEM anyway". It also matters: at Kerry Park the two
 * figures differ by 9 m and the Mount Baker verdict flips between them (see the
 * findings printed at the end of this suite).
 *
 * Every angle asserted below is therefore recomputed by the fixtures' own
 * geometry kit from the SAME eye elevation the pipeline used, so the comparison
 * stays like-for-like; the DEM reading is separately checked against the cited
 * figure so the observer cannot drift unnoticed.
 */
function runCase(testCase: GroundTruthCase): Promise<CaseRun> {
  const existing = caseRuns.get(testCase.id);
  if (existing !== undefined) return existing;

  const started = (async (): Promise<CaseRun> => {
    const terrain = await loadCaseTerrain(testCase.id);
    const [observerReading] = await terrain.elevation.fetchElevations([
      { lat: testCase.observer.lat, lon: testCase.observer.lon },
    ]);

    const scene = await annotateScene({
      observer: {
        lat: testCase.observer.lat,
        lon: testCase.observer.lon,
        eyeHeightM: testCase.observer.eyeHeightM,
        fallbackGroundElevationM: testCase.observer.groundElevationM,
      },
      camera: cameraFacing(testCase.view.bearingDeg),
      elevation: terrain.elevation,
      peaks: groundTruthPeakStore,
      config: { sweep: terrain.spec.sweep, peakRadiusKm: 300, clock: FIXED_CLOCK },
    });

    return {
      scene,
      provenance: terrain.provenance,
      origin: terrain.origin,
      coverageNote: terrain.spec.coverageNote,
      terrainGroundElevationM: observerReading?.elevationM ?? null,
    };
  })();

  caseRuns.set(testCase.id, started);
  return started;
}

function peakByName(scene: AnnotatedScene, name: string): AnnotatedPeak | undefined {
  return scene.peaks.find((peak) => peak.name === name);
}

/**
 * Geometry from the case's cited coordinates, via the fixtures' independent
 * kit — which never imports src/core — using the eye elevation the run
 * actually used.
 */
function expectedGeometry(
  run: CaseRun,
  expectation: Pick<PeakExpectation, 'location' | 'elevationM'>,
): { distanceKm: number; bearingDeg: number; altitudeDeg: number } {
  const observer = run.scene.observer;
  const origin = { lat: observer.lat, lon: observer.lon };
  const distanceM = greatCircleDistanceM(origin, expectation.location);
  return {
    distanceKm: distanceM / 1000,
    bearingDeg: initialBearingDeg(origin, expectation.location),
    altitudeDeg: apparentAltitudeDeg(
      observer.groundElevationM + observer.eyeHeightM,
      expectation.elevationM,
      distanceM,
    ),
  };
}

function describeVerdict(peak: AnnotatedPeak | undefined): string {
  if (peak === undefined) return 'NOT IN THE PEAK DATABASE';
  return (
    `${peak.visible ? 'VISIBLE' : 'HIDDEN '} ` +
    `${peak.distanceKm.toFixed(2)} km, bearing ${peak.bearingDeg.toFixed(1)} deg, ` +
    `alt ${peak.altitudeDeg >= 0 ? '+' : ''}${peak.altitudeDeg.toFixed(3)} deg, ` +
    `clearance ${peak.clearanceDeg >= 0 ? '+' : ''}${peak.clearanceDeg.toFixed(3)} deg` +
    (peak.occludedBy === undefined
      ? ''
      : ` — behind ${peak.occludedBy.elevationM.toFixed(0)} m at ` +
        `${peak.occludedBy.distanceKm.toFixed(2)} km reaching ` +
        `${peak.occludedBy.altitudeDeg.toFixed(2)} deg`)
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Synthetic scenes through the real pipeline
 * ══════════════════════════════════════════════════════════════════════════ */

describe('P6.3 hooks — synthetic scenes through the real pipeline', () => {
  it('has scenes ready and waiting for the pipeline', () => {
    expect(analyticScenes.length).toBeGreaterThan(0);
    for (const scene of analyticScenes) {
      expect(scene.generateSamples().length).toBeGreaterThan(0);
    }
  });

  for (const scene of analyticScenes) {
    it(`${scene.id}: computed horizon matches the closed form within ${scene.toleranceDeg} deg`, async () => {
      const { scene: annotated, source } = await runScene(scene);

      // The pipeline walks its own rays with core's geodesy; the scene laid its
      // samples out with an independent copy of the same formula. If those two
      // ever disagreed about where a ray goes, the lookup would miss and this
      // is where it would show up — as a miss, not as a quietly interpolated
      // value from the wrong place.
      expect(source.misses).toBe(0);
      expect(annotated.horizon.length).toBe(Math.round(360 / scene.sampling.bearingStepDeg));

      for (const expected of scene.expectedSkyline) {
        const computedDeg = interpolateHorizonAltitudeDeg(annotated.horizon, expected.bearingDeg);
        expect(
          Math.abs(computedDeg - expected.altitudeDeg),
          `${scene.id} @ ${expected.bearingDeg} deg: computed ${computedDeg.toFixed(6)} vs ` +
            `closed form ${expected.altitudeDeg.toFixed(6)} — ${expected.note}`,
        ).toBeLessThan(scene.toleranceDeg);
      }
    });

    it(`${scene.id}: horizon attributes the skyline to the correct terrain`, async () => {
      const { scene: annotated } = await runScene(scene);
      let checked = 0;

      for (const expected of scene.expectedSkyline) {
        const point = profilePointAt(annotated, expected.bearingDeg);
        // Expectations stated at a bearing BETWEEN rays (the flat plane's
        // 187.5 deg) have no single sample to attribute, and interpolating a
        // distance across two rays would invent terrain. Those bearings are
        // covered by the interpolation hook instead.
        if (point === undefined) continue;
        checked += 1;

        expect(
          Math.abs(point.distanceKm * 1000 - expected.distanceM),
          `${scene.id} @ ${expected.bearingDeg} deg: skyline attributed to terrain at ` +
            `${(point.distanceKm * 1000).toFixed(0)} m, expected ${expected.distanceM.toFixed(0)} m`,
        ).toBeLessThanOrEqual(scene.distanceToleranceM);
        expect(point.elevationM).toBeCloseTo(expected.elevationM, 6);
      }
      expect(checked).toBeGreaterThan(0);
    });

    if (scene.expectedPeakVerdicts.length > 0) {
      it(`${scene.id}: visibility filter reproduces all ${scene.expectedPeakVerdicts.length} peak verdict(s)`, async () => {
        const { scene: annotated } = await runScene(scene);

        const expectedVisible = scene.expectedPeakVerdicts
          .filter((verdict) => verdict.visible)
          .map((verdict) => verdict.peakId)
          .sort();
        expect([...annotated.visible.map((peak) => peak.id)].sort()).toEqual(expectedVisible);

        for (const verdict of scene.expectedPeakVerdicts) {
          const peak = annotated.peaks.find((candidate) => candidate.id === verdict.peakId);
          expect(peak, `${scene.id}: no verdict produced for ${verdict.peakId}`).toBeDefined();
          if (peak === undefined) continue;

          expect(peak.visible).toBe(verdict.visible);
          expect(
            Math.abs(peak.altitudeDeg - verdict.peakAltitudeDeg),
            `${scene.id}/${verdict.peakId}: peak altitude ${peak.altitudeDeg.toFixed(6)} vs ` +
              `closed form ${verdict.peakAltitudeDeg.toFixed(6)}`,
          ).toBeLessThan(scene.toleranceDeg);

          // ── The occluding-terrain angle: REPORTED, not gated ────────────
          // `horizonAltitudeDeg` is the angle the peak was measured against —
          // the highest terrain NEARER than it, which is not the skyline
          // whenever something taller stands behind it. Comparing it with the
          // fixture's `skylineAltitudeDeg` turns out to be a comparison across
          // an exact tie, for two separate reasons, so it is printed rather
          // than asserted. Both are written up in the hand-off findings:
          //
          //  1. TIE-BREAK LUCK. A summit normally IS the terrain sample at its
          //     own distance. src/core excludes terrain at exactly the peak's
          //     range (strict <) precisely so a peak cannot hide itself — but
          //     the peak's range comes from a haversine and the sample's from
          //     the requested step, so the two differ in the last few bits and
          //     which side of the tie they land on is luck. When the sample
          //     counts, the reported occluding angle becomes the peak's OWN
          //     angle and the clearance collapses to ~0. The VERDICT is
          //     unaffected (an equal angle still clears), which is why the
          //     gates above stand; the reported clearance is not trustworthy at
          //     this exact coincidence, and that is worth knowing.
          //  2. STALE FIXTURE (found by the adversarial review, 2026-08-16).
          //     fixtures/scenes/conical-peak.ts still states this field under
          //     the SUPERSEDED "compare against the skyline" rule. src/core is
          //     RIGHT and the fixture is stale; a separate task fixes it. It is
          //     NOT worked around here and NOT copied into src/core.
          const occluderGapDeg = Math.abs(peak.horizonAltitudeDeg - verdict.skylineAltitudeDeg);
          const selfTie = Math.abs(peak.horizonAltitudeDeg - peak.altitudeDeg) < scene.toleranceDeg;
          if (occluderGapDeg >= scene.toleranceDeg) {
            report(
              `  ${scene.id}/${verdict.peakId} [occluding angle, not gated] pipeline ` +
                `${peak.horizonAltitudeDeg.toFixed(6)} deg vs fixture ` +
                `${verdict.skylineAltitudeDeg.toFixed(6)} deg (gap ` +
                `${occluderGapDeg.toFixed(6)} deg)` +
                (selfTie
                  ? ' — the peak was measured against its OWN terrain sample at its own range: tie-break luck'
                  : ' — investigate: neither a self-tie nor an agreed value'),
            );
          }
        }
      });
    }
  }

  it('flat-plane: interpolation at a non-sampled bearing is exact on a constant profile', async () => {
    const flatPlane = analyticScenes.find((scene) => scene.id === 'flat-plane');
    expect(flatPlane, 'the flat-plane scene must exist').toBeDefined();
    if (flatPlane === undefined) return;

    const { scene: annotated } = await runScene(flatPlane);

    // 187.5 deg lies between the 187 and 188 deg rays. On a plane every bearing
    // has the same skyline, so interpolation must return that same value — and
    // must reach it by bracketing the right pair, which a wrong seam or a wrong
    // weight would still get right here ONLY because the profile is constant.
    // Hence the second assertion: the bracketing neighbours are identified.
    const expectedDip = flatPlane.expectedSkyline.find(
      (point) => Math.abs(point.bearingDeg - 187.5) < 1e-9,
    );
    expect(expectedDip, 'flat-plane must state an expectation at 187.5 deg').toBeDefined();
    if (expectedDip === undefined) return;

    const interpolatedDeg = interpolateHorizonAltitudeDeg(annotated.horizon, 187.5);
    expect(Math.abs(interpolatedDeg - expectedDip.altitudeDeg)).toBeLessThan(
      flatPlane.toleranceDeg,
    );

    const before = profilePointAt(annotated, 187);
    const after = profilePointAt(annotated, 188);
    expect(before?.altitudeDeg).toBeDefined();
    expect(after?.altitudeDeg).toBeDefined();
    expect(interpolatedDeg).toBeCloseTo(before?.altitudeDeg ?? Number.NaN, 12);
    expect(interpolatedDeg).toBeCloseTo(after?.altitudeDeg ?? Number.NaN, 12);

    // And the seam: 359.5 deg is also between rays, and must not wrap to zero.
    expect(interpolateHorizonAltitudeDeg(annotated.horizon, 359.5)).toBeCloseTo(
      interpolatedDeg,
      12,
    );
  });

  // STILL A TODO, and honestly so: the SVG overlay builder (PLAN.md P4.1) is
  // being written in parallel by the renderer group. Everything it needs is
  // already produced here — `scene.horizon` and `scene.visible[].image` — so
  // this hook is one call away, but writing the assertion before the module
  // exists is exactly the failure MISSION.md describes.
  it.todo('every scene renders to an SVG overlay with flags at the computed positions (awaits P4.1, src/render)');
});

/* ══════════════════════════════════════════════════════════════════════════
 * Real viewpoints, end to end
 * ══════════════════════════════════════════════════════════════════════════ */

describe('P6.3 hooks — real viewpoints end to end (committed SRTM windows, offline)', () => {
  it('has cases ready and waiting for elevation fixtures', () => {
    expect(groundTruthCases.length).toBeGreaterThan(0);
  });

  for (const testCase of groundTruthCases) {
    const highMustSee = testCase.mustBeVisible.filter((p) => p.confidence === 'high');
    const mediumMustSee = testCase.mustBeVisible.filter((p) => p.confidence === 'medium');
    const highMustNotSee = testCase.mustNotBeVisible.filter((p) => p.confidence === 'high');
    const mediumMustNotSee = testCase.mustNotBeVisible.filter((p) => p.confidence === 'medium');

    it(`${testCase.id}: committed terrain fixture covers this viewpoint`, async () => {
      const spec = caseTerrainSpec(testCase.id);
      expect(spec, `no terrain window registered for ${testCase.id}`).toBeDefined();
      if (spec === undefined) return;

      const run = await runCase(testCase);

      // Offline by construction: the suite must read the committed window, not
      // a 25 MB tile someone happens to have fetched into data/tiles/.
      expect(run.origin).toBe('committed-window');
      expect(run.provenance).toContain(spec.sourceTile);

      // The ground height under the observer came from that window, not from
      // the case file's fallback — this is the SRTM use the data supports.
      expect(run.scene.observerResolution.groundElevationSource).toBe('terrain');

      // The window has to actually contain the observer, or every later
      // assertion would be measuring a hole.
      expect(
        run.terrainGroundElevationM,
        `${testCase.id}: the committed window has no data at the observer`,
      ).not.toBeNull();
      expect(run.scene.sweep.raysWithTerrain).toBe(run.scene.sweep.raysRequested);
      expect(run.scene.sweep.samplesWithElevation).toBeGreaterThan(0);

      // Ground-truth cross-check, REPORTED not gated: how the case's cited
      // ground elevation compares with what SRTM reads there. The allowance is
      // the case's own stated uncertainty plus 30 m for the DEM itself, which
      // is generous for flat ground and tight enough to catch the failure that
      // matters — reading the wrong tile, which is wrong by hundreds of metres.
      const terrainM = run.terrainGroundElevationM ?? Number.NaN;
      const citedM = testCase.observer.groundElevationM;
      const differenceM = terrainM - citedM;
      report(
        `  ${testCase.id}: observer ground cited ${citedM} m ` +
          `+-${testCase.observer.groundElevationUncertaintyM} m, SRTM reads ` +
          `${terrainM.toFixed(1)} m (${differenceM >= 0 ? '+' : ''}${differenceM.toFixed(1)} m)`,
      );
      expect(Math.abs(differenceM)).toBeLessThanOrEqual(
        testCase.observer.groundElevationUncertaintyM + 30,
      );
    });

    if (highMustSee.length > 0) {
      it(`${testCase.id}: labels all high-confidence must-see peaks (${highMustSee
        .map((p) => p.name)
        .join(', ')})`, async () => {
        const run = await runCase(testCase);

        for (const expectation of highMustSee) {
          const peak = peakByName(run.scene, expectation.name);
          expect(
            peak,
            `${testCase.id}: "${expectation.name}" is not in the peak database at all`,
          ).toBeDefined();
          if (peak === undefined) continue;

          // Geometry first, verdict second: a peak reported visible for the
          // wrong reason (wrong bearing, wrong range) is not a pass. The
          // expected values come from the fixtures' own geometry kit applied to
          // the case's cited coordinates — never from the pipeline.
          const expected = expectedGeometry(run, expectation);
          expect(peak.distanceKm).toBeCloseTo(expected.distanceKm, 1);
          expect(peak.bearingDeg).toBeCloseTo(expected.bearingDeg, 1);
          expect(
            Math.abs(peak.altitudeDeg - expected.altitudeDeg),
            `${testCase.id}/${expectation.name}: altitude ${peak.altitudeDeg.toFixed(4)} deg vs ` +
              `independently computed ${expected.altitudeDeg.toFixed(4)} deg`,
          ).toBeLessThan(0.05);

          // Summit height comes from the peak database, NEVER from the DEM.
          expect(peak.elevationM).toBe(expectation.elevationM);

          expect(
            peak.visible,
            `${testCase.id}: HIGH-confidence must-see "${expectation.name}" came out ` +
              `${describeVerdict(peak)}.\n    Rationale on file: ${expectation.rationale}\n` +
              `    Terrain: ${run.coverageNote}`,
          ).toBe(true);
          expect(Number.isFinite(peak.image.x)).toBe(true);
          expect(Number.isFinite(peak.image.y)).toBe(true);
        }
      });
    }

    if (mediumMustSee.length > 0) {
      it(`${testCase.id}: [report-only] medium-confidence must-see peaks (${mediumMustSee
        .map((p) => p.name)
        .join(', ')})`, async () => {
        const run = await runCase(testCase);

        for (const expectation of mediumMustSee) {
          const peak = peakByName(run.scene, expectation.name);
          // The GATE here is only that the pipeline produced a verdict — that
          // much is a property of the code. Whether the verdict matches the
          // claim is a property of the ground truth, so it is reported.
          expect(peak, `${testCase.id}: no verdict produced for ${expectation.name}`).toBeDefined();
          if (peak === undefined) continue;

          report(
            `  ${testCase.id} [medium, must-see] ${expectation.name}: ${describeVerdict(peak)}` +
              `${peak.visible ? '' : '  <-- DISAGREES WITH THE CLAIM (investigate the ground truth)'}`,
          );
        }
      });
    }

    if (highMustNotSee.length > 0) {
      it(`${testCase.id}: labels NONE of the high-confidence occluded peaks (${highMustNotSee
        .map((p) => p.name)
        .join(', ')})`, async () => {
        const run = await runCase(testCase);

        for (const expectation of highMustNotSee) {
          const peak = peakByName(run.scene, expectation.name);
          expect(
            peak,
            `${testCase.id}: "${expectation.name}" is not in the peak database, so this ` +
              'gate would pass for the wrong reason',
          ).toBeDefined();
          if (peak === undefined) continue;

          // The claim is about OCCLUSION, so the peak must first be above the
          // curvature horizon: a peak hidden by the curve of the Earth would
          // pass this gate while proving nothing about terrain.
          const expected = expectedGeometry(run, expectation);
          expect(peak.altitudeDeg).toBeCloseTo(expected.altitudeDeg, 1);

          expect(
            peak.visible,
            `${testCase.id}: HIGH-confidence must-NOT-see "${expectation.name}" came out ` +
              `${describeVerdict(peak)}.\n    Rationale on file: ${expectation.rationale}`,
          ).toBe(false);
          expect(
            peak.occludedBy,
            `${testCase.id}: "${expectation.name}" is hidden but no occluding terrain was named`,
          ).toBeDefined();
        }
      });
    }

    if (mediumMustNotSee.length > 0) {
      it(`${testCase.id}: [report-only] medium-confidence occluded peaks (${mediumMustNotSee
        .map((p) => p.name)
        .join(', ')})`, async () => {
        const run = await runCase(testCase);

        for (const expectation of mediumMustNotSee) {
          const peak = peakByName(run.scene, expectation.name);
          expect(peak, `${testCase.id}: no verdict produced for ${expectation.name}`).toBeDefined();
          if (peak === undefined) continue;

          report(
            `  ${testCase.id} [medium, must-NOT-see] ${expectation.name}: ${describeVerdict(peak)}` +
              `${peak.visible ? '  <-- DISAGREES WITH THE CLAIM (investigate the ground truth)' : ''}`,
          );
        }
      });
    }

    if (testCase.disputed.length > 0) {
      it(`${testCase.id}: [informational] report the verdict for disputed peaks (${testCase.disputed
        .map((p) => p.name)
        .join(', ')})`, async () => {
        const run = await runCase(testCase);

        for (const expectation of testCase.disputed) {
          const peak = peakByName(run.scene, expectation.name);
          // Never asserted either way — the literature itself disagrees. The
          // only gate is that a verdict exists to report.
          expect(peak, `${testCase.id}: no verdict produced for ${expectation.name}`).toBeDefined();
          report(
            `  ${testCase.id} [disputed] ${expectation.name}: ${describeVerdict(peak)}` +
              `\n      conflict: ${expectation.conflict.slice(0, 140)}...`,
          );
        }
      });
    }
  }
});

afterAll(() => {
  const sceneCount = analyticScenes.length;
  const caseCount = groundTruthCases.length;
  const mustSee = groundTruthCases.reduce((n, c) => n + c.mustBeVisible.length, 0);
  const mustNotSee = groundTruthCases.reduce((n, c) => n + c.mustNotBeVisible.length, 0);
  const disputed = groundTruthCases.reduce((n, c) => n + c.disputed.length, 0);

  process.stdout.write(
    [
      '',
      '──────────────────────────────────────────────────────────────────────',
      ' ACCEPTANCE SUITE — WHAT JUST RAN',
      '──────────────────────────────────────────────────────────────────────',
      ' GENUINELY ASSERTED (no pipeline involved):',
      '   • fixture geometry kit vs exactly-known answers',
      `   • ${sceneCount} analytic scenes vs hand-derived closed forms`,
      '   • two independent Earth models agree to < 0.002 deg on every scene',
      '   • brute-force scans of generated terrain reproduce those closed forms',
      `   • ${caseCount} real ground-truth cases well-formed, cited and internally`,
      `     consistent (${mustSee} must-see, ${mustNotSee} must-not-see, ${disputed} disputed)`,
      '',
      ' ASSERTED THROUGH THE REAL PIPELINE (src/pipeline, offline):',
      `   • ${sceneCount} analytic scenes: horizon angles, skyline attribution,`,
      '     peak verdicts, and interpolation at a non-sampled bearing',
      `   • ${caseCount} real viewpoints against committed SRTM windows in`,
      '     fixtures/tiles/cases/ — no data/tiles/, no network',
      '   • high-confidence claims gate the build; medium claims are reported',
      '     below; disputed peaks are reported and never asserted',
      '',
      ' STILL NOT TESTED:',
      '   • the SVG overlay (P4.1) — src/render is being built in parallel, so',
      '     that hook is still a `todo` rather than a fabricated assertion',
      '',
      ' REPORT-ONLY AND INFORMATIONAL OUTPUT:',
      ...(reportLines.length === 0 ? ['   (none — no report-only hook ran)'] : reportLines),
      '',
      ' A limited terrain window can produce a false VISIBLE, never a false',
      ' hidden. Read each case\'s coverage note before treating a must-see pass',
      ' as proof that a 100 km sightline is clear.',
      '──────────────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
});
