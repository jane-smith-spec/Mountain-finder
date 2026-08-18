/**
 * The calibration instrument, tested by feeding it deliberately broken phones.
 *
 * A diagnostic that has only ever seen correct data is not known to diagnose
 * anything. So most of what follows constructs a SPECIFIC defect — the W3C
 * sign flip, a landscape axis swap, incoherent noise — applies it to the
 * hand-derived hold vectors, and asserts that the module names that defect
 * rather than merely failing.
 *
 * The hold vectors themselves are derived from the frame convention in
 * sensors.ts's header, and the first test closes the loop by checking they
 * produce the pitch and roll that header predicts. If someone changes the
 * convention in one file and not the other, that test fails — which is the
 * only reason the two modules can be trusted to agree.
 */

import { describe, expect, it } from 'vitest';

import {
  CALIBRATION_HOLDS,
  DEFAULT_HOLD_TOLERANCE_DEG,
  angleBetweenDeg,
  applyAxisMap,
  checkHold,
  describeAxisMap,
  diagnoseConvention,
  holdSpec,
  isIdentityAxisMap,
  type AxisMap,
  type Observation,
  type Vector3,
} from './calibration';
import { orientationFromGravity } from './sensors';

const ALL_HOLDS: readonly Observation[] = CALIBRATION_HOLDS.map((spec) => ({
  hold: spec.hold,
  measured: spec.expected,
}));

function mapAll(map: AxisMap): Observation[] {
  return CALIBRATION_HOLDS.map((spec) => ({
    hold: spec.hold,
    measured: applyAxisMap(map, spec.expected),
  }));
}

describe('the holds themselves', () => {
  it('produce exactly the pitch and roll sensors.ts derives — the two files agree', () => {
    for (const spec of CALIBRATION_HOLDS) {
      const orientation = orientationFromGravity(spec.expected);
      expect(orientation.ok, spec.hold).toBe(true);
      if (!orientation.ok) continue;
      expect(orientation.pitchDeg, `${spec.hold} pitch`).toBeCloseTo(spec.expectedPitchDeg, 10);
      if (spec.expectedRollDeg === undefined) {
        // The two flat holds are gimbal-degenerate; roll must be refused there.
        expect(orientation.rollDeg, `${spec.hold} roll`).toBeUndefined();
      } else {
        expect(orientation.rollDeg, `${spec.hold} roll`).toBeCloseTo(spec.expectedRollDeg, 10);
      }
    }
  });

  it('are unit vectors along distinct signed axes', () => {
    const seen = new Set<string>();
    for (const spec of CALIBRATION_HOLDS) {
      const { x, y, z } = spec.expected;
      expect(Math.hypot(x, y, z), spec.hold).toBeCloseTo(1, 12);
      seen.add(`${x},${y},${z}`);
    }
    expect(seen.size).toBe(CALIBRATION_HOLDS.length);
  });

  it('between them exercise all three axes and both signs of roll', () => {
    const axes = new Set(
      CALIBRATION_HOLDS.map((s) => (s.expected.x !== 0 ? 'x' : s.expected.y !== 0 ? 'y' : 'z')),
    );
    expect([...axes].sort()).toEqual(['x', 'y', 'z']);
    // Roll is the angle with no independent check elsewhere in the pipeline,
    // so at least one hold must pin it away from zero.
    expect(CALIBRATION_HOLDS.some((s) => (s.expectedRollDeg ?? 0) !== 0)).toBe(true);
  });
});

describe('angleBetweenDeg', () => {
  it('measures known angles', () => {
    expect(angleBetweenDeg({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(0, 10);
    expect(angleBetweenDeg({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(90, 10);
    expect(angleBetweenDeg({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 })).toBeCloseTo(180, 10);
    // 45° in the xy-plane, and magnitude must not matter.
    expect(angleBetweenDeg({ x: 3, y: 3, z: 0 }, { x: 7, y: 0, z: 0 })).toBeCloseTo(45, 10);
  });

  it('is NaN for a zero vector rather than silently 0°', () => {
    expect(angleBetweenDeg({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNaN();
  });
});

describe('checkHold', () => {
  it('passes a perfect hold and one within tolerance', () => {
    expect(checkHold('upright-portrait', { x: 0, y: -1, z: 0 }).pass).toBe(true);
    // A phone held 10° off vertical — a person, not a jig.
    const tilted = { x: 0, y: -Math.cos((10 * Math.PI) / 180), z: Math.sin((10 * Math.PI) / 180) };
    const result = checkHold('upright-portrait', tilted);
    expect(result.errorDeg).toBeCloseTo(10, 8);
    expect(result.pass).toBe(true);
  });

  it('fails a hold that is off by more than the tolerance', () => {
    const result = checkHold('upright-portrait', { x: 0, y: 1, z: 0 });
    expect(result.errorDeg).toBeCloseTo(180, 10);
    expect(result.pass).toBe(false);
    expect(result.errorDeg).toBeGreaterThan(DEFAULT_HOLD_TOLERANCE_DEG);
  });
});

describe('diagnoseConvention', () => {
  it('confirms the convention when every hold is exact', () => {
    const diagnosis = diagnoseConvention(ALL_HOLDS);
    expect(diagnosis.verdict).toBe('matches-convention');
    expect(diagnosis.bestMap && isIdentityAxisMap(diagnosis.bestMap)).toBe(true);
    expect(diagnosis.worstErrorDeg).toBeCloseTo(0, 10);
    expect(diagnosis.constrainedAxes).toEqual(['x', 'y', 'z']);
    expect(diagnosis.results.every((r) => r.pass)).toBe(true);
  });

  it('still confirms it through realistic hand noise', () => {
    // ~6° of wobble applied in a different direction per hold.
    const wobble = (v: Vector3, i: number): Vector3 => {
      const a = ((6 + i) * Math.PI) / 180;
      return { x: v.x + Math.sin(a) * 0.1, y: v.y + Math.cos(a) * 0.08, z: v.z - Math.sin(a) * 0.05 };
    };
    const diagnosis = diagnoseConvention(
      CALIBRATION_HOLDS.map((spec, i) => ({ hold: spec.hold, measured: wobble(spec.expected, i) })),
    );
    expect(diagnosis.verdict).toBe('matches-convention');
    expect(diagnosis.worstErrorDeg).toBeLessThan(DEFAULT_HOLD_TOLERANCE_DEG);
  });

  it('names the W3C sign flip — the single most likely real failure', () => {
    // If Expo had followed the W3C spec, every reading would be negated.
    const negated: AxisMap = { source: [0, 1, 2], sign: [-1, -1, -1] };
    const diagnosis = diagnoseConvention(mapAll(negated));
    expect(diagnosis.verdict).toBe('systematic-remap');
    expect(diagnosis.worstErrorDeg).toBeCloseTo(0, 10);
    expect(diagnosis.bestMap).toEqual(negated);
    expect(describeAxisMap(negated)).toBe('x←−x, y←−y, z←−z');
    expect(diagnosis.detail).toContain('x←−x, y←−y, z←−z');
    // Every individual hold fails; the value added is saying they fail
    // together, in one nameable way.
    expect(diagnosis.results.every((r) => !r.pass)).toBe(true);
  });

  it('names a landscape-style x/y swap', () => {
    const swapped: AxisMap = { source: [1, 0, 2], sign: [1, -1, 1] };
    const diagnosis = diagnoseConvention(mapAll(swapped));
    expect(diagnosis.verdict).toBe('systematic-remap');
    expect(diagnosis.bestMap).toEqual(swapped);
    expect(diagnosis.worstErrorDeg).toBeCloseTo(0, 10);
  });

  it('recovers every one of the 48 signed axis maps from the four holds', () => {
    // The four holds span all three axes, so the map is uniquely determined —
    // asserted exhaustively rather than on the two cases above.
    const permutations = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ] as const;
    let checked = 0;
    for (const source of permutations) {
      for (const sx of [1, -1] as const) {
        for (const sy of [1, -1] as const) {
          for (const sz of [1, -1] as const) {
            const map: AxisMap = { source, sign: [sx, sy, sz] };
            const diagnosis = diagnoseConvention(mapAll(map));
            expect(diagnosis.bestMap, describeAxisMap(map)).toEqual(map);
            expect(diagnosis.worstErrorDeg).toBeCloseTo(0, 10);
            expect(diagnosis.verdict).toBe(
              isIdentityAxisMap(map) ? 'matches-convention' : 'systematic-remap',
            );
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(48);
  });

  it('refuses to explain readings that no single mapping fits', () => {
    // Three holds correct, one rotated 60° off any axis: not a convention
    // problem, so claiming a remap would send someone editing correct code.
    const broken = CALIBRATION_HOLDS.map((spec, i) =>
      i === 2
        ? { hold: spec.hold, measured: { x: 0.5, y: 0.5, z: Math.SQRT1_2 } }
        : { hold: spec.hold, measured: spec.expected },
    );
    const diagnosis = diagnoseConvention(broken);
    expect(diagnosis.verdict).toBe('inconsistent');
    expect(diagnosis.worstErrorDeg).toBeGreaterThan(DEFAULT_HOLD_TOLERANCE_DEG);
    expect(diagnosis.detail).toContain('no single axis mapping');
  });

  it('says "insufficient" for the two flat holds, which constrain only z', () => {
    const diagnosis = diagnoseConvention([
      { hold: 'flat-face-up', measured: holdSpec('flat-face-up').expected },
      { hold: 'flat-face-down', measured: holdSpec('flat-face-down').expected },
    ]);
    expect(diagnosis.verdict).toBe('insufficient');
    expect(diagnosis.bestMap).toBeUndefined();
    expect(diagnosis.constrainedAxes).toEqual(['z']);
  });

  it('breaks ties toward the identity, and says which axis went untested', () => {
    // Holds on x and y only: nothing here can see the z axis, and 16 maps fit
    // equally well. Reporting a remap would be inventing a defect.
    const diagnosis = diagnoseConvention([
      { hold: 'upright-portrait', measured: holdSpec('upright-portrait').expected },
      { hold: 'right-edge-down', measured: holdSpec('right-edge-down').expected },
    ]);
    expect(diagnosis.verdict).toBe('matches-convention');
    expect(diagnosis.bestMap && isIdentityAxisMap(diagnosis.bestMap)).toBe(true);
    expect(diagnosis.constrainedAxes).toEqual(['x', 'y']);
    expect(diagnosis.detail).toContain('z axis is not exercised');
  });
});
