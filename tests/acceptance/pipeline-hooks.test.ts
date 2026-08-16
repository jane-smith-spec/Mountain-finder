/**
 * ACCEPTANCE — PIPELINE HOOKS (PLAN.md P6.3)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ THIS BEFORE TRUSTING A GREEN ACCEPTANCE RUN
 * ═══════════════════════════════════════════════════════════════════════════
 * As of Wave 1, src/core is being written by another group and does not exist
 * yet. Nothing in this file exercises the pipeline. Every entry below is a
 * `todo` — vitest prints it, counts it separately from passes, and never lets
 * it masquerade as a passing assertion.
 *
 * This is deliberate. The alternative — writing assertions against a pipeline
 * that is not there and skipping them with `it.skip` — is exactly the failure
 * MISSION.md describes: code nobody executed, quietly accumulating.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * HOW TO TURN A HOOK ON
 * ───────────────────────────────────────────────────────────────────────────
 * 1. Change `it.todo('…')` to `it('…', () => { … })`.
 * 2. Import from src/core. The fixtures deliberately never do — they are the
 *    independent yardstick — but THIS file is where the two meet, so importing
 *    the pipeline here is correct.
 * 3. Feed the pipeline `scene.generateSamples()` and compare against
 *    `scene.expectedSkyline`, honouring `scene.toleranceDeg` and
 *    `scene.distanceToleranceM`. Never adjust an expectation to match output.
 * 4. For real cases, honour `confidence`: a 'high' expectation is a hard
 *    failure; a 'medium' one should be reported loudly but not gate the build,
 *    because the uncertainty is in the ground truth, not necessarily the code.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY REAL CASES NEED MORE THAN CODE
 * ───────────────────────────────────────────────────────────────────────────
 * The four real viewpoints need actual elevation data around each observer.
 * Live APIs are blocked in this environment, so those hooks additionally wait
 * on group B's `record:fixtures` script having captured each site into
 * fixtures/api/. Until then they cannot run even with a finished pipeline.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { analyticScenes } from '../../fixtures/scenes';
import { groundTruthCases } from './cases';

describe('P6.3 hooks — synthetic scenes through the real pipeline (Wave 2+)', () => {
  it('has scenes ready and waiting for the pipeline', () => {
    // A genuine assertion: the hooks below have something to be wired to.
    expect(analyticScenes.length).toBeGreaterThan(0);
    for (const scene of analyticScenes) {
      expect(scene.generateSamples().length).toBeGreaterThan(0);
    }
  });

  for (const scene of analyticScenes) {
    // TODO(wave-2, P1.3): buildHorizonProfile(scene.generateSamples(), scene.observer)
    // then interpolate at each expectedSkyline[i].bearingDeg and assert
    // |altitudeDeg - expected| < scene.toleranceDeg.
    it.todo(`${scene.id}: computed horizon matches the closed form within ${scene.toleranceDeg} deg`);

    // TODO(wave-2, P1.2): assert the horizon point's distanceKm and elevationM
    // name the right piece of terrain, within scene.distanceToleranceM.
    it.todo(`${scene.id}: horizon attributes the skyline to the correct terrain`);

    if (scene.expectedPeakVerdicts.length > 0) {
      // TODO(wave-2, P1.5): filterVisiblePeaks(scene.peaks, profile, observer)
      // must return exactly the peaks whose verdict says visible:true.
      it.todo(`${scene.id}: visibility filter reproduces all ${scene.expectedPeakVerdicts.length} peak verdict(s)`);
    }
  }

  // TODO(wave-2, P1.3): the flat-plane scene's expectations include a bearing
  // that is NOT a sampled ray (187.5 deg), so wiring it up also proves the
  // profile interpolation and its 0/360 wrap.
  it.todo('flat-plane: interpolation at a non-sampled bearing is exact on a constant profile');

  // TODO(wave-3, P4.1): render each scene and assert flag pixel positions
  // against hand-computed image coordinates, per PLAN.md P4.1.
  it.todo('every scene renders to an SVG overlay with flags at the computed positions');
});

describe('P6.3 hooks — real viewpoints end to end (Wave 2+, needs recorded fixtures)', () => {
  it('has cases ready and waiting for elevation fixtures', () => {
    expect(groundTruthCases.length).toBeGreaterThan(0);
  });

  for (const testCase of groundTruthCases) {
    const highMustSee = testCase.mustBeVisible.filter((p) => p.confidence === 'high');
    const mediumMustSee = testCase.mustBeVisible.filter((p) => p.confidence === 'medium');
    const highMustNotSee = testCase.mustNotBeVisible.filter((p) => p.confidence === 'high');
    const mediumMustNotSee = testCase.mustNotBeVisible.filter((p) => p.confidence === 'medium');

    // TODO(wave-2, P2.2+P2.4): needs fixtures/api/<site> recorded by group B's
    // recorder, because live elevation APIs are blocked in this environment.
    it.todo(`${testCase.id}: elevation fixtures recorded for this viewpoint`);

    if (highMustSee.length > 0) {
      // TODO(wave-2): HARD GATE.
      it.todo(
        `${testCase.id}: labels all high-confidence must-see peaks (${highMustSee
          .map((p) => p.name)
          .join(', ')})`,
      );
    }
    if (mediumMustSee.length > 0) {
      // TODO(wave-2): REPORT ONLY — failure means investigate the ground truth.
      it.todo(
        `${testCase.id}: [report-only] medium-confidence must-see peaks (${mediumMustSee
          .map((p) => p.name)
          .join(', ')})`,
      );
    }
    if (highMustNotSee.length > 0) {
      // TODO(wave-2): HARD GATE — the occlusion test that matters most.
      it.todo(
        `${testCase.id}: labels NONE of the high-confidence occluded peaks (${highMustNotSee
          .map((p) => p.name)
          .join(', ')})`,
      );
    }
    if (mediumMustNotSee.length > 0) {
      // TODO(wave-2): REPORT ONLY.
      it.todo(
        `${testCase.id}: [report-only] medium-confidence occluded peaks (${mediumMustNotSee
          .map((p) => p.name)
          .join(', ')})`,
      );
    }
    if (testCase.disputed.length > 0) {
      // Never a gate. Print the pipeline's verdict so a human can weigh in on
      // a question the literature itself does not agree about.
      it.todo(
        `${testCase.id}: [informational] report the verdict for disputed peaks (${testCase.disputed
          .map((p) => p.name)
          .join(', ')})`,
      );
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
      `   • fixture geometry kit vs exactly-known answers`,
      `   • ${sceneCount} analytic scenes vs hand-derived closed forms`,
      `   • two independent Earth models agree to < 0.002 deg on every scene`,
      `   • brute-force scans of generated terrain reproduce those closed forms`,
      `   • ${caseCount} real ground-truth cases well-formed, cited and internally`,
      `     consistent (${mustSee} must-see, ${mustNotSee} must-not-see, ${disputed} disputed)`,
      '',
      ' NOT YET TESTED — reported above as `todo`, awaiting Waves 2-3:',
      '   • the horizon builder, visibility filter and renderer (src/core does',
      '     not exist yet)',
      '   • real viewpoints end to end (also needs fixtures/api recorded by',
      '     group B; live APIs are blocked in this environment)',
      '',
      ' A green run here does NOT mean the pipeline is correct. It means the',
      ' yardstick is sound and ready to measure against.',
      '──────────────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
});
