/**
 * The Expo → `sensors.ts` adapters, tested against payloads reconstructed from
 * the native source.
 *
 * The inputs below are not recorded from a phone and are not invented. They
 * are BUILT with the arithmetic the platform modules perform, quoted in
 * device-samples.ts's header — pick a gravity direction and a user
 * acceleration, push them through Expo's own expression, and assert that the
 * adapter recovers the gravity direction that went in. That is a round trip
 * with an independently known answer, which is what this project means by an
 * expectation derived rather than observed.
 *
 * Both platforms are constructed separately and asserted to agree, because
 * "iOS and Android normalise to the same convention" is a load-bearing claim
 * that would otherwise rest on my reading of two files in different languages.
 */

import { describe, expect, it } from 'vitest';

import {
  STANDARD_GRAVITY_MS2,
  gravitySampleFromDeviceMotion,
  headingAccuracyCeilingDeg,
  headingSampleFromLocation,
  type DeviceMotionLike,
} from './device-samples';
import { orientationFromGravity, smoothedHeading } from './sensors';

/** Build the payload iOS emits: (uA + g)·G and uA·G, both in m/s². */
function iosPayload(
  gravityDown: { x: number; y: number; z: number },
  userAccelG: { x: number; y: number; z: number },
  timestampS = 1000,
): DeviceMotionLike {
  const G = STANDARD_GRAVITY_MS2;
  return {
    acceleration: {
      x: userAccelG.x * G,
      y: userAccelG.y * G,
      z: userAccelG.z * G,
      timestamp: timestampS,
    },
    accelerationIncludingGravity: {
      x: (userAccelG.x + gravityDown.x) * G,
      y: (userAccelG.y + gravityDown.y) * G,
      z: (userAccelG.z + gravityDown.z) * G,
      timestamp: timestampS,
    },
    orientation: 0,
  };
}

/**
 * Build the payload Android emits. Android's TYPE_GRAVITY points UP — the
 * negation of the vector we call gravity — and the module publishes
 * `TYPE_ACCELEROMETER − 2 × TYPE_GRAVITY`, with linear acceleration in m/s².
 */
function androidPayload(
  gravityDown: { x: number; y: number; z: number },
  linearMs2: { x: number; y: number; z: number },
  timestampS = 1000,
): DeviceMotionLike {
  const G = STANDARD_GRAVITY_MS2;
  const up = { x: -gravityDown.x * G, y: -gravityDown.y * G, z: -gravityDown.z * G };
  const accelerometer = { x: linearMs2.x + up.x, y: linearMs2.y + up.y, z: linearMs2.z + up.z };
  return {
    acceleration: { ...linearMs2, timestamp: timestampS },
    accelerationIncludingGravity: {
      x: accelerometer.x - 2 * up.x,
      y: accelerometer.y - 2 * up.y,
      z: accelerometer.z - 2 * up.z,
      timestamp: timestampS,
    },
    orientation: 0,
  };
}

const FACE_UP = { x: 0, y: 0, z: -1 };
const UPRIGHT = { x: 0, y: -1, z: 0 };

describe('gravitySampleFromDeviceMotion', () => {
  it('recovers the exact gravity direction from an iOS payload, user motion removed', () => {
    // A hand shaking hard enough to matter: 0.1–0.2 g of user acceleration.
    const motion = iosPayload(FACE_UP, { x: 0.1, y: -0.2, z: 0.05 });
    const result = gravitySampleFromDeviceMotion(motion, 5_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Subtraction is exact in the algebra; floating point costs a few ulps.
    expect(result.value.sample.x).toBeCloseTo(0, 12);
    expect(result.value.sample.y).toBeCloseTo(0, 12);
    expect(result.value.sample.z).toBeCloseTo(-1, 12);
    expect(result.value.contaminated).toBe(false);
  });

  it('recovers the same direction from the Android payload — the conventions agree', () => {
    const ios = gravitySampleFromDeviceMotion(iosPayload(UPRIGHT, { x: 0.03, y: 0.04, z: -0.02 }), 1);
    const android = gravitySampleFromDeviceMotion(
      androidPayload(UPRIGHT, { x: 0.3, y: 0.4, z: -0.2 }),
      1,
    );
    expect(ios.ok && android.ok).toBe(true);
    if (!ios.ok || !android.ok) return;
    expect(android.value.sample.x).toBeCloseTo(ios.value.sample.x, 12);
    expect(android.value.sample.y).toBeCloseTo(ios.value.sample.y, 12);
    expect(android.value.sample.z).toBeCloseTo(ios.value.sample.z, 12);
    expect(android.value.sample.y).toBeCloseTo(-1, 12);
  });

  it('produces a UNIT vector, not m/s² — the magnitude gate depends on it', () => {
    const result = gravitySampleFromDeviceMotion(iosPayload(FACE_UP, { x: 0, y: 0, z: 0 }), 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { x, y, z } = result.value.sample;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    // Left in m/s² this would read 9.80665 and `orientationFromGravity` would
    // reject a perfectly good sample as `not-gravity`.
    expect(orientationFromGravity(result.value.sample)).toEqual({
      ok: true,
      pitchDeg: -90,
      rollDeg: undefined,
    });
  });

  it('flags contamination when the payload carries no separate acceleration channel', () => {
    const base = iosPayload(UPRIGHT, { x: 0.5, y: 0, z: 0 });
    const result = gravitySampleFromDeviceMotion(
      { accelerationIncludingGravity: base.accelerationIncludingGravity },
      1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contaminated).toBe(true);
    // What survives is gravity PLUS 0.5 g sideways, so the magnitude is
    // √(0.5² + 1²) — visibly not 1, which is the whole point of reporting it.
    const { x, y, z } = result.value.sample;
    expect(Math.hypot(x, y, z)).toBeCloseTo(Math.sqrt(1.25), 12);
  });

  it('refuses a payload with no gravity channel, and one with a non-finite component', () => {
    expect(gravitySampleFromDeviceMotion({ acceleration: null }, 1)).toEqual({
      ok: false,
      refusal: 'no-gravity-channel',
    });
    expect(
      gravitySampleFromDeviceMotion(
        { accelerationIncludingGravity: { x: 0, y: Number.NaN, z: -9.8 } },
        1,
      ),
    ).toEqual({ ok: false, refusal: 'not-finite' });
  });

  it('converts the device timestamp from seconds to milliseconds, keeping it separate', () => {
    const result = gravitySampleFromDeviceMotion(iosPayload(FACE_UP, { x: 0, y: 0, z: 0 }, 12.5), 900);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 12.5 s since boot → 12 500 ms, and the SAMPLE is stamped with the
    // caller's clock so both traces share one origin (header: "the two clocks").
    expect(result.value.deviceTimestampMs).toBe(12_500);
    expect(result.value.sample.timestampMs).toBe(900);
  });
});

describe('headingAccuracyCeilingDeg', () => {
  it('maps the platform buckets to their documented ceilings, and nothing else', () => {
    // Quoted from LocationHeadingObject: 3 → <20°, 2 → <35°, 1 → <50°, 0 → >50°.
    expect(headingAccuracyCeilingDeg(3)).toBe(20);
    expect(headingAccuracyCeilingDeg(2)).toBe(35);
    expect(headingAccuracyCeilingDeg(1)).toBe(50);
    // Bucket 0 has no ceiling, so it is marked invalid rather than given one.
    expect(headingAccuracyCeilingDeg(0)).toBe(-1);
    for (const rubbish of [-1, 4, 99, 1.5, Number.NaN]) {
      expect(headingAccuracyCeilingDeg(rubbish)).toBe(-1);
    }
  });

  it('never lets the raw bucket be mistaken for a degree figure', () => {
    // The bug this guards: passing `accuracy` through unchanged would claim
    // 3° of precision from the bucket that means "worse than 20°".
    expect(headingAccuracyCeilingDeg(3)).not.toBe(3);
  });
});

describe('headingSampleFromLocation', () => {
  it('keeps a real true heading', () => {
    const result = headingSampleFromLocation(
      { trueHeading: 123.4, magHeading: 110.2, accuracy: 3 },
      7_000,
    );
    expect(result).toEqual({
      ok: true,
      value: { timestampMs: 7_000, trueDeg: 123.4, magneticDeg: 110.2, accuracyDeg: 20 },
    });
  });

  it('drops trueHeading when it is the −1 sentinel, leaving an honest refusal downstream', () => {
    const result = headingSampleFromLocation(
      { trueHeading: -1, magHeading: 110.2, accuracy: 2 },
      7_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trueDeg).toBeUndefined();
    expect(result.value.magneticDeg).toBe(110.2);

    // The point of the sentinel check: −1 averaged in as a bearing would put
    // the heading near 0° and look entirely plausible. Instead the pipeline
    // says what is actually wrong.
    expect(smoothedHeading([result.value], 7_000)).toEqual({
      ok: false,
      refusal: 'needs-declination',
    });
    // …and with the declination supplied it answers, in true degrees.
    const withDeclination = smoothedHeading([result.value], 7_000, { declinationDeg: 13.5 });
    expect(withDeclination.ok).toBe(true);
    if (!withDeclination.ok) return;
    expect(withDeclination.field.valueDeg).toBeCloseTo(123.7, 10);
  });

  it('passes bucket 0 through as invalid so the smoother discards the reading', () => {
    const result = headingSampleFromLocation(
      { trueHeading: 200, magHeading: 190, accuracy: 0 },
      7_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.accuracyDeg).toBe(-1);
    // `smoothedHeading` drops negative-accuracy samples; with nothing else in
    // the trace that is `stale`, not a fabricated bearing.
    expect(smoothedHeading([result.value], 7_000)).toEqual({ ok: false, refusal: 'stale' });
  });

  it('refuses when neither heading is usable', () => {
    expect(headingSampleFromLocation({ trueHeading: -1, magHeading: -1, accuracy: 0 }, 1)).toEqual({
      ok: false,
      refusal: 'no-heading',
    });
    expect(
      headingSampleFromLocation({ trueHeading: Number.NaN, magHeading: Number.NaN, accuracy: 3 }, 1),
    ).toEqual({ ok: false, refusal: 'no-heading' });
  });
});
