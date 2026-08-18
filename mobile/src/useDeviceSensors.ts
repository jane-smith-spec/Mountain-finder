/**
 * The only file in this app that talks to a device.
 *
 * Everything it produces is handed straight to the pure modules in `/src/live`
 * — subscribe, convert, buffer, publish. There is deliberately no geometry
 * here: if a pitch is wrong, the bug is in a module with 46 tests behind it,
 * not in a React component nobody can execute in CI.
 *
 * Two design notes worth keeping.
 *
 * **One clock.** `device-samples.ts` explains why at length: DeviceMotion
 * stamps seconds since boot and the compass carries no timestamp at all, so
 * both adapters take an arrival time from the caller. That caller is here, and
 * it reads `Date.now()` exactly once per sample, which is what makes the two
 * traces comparable at a single instant.
 *
 * **Sensors run faster than the screen needs.** The traces accumulate at the
 * sensor's rate into refs, but a snapshot is published on a timer at 10 Hz.
 * Setting React state per sample would re-render the tree 20–60 times a second
 * to move a number by a hundredth of a degree.
 */

import * as Location from 'expo-location';
import { DeviceMotion } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  gravitySampleFromDeviceMotion,
  headingSampleFromLocation,
  type GravitySampleResult,
} from '../../src/live/device-samples';
import {
  fuseSensorPose,
  type GravitySample,
  type HeadingSample,
  type SensorPose,
} from '../../src/live/sensors';

/** Sensor update period, ms. 20 Hz — well above the 400 ms smoothing constant. */
const MOTION_INTERVAL_MS = 50;
/** How much history to keep. Must exceed `FuseOptions.maxAgeMs` (1500). */
const TRACE_WINDOW_MS = 2500;
/** How often a snapshot reaches React. */
const PUBLISH_INTERVAL_MS = 100;

export type PermissionState = 'pending' | 'granted' | 'denied' | 'unavailable';

export interface SensorSnapshot {
  /** Fused pose at the moment of publication — each angle answered or refused. */
  readonly pose: SensorPose;
  /** The most recent gravity conversion, for the raw readout and calibration. */
  readonly gravity: GravitySampleResult | undefined;
  /** Sample counts, so a stalled sensor is visible rather than merely stale. */
  readonly gravityCount: number;
  readonly headingCount: number;
  /** True when the newest gravity vector had user acceleration mixed in. */
  readonly moving: boolean;
}

export interface DeviceSensors extends SensorSnapshot {
  readonly motionPermission: PermissionState;
  readonly locationPermission: PermissionState;
  readonly error: string | undefined;
  /** Declination applied to magnetic-only headings; undefined means refuse. */
  readonly declinationDeg: number | undefined;
  /** Snapshot of the raw traces, for recording a fixture. */
  readonly captureTraces: () => {
    gravity: readonly GravitySample[];
    heading: readonly HeadingSample[];
  };
}

const EMPTY_POSE: SensorPose = {
  heading: { ok: false, refusal: 'no-samples' },
  pitch: { ok: false, refusal: 'no-samples' },
  roll: { ok: false, refusal: 'no-samples' },
};

function trim<T extends { timestampMs: number }>(samples: T[], nowMs: number): T[] {
  const cutoff = nowMs - TRACE_WINDOW_MS;
  // Samples arrive in order, so the survivors are a suffix; findIndex is fine
  // at these lengths (≈50 entries) and is clearer than a manual splice.
  const firstKept = samples.findIndex((s) => s.timestampMs >= cutoff);
  return firstKept <= 0 ? samples : samples.slice(firstKept);
}

export function useDeviceSensors(declinationDeg?: number): DeviceSensors {
  const gravityTrace = useRef<GravitySample[]>([]);
  const headingTrace = useRef<HeadingSample[]>([]);
  const latestGravity = useRef<GravitySampleResult | undefined>(undefined);

  const [motionPermission, setMotionPermission] = useState<PermissionState>('pending');
  const [locationPermission, setLocationPermission] = useState<PermissionState>('pending');
  const [error, setError] = useState<string | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<SensorSnapshot>({
    pose: EMPTY_POSE,
    gravity: undefined,
    gravityCount: 0,
    headingCount: 0,
    moving: false,
  });

  // ── Device motion ────────────────────────────────────────────────────────
  useEffect(() => {
    let subscription: { remove: () => void } | undefined;
    let cancelled = false;

    void (async () => {
      try {
        if (!(await DeviceMotion.isAvailableAsync())) {
          if (!cancelled) setMotionPermission('unavailable');
          return;
        }
        const permission = await DeviceMotion.requestPermissionsAsync();
        if (cancelled) return;
        if (!permission.granted) {
          setMotionPermission('denied');
          return;
        }
        setMotionPermission('granted');
        DeviceMotion.setUpdateInterval(MOTION_INTERVAL_MS);
        subscription = DeviceMotion.addListener((motion) => {
          const nowMs = Date.now();
          const converted = gravitySampleFromDeviceMotion(motion, nowMs);
          if (!converted.ok) return;
          latestGravity.current = converted.value;
          gravityTrace.current = trim([...gravityTrace.current, converted.value.sample], nowMs);
        });
      } catch (cause) {
        if (!cancelled) setError(`device motion: ${String(cause)}`);
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  // ── Compass ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let subscription: { remove: () => void } | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (!permission.granted) {
          // Not fatal, and worth being precise about: without a location fix
          // Core Location reports `trueHeading` as −1, so the app still gets
          // magnetic north and refuses to call it true.
          setLocationPermission('denied');
        } else {
          setLocationPermission('granted');
        }
        subscription = await Location.watchHeadingAsync((heading) => {
          const nowMs = Date.now();
          const converted = headingSampleFromLocation(heading, nowMs);
          if (!converted.ok) return;
          headingTrace.current = trim([...headingTrace.current, converted.value], nowMs);
        });
      } catch (cause) {
        if (!cancelled) setError(`compass: ${String(cause)}`);
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  // ── Publish ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => {
      const nowMs = Date.now();
      setSnapshot({
        pose: fuseSensorPose(
          { gravity: gravityTrace.current, heading: headingTrace.current },
          nowMs,
          declinationDeg === undefined ? {} : { declinationDeg },
        ),
        gravity: latestGravity.current,
        gravityCount: gravityTrace.current.length,
        headingCount: headingTrace.current.length,
        moving: latestGravity.current?.contaminated ?? false,
      });
    }, PUBLISH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [declinationDeg]);

  const captureTraces = useCallback(
    () => ({ gravity: [...gravityTrace.current], heading: [...headingTrace.current] }),
    [],
  );

  return {
    ...snapshot,
    motionPermission,
    locationPermission,
    error,
    declinationDeg,
    captureTraces,
  };
}
