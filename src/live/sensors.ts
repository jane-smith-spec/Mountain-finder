/**
 * Camera pose from device sensors — Phase 8's P8.2, the pure half.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * The live view (and any in-app capture) derives `CameraPose` fields from the
 * phone's own sensors instead of from EXIF. This module is that derivation and
 * nothing else: samples in, pose fields with provenance out. It follows
 * `src/core`'s purity rules — no device APIs, no clock, no randomness — so the
 * same code runs under vitest here and inside a React Native shell unchanged,
 * which is the whole Phase 8 premise (P8.1).
 *
 * The EXIF path's disciplines carry over verbatim:
 *
 *   - **Magnetic is never silently true** (the same rule `src/exif/resolve.ts`
 *     enforces): a heading is produced from `trueDeg` samples, or from
 *     magnetic ones plus an EXPLICIT declination, or not at all.
 *   - **Unknown is a state with a reason, never a zero.** A stale trace, a
 *     missing declination, a gravity vector that says the phone is in free
 *     fall — each is a named refusal.
 *
 * ── DEVICE FRAME AND SIGN CONVENTIONS (stated, and tested) ─────────────────
 * CoreMotion's device frame, portrait: +x out of the screen's right edge,
 * +y out of its top edge, +z out of the screen toward the viewer. The BACK
 * camera looks along −z. `GravitySample` is CoreMotion's `gravity` — the
 * direction of DOWN in device coordinates, magnitude 1 in g units (flat on a
 * table face-up: (0, 0, −1); upright portrait: (0, −1, 0)).
 *
 * From that, with ĝ the unit gravity vector:
 *
 *   pitch = asin(ĝ_z)         camera elevation above horizontal
 *     upright portrait  ĝ=(0,−1, 0) → 0°       face-down (camera up) → +90°
 *     face-up (cam down) ĝ=(0, 0,−1) → −90°    30° upward tilt: ĝ_z = sin 30°
 *
 *   roll = atan2(ĝ_x, −ĝ_y)   the camera's rotation about its own axis,
 *     positive when the device's right edge dips below the horizon — i.e. the
 *     camera rolling clockwise as seen from behind it, matching
 *     `CameraPose.rollDeg`'s "+ = clockwise rotation of the frame".
 *
 * ── WHAT STILL NEEDS A PHONE, SAID PLAINLY ─────────────────────────────────
 * Every test here derives its expectations from the geometry above by hand.
 * That proves the MATH; it does not prove the CONVENTIONS against a physical
 * device — a sign error in the frame convention would pass every test and
 * flip on hardware. P8.2's own bar (recorded traces, replayed) therefore
 * stays open until a device records one; this module is its engine, built so
 * that replaying such a trace is a fixture away. The same applies to the
 * compass: CLHeading's tilt compensation is trusted here, not re-derived.
 */

import type { CameraPose } from '../core/types.js';

/** CoreMotion `gravity`: DOWN in device coordinates, ~unit magnitude in g. */
export interface GravitySample {
  readonly timestampMs: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One compass reading. `trueDeg` present when the platform resolved declination. */
export interface HeadingSample {
  readonly timestampMs: number;
  readonly magneticDeg?: number;
  readonly trueDeg?: number;
  /** Platform-reported accuracy, degrees. Negative means invalid (CLHeading). */
  readonly accuracyDeg?: number;
}

/** Why a pose field could not be produced. Each is a distinct, actionable state. */
export type SensorRefusal =
  /** No sample at all in the trace. */
  | 'no-samples'
  /** Newest usable sample is older than `maxAgeMs` at the requested instant. */
  | 'stale'
  /** Only magnetic headings exist and no declination was supplied. */
  | 'needs-declination'
  /** Gravity magnitude far from 1 g — free fall, a shake, or bad data. */
  | 'not-gravity'
  /** Camera within a few degrees of straight up/down: roll is undefined there. */
  | 'gimbal-degenerate';

export interface SensorField {
  readonly valueDeg: number;
  /**
   * Half-width scatter of the samples that produced the value, degrees —
   * measured from the trace, not asserted. Undefined for a single sample:
   * one reading has no scatter to report, and 0 would claim precision.
   */
  readonly spreadDeg?: number;
  readonly sampleCount: number;
}

export type SensorAnswer =
  | { readonly ok: true; readonly field: SensorField }
  | { readonly ok: false; readonly refusal: SensorRefusal };

/** Tunables, all with stated defaults. Times in ms to match sample stamps. */
export interface FuseOptions {
  /** Samples older than this at `atMs` are ignored entirely. Default 1500. */
  readonly maxAgeMs?: number;
  /** Exponential weight time constant for smoothing. Default 400. */
  readonly timeConstantMs?: number;
  /** East-positive declination to convert magnetic headings. */
  readonly declinationDeg?: number;
  /** |pitch| above this refuses roll as gimbal-degenerate. Default 80. */
  readonly gimbalLimitDeg?: number;
}

const DEFAULT_MAX_AGE_MS = 1500;
const DEFAULT_TIME_CONSTANT_MS = 400;
const DEFAULT_GIMBAL_LIMIT_DEG = 80;

/** Gravity magnitude accepted as "the phone is just being held", in g. */
export const GRAVITY_MAGNITUDE_RANGE = { min: 0.5, max: 1.5 } as const;

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

function normaliseDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Pitch and roll from one gravity reading — the closed-form derivation in the
 * module header. Returns a refusal when the magnitude says this is not a
 * quasi-static gravity vector (free fall reads ~0, a hard shake reads > 1.5).
 */
export function orientationFromGravity(
  sample: Pick<GravitySample, 'x' | 'y' | 'z'>,
  gimbalLimitDeg = DEFAULT_GIMBAL_LIMIT_DEG,
):
  | { readonly ok: true; readonly pitchDeg: number; readonly rollDeg: number | undefined }
  | { readonly ok: false; readonly refusal: SensorRefusal } {
  const magnitude = Math.sqrt(sample.x * sample.x + sample.y * sample.y + sample.z * sample.z);
  if (
    !Number.isFinite(magnitude) ||
    magnitude < GRAVITY_MAGNITUDE_RANGE.min ||
    magnitude > GRAVITY_MAGNITUDE_RANGE.max
  ) {
    return { ok: false, refusal: 'not-gravity' };
  }
  const gz = sample.z / magnitude;
  const pitchDeg = toDegrees(Math.asin(Math.max(-1, Math.min(1, gz))));
  // Near straight up/down the horizontal component of gravity vanishes and
  // atan2 answers with noise; undefined is the honest roll there.
  const rollDeg =
    Math.abs(pitchDeg) > gimbalLimitDeg
      ? undefined
      : toDegrees(Math.atan2(sample.x / magnitude, -sample.y / magnitude));
  return { ok: true, pitchDeg, rollDeg };
}

interface Weighted {
  readonly valueDeg: number;
  readonly weight: number;
}

/**
 * Weighted circular mean and spread. The mean is the atan2 of the weighted
 * unit-vector sum — exact across the 359°→0° seam, which is where a plain
 * average of headings shreds itself. The spread is the circular standard
 * deviation √(−2·ln R̄), reported in degrees.
 */
function circularMean(entries: readonly Weighted[]): {
  meanDeg: number;
  spreadDeg: number;
  totalWeight: number;
} {
  let sumSin = 0;
  let sumCos = 0;
  let totalWeight = 0;
  for (const entry of entries) {
    const rad = (entry.valueDeg * Math.PI) / 180;
    sumSin += entry.weight * Math.sin(rad);
    sumCos += entry.weight * Math.cos(rad);
    totalWeight += entry.weight;
  }
  const meanDeg = normaliseDeg(toDegrees(Math.atan2(sumSin, sumCos)));
  const resultant = totalWeight > 0 ? Math.hypot(sumSin, sumCos) / totalWeight : 0;
  const spreadDeg =
    resultant >= 1 ? 0 : toDegrees(Math.sqrt(Math.max(0, -2 * Math.log(Math.max(resultant, 1e-12)))));
  return { meanDeg, spreadDeg, totalWeight };
}

/**
 * The smoothed TRUE heading at `atMs`.
 *
 * Sample selection is by age (`maxAgeMs`), weighting is exponential in age
 * (`timeConstantMs`), and the magnetic→true conversion happens per sample:
 * a sample carrying `trueDeg` uses it; one carrying only `magneticDeg` needs
 * `options.declinationDeg` (east-positive, added) or the whole call refuses —
 * a mixed trace must not silently average two reference frames. Samples whose
 * platform accuracy is negative (CLHeading's "invalid") are dropped.
 */
export function smoothedHeading(
  samples: readonly HeadingSample[],
  atMs: number,
  options: FuseOptions = {},
): SensorAnswer {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const timeConstantMs = options.timeConstantMs ?? DEFAULT_TIME_CONSTANT_MS;

  if (samples.length === 0) return { ok: false, refusal: 'no-samples' };

  const usable = samples.filter(
    (sample) =>
      sample.timestampMs <= atMs &&
      atMs - sample.timestampMs <= maxAgeMs &&
      (sample.accuracyDeg === undefined || sample.accuracyDeg >= 0) &&
      (sample.trueDeg !== undefined || sample.magneticDeg !== undefined),
  );
  if (usable.length === 0) {
    // Distinguish "nothing recent" from "nothing at all": both refuse, but
    // the UI says different things ("point me somewhere" vs "compass off").
    return { ok: false, refusal: 'stale' };
  }

  const entries: Weighted[] = [];
  for (const sample of usable) {
    let trueDeg: number;
    if (sample.trueDeg !== undefined) {
      trueDeg = sample.trueDeg;
    } else if (sample.magneticDeg !== undefined && options.declinationDeg !== undefined) {
      trueDeg = sample.magneticDeg + options.declinationDeg;
    } else {
      return { ok: false, refusal: 'needs-declination' };
    }
    const ageMs = atMs - sample.timestampMs;
    entries.push({ valueDeg: normaliseDeg(trueDeg), weight: Math.exp(-ageMs / timeConstantMs) });
  }

  const { meanDeg, spreadDeg } = circularMean(entries);
  return {
    ok: true,
    field: {
      valueDeg: meanDeg,
      ...(entries.length > 1 ? { spreadDeg } : {}),
      sampleCount: entries.length,
    },
  };
}

/**
 * Smoothed pitch and roll at `atMs` from a gravity trace.
 *
 * Pitch and roll are smoothed as plain (non-circular) means — both live far
 * from any wrap in normal photography, and a trace straddling ±180° of roll
 * is a phone being tumbled, not a pose. Roll refuses independently of pitch
 * when the mean pitch is inside the gimbal zone.
 */
export function smoothedOrientation(
  samples: readonly GravitySample[],
  atMs: number,
  options: FuseOptions = {},
): {
  readonly pitch: SensorAnswer;
  readonly roll: SensorAnswer;
} {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const timeConstantMs = options.timeConstantMs ?? DEFAULT_TIME_CONSTANT_MS;
  const gimbalLimitDeg = options.gimbalLimitDeg ?? DEFAULT_GIMBAL_LIMIT_DEG;

  if (samples.length === 0) {
    return {
      pitch: { ok: false, refusal: 'no-samples' },
      roll: { ok: false, refusal: 'no-samples' },
    };
  }

  const usable = samples.filter(
    (sample) => sample.timestampMs <= atMs && atMs - sample.timestampMs <= maxAgeMs,
  );
  if (usable.length === 0) {
    return { pitch: { ok: false, refusal: 'stale' }, roll: { ok: false, refusal: 'stale' } };
  }

  let pitchSum = 0;
  let pitchSquares = 0;
  const rollEntries: Weighted[] = [];
  let weightSum = 0;
  let count = 0;
  let sawNonGravity = false;
  for (const sample of usable) {
    const orientation = orientationFromGravity(sample, gimbalLimitDeg);
    if (!orientation.ok) {
      sawNonGravity = true;
      continue;
    }
    const weight = Math.exp(-(atMs - sample.timestampMs) / timeConstantMs);
    pitchSum += weight * orientation.pitchDeg;
    pitchSquares += weight * orientation.pitchDeg * orientation.pitchDeg;
    if (orientation.rollDeg !== undefined) {
      rollEntries.push({ valueDeg: orientation.rollDeg, weight });
    }
    weightSum += weight;
    count += 1;
  }

  if (count === 0) {
    const refusal: SensorRefusal = sawNonGravity ? 'not-gravity' : 'stale';
    return { pitch: { ok: false, refusal }, roll: { ok: false, refusal } };
  }

  const pitchMean = pitchSum / weightSum;
  const pitchSpread = Math.sqrt(Math.max(0, pitchSquares / weightSum - pitchMean * pitchMean));
  const pitch: SensorAnswer = {
    ok: true,
    field: {
      valueDeg: pitchMean,
      ...(count > 1 ? { spreadDeg: pitchSpread } : {}),
      sampleCount: count,
    },
  };

  if (Math.abs(pitchMean) > gimbalLimitDeg || rollEntries.length === 0) {
    return { pitch, roll: { ok: false, refusal: 'gimbal-degenerate' } };
  }
  // Roll uses the circular mean: unlike pitch it genuinely wraps (a device in
  // landscape-left vs landscape-right sits at ±90°, and upside-down at ±180°).
  const { meanDeg, spreadDeg } = circularMean(rollEntries);
  const rollDeg = meanDeg > 180 ? meanDeg - 360 : meanDeg;
  return {
    pitch,
    roll: {
      ok: true,
      field: {
        valueDeg: rollDeg,
        ...(rollEntries.length > 1 ? { spreadDeg } : {}),
        sampleCount: rollEntries.length,
      },
    },
  };
}

/** The three orientation angles, each independently answered or refused. */
export interface SensorPose {
  readonly heading: SensorAnswer;
  readonly pitch: SensorAnswer;
  readonly roll: SensorAnswer;
}

/** One call for the live loop: both traces, one instant, one options bag. */
export function fuseSensorPose(
  traces: {
    readonly gravity: readonly GravitySample[];
    readonly heading: readonly HeadingSample[];
  },
  atMs: number,
  options: FuseOptions = {},
): SensorPose {
  const orientation = smoothedOrientation(traces.gravity, atMs, options);
  return {
    heading: smoothedHeading(traces.heading, atMs, options),
    pitch: orientation.pitch,
    roll: orientation.roll,
  };
}

/**
 * Apply a sensor pose onto a camera whose optics are already known.
 *
 * Only the angles the sensors ANSWERED are applied; a refused field keeps the
 * base pose's value, and the list of applied fields is returned so a caller
 * can show which numbers are live and which are assumptions — the same
 * provenance discipline as the EXIF panel.
 */
export function poseWithSensors(
  base: CameraPose,
  sensors: SensorPose,
): { readonly pose: CameraPose; readonly applied: readonly ('heading' | 'pitch' | 'roll')[] } {
  const applied: ('heading' | 'pitch' | 'roll')[] = [];
  let pose = base;
  if (sensors.heading.ok) {
    pose = { ...pose, headingDeg: sensors.heading.field.valueDeg };
    applied.push('heading');
  }
  if (sensors.pitch.ok) {
    pose = { ...pose, pitchDeg: sensors.pitch.field.valueDeg };
    applied.push('pitch');
  }
  if (sensors.roll.ok) {
    pose = { ...pose, rollDeg: sensors.roll.field.valueDeg };
    applied.push('roll');
  }
  return { pose, applied };
}
