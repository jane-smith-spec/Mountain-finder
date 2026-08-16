/**
 * useCompass.ts
 *
 * Reads the device magnetometer at 10 Hz and converts the raw x/y field
 * components into a smoothed compass heading (0 = North, 90 = East, CW).
 *
 * An exponential moving average is applied to reduce jitter without
 * introducing noticeable lag.
 */

import { useState, useEffect, useRef } from 'react';
import { Magnetometer } from 'expo-sensors';

// EMA smoothing factor — higher = more responsive, more jitter
const ALPHA = 0.2;

export function useCompass() {
  const [heading, setHeading] = useState(0);
  const [available, setAvailable] = useState(false);
  const smoothed = useRef(0);

  useEffect(() => {
    let subscription: ReturnType<typeof Magnetometer.addListener> | null = null;

    (async () => {
      const isAvailable = await Magnetometer.isAvailableAsync();
      setAvailable(isAvailable);
      if (!isAvailable) return;

      Magnetometer.setUpdateInterval(100); // 10 Hz

      subscription = Magnetometer.addListener(({ x, y }) => {
        // atan2 gives the angle of the magnetic field vector in the XY plane.
        // Negate and rotate to get a north-referenced clockwise bearing.
        let raw = ((-Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

        // Circular EMA — handle wrap-around at 0°/360°
        let delta = raw - smoothed.current;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        smoothed.current = (smoothed.current + ALPHA * delta + 360) % 360;

        setHeading(Math.round(smoothed.current));
      });
    })();

    return () => {
      subscription?.remove();
    };
  }, []);

  return { heading, available };
}
