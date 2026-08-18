/**
 * Proving the device frame convention against an actual phone — P8.2's open bar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PROBLEM THIS SOLVES
 * ═══════════════════════════════════════════════════════════════════════════
 * `sensors.ts` says it plainly: every expectation in its test suite is derived
 * by hand from the frame convention in its own header, so the suite proves the
 * MATHEMATICS and not the CONVENTION. A sign error — gravity pointing up
 * instead of down, roll measured the other way round, x and y swapped by a
 * landscape rotation — passes all 16 tests and inverts the overlay on
 * hardware. No amount of work in this environment can close that, because the
 * missing evidence is a physical fact about a device.
 *
 * What CAN be built here is the instrument that settles it in thirty seconds:
 * a set of holds whose gravity vector is known a priori from geometry alone,
 * a comparison against what the phone actually reports, and — when they
 * disagree — the specific axis remapping that explains the disagreement.
 *
 * That last part is what makes this worth writing rather than eyeballing three
 * numbers on a screen. "It's wrong" sends someone guessing through 48 possible
 * signed axis permutations. "measured ≈ (−y, x, z) of expected" names the one
 * transform that fits every hold at once, which is a code change of one line.
 *
 * Pure: holds in, verdict out. No device APIs, no clock. The React Native
 * screen supplies measured vectors from `gravitySampleFromDeviceMotion`; this
 * module never learns where they came from, so it is testable here in full
 * against hand-derived inputs — including deliberately corrupted ones, which
 * is the only way to know a diagnostic actually diagnoses.
 */

/** A unit vector in device coordinates. */
export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type CalibrationHold =
  | 'flat-face-up'
  | 'upright-portrait'
  | 'flat-face-down'
  | 'right-edge-down';

export interface HoldSpec {
  readonly hold: CalibrationHold;
  /** Short label for the UI. */
  readonly label: string;
  /** What the person physically does. Written for someone holding a phone. */
  readonly instruction: string;
  /** Gravity (DOWN in device coordinates) this hold must produce, unit length. */
  readonly expected: Vector3;
  /** `asin(ĝ_z)` for `expected` — the pitch `sensors.ts` will derive. */
  readonly expectedPitchDeg: number;
  /** `atan2(ĝ_x, −ĝ_y)`, or undefined where the hold is gimbal-degenerate. */
  readonly expectedRollDeg: number | undefined;
  /** Which convention claim this hold is the evidence for. */
  readonly proves: string;
}

/**
 * The four holds, each derived from `sensors.ts`'s stated frame:
 * +x out of the screen's right edge, +y out of its top edge, +z out of the
 * screen toward the viewer; gravity is the direction of DOWN.
 *
 * Three of them fix one axis each, which is what makes the diagnosis below
 * uniquely determined — a single hold leaves most permutations indistinguishable
 * (every transform that happens to agree on one axis fits it). The fourth,
 * `right-edge-down`, is the only one that exercises ROLL's sign, and roll is
 * the angle with no independent check anywhere else in the pipeline.
 */
export const CALIBRATION_HOLDS: readonly HoldSpec[] = [
  {
    hold: 'upright-portrait',
    label: 'Upright',
    instruction:
      'Hold the phone vertically in portrait, screen facing you, as if photographing the horizon.',
    expected: { x: 0, y: -1, z: 0 },
    expectedPitchDeg: 0,
    expectedRollDeg: 0,
    proves: '+y is the top edge, and level pitch reads 0° rather than ±90°',
  },
  {
    hold: 'flat-face-up',
    label: 'Face up',
    instruction: 'Lay the phone flat on a table, screen upward.',
    expected: { x: 0, y: 0, z: -1 },
    expectedPitchDeg: -90,
    expectedRollDeg: undefined,
    proves: 'gravity points DOWN (−z), not up — the W3C sign trap',
  },
  {
    hold: 'flat-face-down',
    label: 'Face down',
    instruction: 'Turn the phone over, screen down on the table, back camera at the ceiling.',
    expected: { x: 0, y: 0, z: 1 },
    expectedPitchDeg: 90,
    expectedRollDeg: undefined,
    proves: 'pitch is signed, so camera-up and camera-down are not confused',
  },
  {
    hold: 'right-edge-down',
    label: 'Right edge down',
    instruction:
      'From upright, rotate the phone a quarter turn so its RIGHT edge points at the floor.',
    expected: { x: 1, y: 0, z: 0 },
    expectedPitchDeg: 0,
    expectedRollDeg: 90,
    proves: 'roll is positive clockwise seen from behind the camera',
  },
];

export function holdSpec(hold: CalibrationHold): HoldSpec {
  const spec = CALIBRATION_HOLDS.find((candidate) => candidate.hold === hold);
  if (!spec) throw new Error(`unknown calibration hold: ${hold}`);
  return spec;
}

/**
 * Default tolerance, degrees. Generous on purpose: this is a hand holding a
 * phone against a table edge, not a jig. It is far tighter than any of the
 * confusions it must catch — the smallest of which (a single axis swap) is 90°
 * away — so a loose bound costs nothing and spurious failures cost trust.
 */
export const DEFAULT_HOLD_TOLERANCE_DEG = 15;

function magnitude(v: Vector3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/** Angle between two vectors, degrees. Returns NaN if either has no direction. */
export function angleBetweenDeg(a: Vector3, b: Vector3): number {
  const ma = magnitude(a);
  const mb = magnitude(b);
  if (ma === 0 || mb === 0 || !Number.isFinite(ma) || !Number.isFinite(mb)) return NaN;
  const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / (ma * mb);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

export interface HoldResult {
  readonly hold: CalibrationHold;
  readonly expected: Vector3;
  readonly measured: Vector3;
  /** Angle between measured and expected, degrees. */
  readonly errorDeg: number;
  readonly pass: boolean;
}

/** Compare one measured gravity vector against the hold it was taken in. */
export function checkHold(
  hold: CalibrationHold,
  measured: Vector3,
  toleranceDeg: number = DEFAULT_HOLD_TOLERANCE_DEG,
): HoldResult {
  const spec = holdSpec(hold);
  const errorDeg = angleBetweenDeg(spec.expected, measured);
  return {
    hold,
    expected: spec.expected,
    measured,
    errorDeg,
    pass: Number.isFinite(errorDeg) && errorDeg <= toleranceDeg,
  };
}

/**
 * A signed axis permutation: `measured[i] ≈ sign[i] · expected[source[i]]`.
 * There are 48 of these (6 permutations × 8 sign patterns); the identity is
 * the one that means "the convention in sensors.ts is correct as written".
 */
export interface AxisMap {
  readonly source: readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];
  readonly sign: readonly [1 | -1, 1 | -1, 1 | -1];
}

const AXIS_NAMES = ['x', 'y', 'z'] as const;
const PERMUTATIONS: readonly (readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2])[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
const SIGNS: readonly (readonly [1 | -1, 1 | -1, 1 | -1])[] = [
  [1, 1, 1],
  [1, 1, -1],
  [1, -1, 1],
  [1, -1, -1],
  [-1, 1, 1],
  [-1, 1, -1],
  [-1, -1, 1],
  [-1, -1, -1],
];

function componentAt(v: Vector3, index: 0 | 1 | 2): number {
  return index === 0 ? v.x : index === 1 ? v.y : v.z;
}

/** Apply an axis map to a vector. */
export function applyAxisMap(map: AxisMap, v: Vector3): Vector3 {
  return {
    x: map.sign[0] * componentAt(v, map.source[0]),
    y: map.sign[1] * componentAt(v, map.source[1]),
    z: map.sign[2] * componentAt(v, map.source[2]),
  };
}

export function isIdentityAxisMap(map: AxisMap): boolean {
  return (
    map.source[0] === 0 &&
    map.source[1] === 1 &&
    map.source[2] === 2 &&
    map.sign[0] === 1 &&
    map.sign[1] === 1 &&
    map.sign[2] === 1
  );
}

/** Human-readable form, e.g. `x←−y, y←x, z←z`. */
export function describeAxisMap(map: AxisMap): string {
  return ([0, 1, 2] as const)
    .map((i) => `${AXIS_NAMES[i]}←${map.sign[i] === -1 ? '−' : ''}${AXIS_NAMES[map.source[i]]}`)
    .join(', ');
}

export interface Observation {
  readonly hold: CalibrationHold;
  readonly measured: Vector3;
}

export type ConventionVerdict =
  /** Every hold matched what `sensors.ts` predicts. The convention is proven. */
  | 'matches-convention'
  /** Every hold is explained by ONE wrong axis mapping — a one-line fix. */
  | 'systematic-remap'
  /** No single mapping explains the holds: bad data, or holds done wrongly. */
  | 'inconsistent'
  /** Not enough holds to determine anything. */
  | 'insufficient';

export interface ConventionDiagnosis {
  readonly verdict: ConventionVerdict;
  /** The best-fitting map. Identity when the convention is right. */
  readonly bestMap: AxisMap | undefined;
  /** Worst per-hold angle error under `bestMap`, degrees. */
  readonly worstErrorDeg: number;
  readonly results: readonly HoldResult[];
  /**
   * Which device axes the supplied holds actually constrain. Fewer than all
   * three means the diagnosis is silent about the rest — reported rather than
   * glossed, because "matches-convention" from two holds is a weaker claim
   * than the same words from four.
   */
  readonly constrainedAxes: readonly string[];
  /** One sentence stating what was found, for the screen and the commit log. */
  readonly detail: string;
}

/**
 * Which single axis mapping, if any, explains every observation at once.
 *
 * Scored by WORST-case hold error rather than mean: a mapping that nails three
 * holds and inverts the fourth is not a partial success, it is the wrong
 * mapping, and averaging would hide exactly the one hold that disproves it.
 *
 * A minimum of two holds is required, and they must not be the two flat ones —
 * `flat-face-up` and `flat-face-down` are antiparallel, so they constrain only
 * the z axis and 16 mappings fit them equally. The check is therefore on the
 * rank of the measured directions, not on how many were supplied.
 */
export function diagnoseConvention(
  observations: readonly Observation[],
  toleranceDeg: number = DEFAULT_HOLD_TOLERANCE_DEG,
): ConventionDiagnosis {
  const results = observations.map((o) => checkHold(o.hold, o.measured, toleranceDeg));

  const independentAxes = new Set<string>();
  for (const o of observations) {
    const e = holdSpec(o.hold).expected;
    // Each hold's expected vector is a signed unit axis; the AXIS (not its
    // sign) is what a mapping is constrained by.
    independentAxes.add(e.x !== 0 ? 'x' : e.y !== 0 ? 'y' : 'z');
  }
  const constrainedAxes = [...independentAxes].sort();
  if (independentAxes.size < 2) {
    return {
      verdict: 'insufficient',
      bestMap: undefined,
      worstErrorDeg: NaN,
      results,
      constrainedAxes,
      detail:
        `the ${observations.length} hold(s) supplied constrain only ` +
        `${constrainedAxes.join('/')} — at least two different axes are needed ` +
        'before any axis mapping can be ruled out',
    };
  }
  const unconstrained = AXIS_NAMES.filter((axis) => !independentAxes.has(axis));
  const caveat =
    unconstrained.length === 0
      ? ''
      : `; note the ${unconstrained.join('/')} axis is not exercised by these holds, ` +
        'so nothing is claimed about it';

  // Strict `<` means ties are won by whichever map is enumerated first, and
  // the identity is deliberately first in both tables. That matters when the
  // holds leave an axis unconstrained: several maps then fit equally, and
  // reporting the identity ("nothing is wrong that these holds can see") is
  // the honest tie-break, where reporting some arbitrary remap would invent a
  // defect out of missing evidence. The `caveat` above says the axis went
  // untested rather than letting the identity imply it passed.
  let bestMap: AxisMap | undefined;
  let bestWorst = Infinity;
  for (const source of PERMUTATIONS) {
    for (const sign of SIGNS) {
      const map: AxisMap = { source, sign };
      let worst = 0;
      for (const o of observations) {
        const predicted = applyAxisMap(map, holdSpec(o.hold).expected);
        const error = angleBetweenDeg(predicted, o.measured);
        if (!Number.isFinite(error)) {
          worst = Infinity;
          break;
        }
        worst = Math.max(worst, error);
      }
      if (worst < bestWorst) {
        bestWorst = worst;
        bestMap = map;
      }
    }
  }

  if (!bestMap || !Number.isFinite(bestWorst) || bestWorst > toleranceDeg) {
    return {
      verdict: 'inconsistent',
      bestMap,
      worstErrorDeg: bestWorst,
      results,
      constrainedAxes,
      detail:
        'no single axis mapping explains every hold (best fit still leaves ' +
        `${Number.isFinite(bestWorst) ? bestWorst.toFixed(1) : '∞'}° on one hold) — ` +
        'the readings are noisy, the phone moved, or a hold was performed differently ' +
        'than described',
    };
  }

  if (isIdentityAxisMap(bestMap)) {
    return {
      verdict: 'matches-convention',
      bestMap,
      worstErrorDeg: bestWorst,
      results,
      constrainedAxes,
      detail:
        `all ${observations.length} holds agree with the frame convention in ` +
        `src/live/sensors.ts, worst error ${bestWorst.toFixed(1)}° — pitch and roll ` +
        `signs are confirmed against hardware${caveat}`,
    };
  }

  return {
    verdict: 'systematic-remap',
    bestMap,
    worstErrorDeg: bestWorst,
    results,
    constrainedAxes,
    detail:
      `every hold is explained by one wrong axis mapping: measured ≈ ` +
      `(${describeAxisMap(bestMap)}) of expected, worst error ${bestWorst.toFixed(1)}° — ` +
      'correct the convention in src/live/sensors.ts (and this file) by that transform, ' +
      `then re-run the holds${caveat}`,
  };
}
