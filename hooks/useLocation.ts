/**
 * useLocation.ts
 *
 * Subscribes to the device GPS and returns the current position.
 * Requires the expo-location permission prompt to be accepted.
 */

import { useState, useEffect } from 'react';
import * as Location from 'expo-location';

export interface LocationData {
  latitude: number;
  longitude: number;
  /** Metres above sea level (may be inaccurate on some devices) */
  altitude: number;
  /** Horizontal accuracy in metres */
  accuracy: number | null;
}

export function useLocation() {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissionError(
          'Location permission denied. Please enable it in Settings.',
        );
        setLoading(false);
        return;
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 5_000,   // update at most every 5 s
          distanceInterval: 10,  // or every 10 m of movement
        },
        (loc) => {
          setLocation({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            altitude: loc.coords.altitude ?? 0,
            accuracy: loc.coords.accuracy,
          });
          setLoading(false);
        },
      );
    })();

    return () => {
      subscription?.remove();
    };
  }, []);

  return { location, permissionError, loading };
}
