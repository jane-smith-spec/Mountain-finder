/**
 * The real-world ground-truth cases (PLAN.md P6.2).
 *
 * Four viewpoints, chosen so that between them they stress different parts of
 * the pipeline rather than four times the same part:
 *
 *   gornergrat         short range, high angles — geodesy and sign conventions
 *   mount-diablo       very long range, all NEGATIVE angles — curvature and k
 *   kerry-park-seattle near-field occlusion with a 6 deg margin — the easy block
 *   fort-william       near-field occlusion with a 1 deg margin — the hard block
 */

import { fortWilliamCase } from './fort-william';
import { gornergratCase } from './gornergrat';
import { kerryParkSeattleCase } from './kerry-park-seattle';
import { mountDiabloSummitCase } from './mount-diablo-summit';
import type { GroundTruthCase } from './case-types';

export * from './case-types';
export { fortWilliamCase, gornergratCase, kerryParkSeattleCase, mountDiabloSummitCase };

export const groundTruthCases: readonly GroundTruthCase[] = [
  gornergratCase,
  mountDiabloSummitCase,
  kerryParkSeattleCase,
  fortWilliamCase,
];
