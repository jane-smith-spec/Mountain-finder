/**
 * AR View screen (main screen)
 *
 * Layers:
 *   1. Full-screen live camera feed (CameraView)
 *   2. Transparent AROverlay (terrain silhouette + peak markers + compass)
 *   3. Status badges for loading, errors, and missing permissions
 */

import React, { useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AROverlay } from '../../components/AROverlay';
import { useLocation } from '../../hooks/useLocation';
import { useCompass } from '../../hooks/useCompass';
import { useTerrainData } from '../../hooks/useTerrainData';

export default function ARScreen() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const { location, permissionError: locationError, loading: locationLoading } =
    useLocation();

  const { heading, available: compassAvailable } = useCompass();

  const { peaks, horizonProfile, status: terrainStatus } = useTerrainData(
    location?.latitude ?? null,
    location?.longitude ?? null,
    location?.altitude ?? null,
    location?.accuracy ?? null,
  );

  // Request camera permission on mount
  useEffect(() => {
    if (!cameraPermission?.granted) {
      requestCameraPermission();
    }
  }, [cameraPermission, requestCameraPermission]);

  // ── Permission gate ────────────────────────────────────────────────────────
  if (!cameraPermission?.granted) {
    return (
      <View style={styles.gated}>
        <Text style={styles.gatedText}>
          Camera access is required to display the AR overlay.
        </Text>
      </View>
    );
  }

  if (locationError) {
    return (
      <View style={styles.gated}>
        <Text style={styles.gatedText}>{locationError}</Text>
      </View>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────────────
  const visibleCount = peaks.filter((p) => p.isVisible).length;

  return (
    <View style={styles.container}>
      {/* Layer 1 — Camera */}
      <CameraView style={StyleSheet.absoluteFill} facing="back" />

      {/* Layer 2 — AR overlay (peaks, horizon, compass) */}
      {location && (
        <AROverlay
          peaks={peaks}
          horizonProfile={horizonProfile}
          heading={heading}
        />
      )}

      {/* Layer 3 — Status badges */}
      <SafeAreaView style={StyleSheet.absoluteFill} pointerEvents="none">

        {/* Loading indicator with progress */}
        {(locationLoading || terrainStatus.loading) && (
          <View style={styles.loadingBadge}>
            <ActivityIndicator size="small" color="#00E5FF" />
            <Text style={styles.loadingText}>
              {locationLoading
                ? 'Acquiring GPS…'
                : `Loading terrain… ${terrainStatus.progress}%`}
            </Text>
          </View>
        )}

        {/* Terrain fetch error */}
        {terrainStatus.error ? (
          <View style={[styles.badge, styles.errorBadge]}>
            <Text style={styles.badgeText}>⚠ {terrainStatus.error}</Text>
          </View>
        ) : null}

        {/* Non-fatal warnings (poor GPS, partial data, etc.) */}
        {!terrainStatus.loading && terrainStatus.warnings.map((w, i) => (
          <View key={i} style={[styles.badge, styles.warningBadge]}>
            <Text style={styles.badgeText}>{w}</Text>
          </View>
        ))}

        {/* No compass warning */}
        {!compassAvailable ? (
          <View style={[styles.badge, styles.warningBadge]}>
            <Text style={styles.badgeText}>Compass unavailable — heading fixed at 0°</Text>
          </View>
        ) : null}

        {/* Debug info — bottom right */}
        {location ? (
          <View style={styles.debugPanel}>
            <Text style={styles.debugText}>
              {location.latitude.toFixed(4)}°,{' '}
              {location.longitude.toFixed(4)}°
              {location.altitude ? `  ${Math.round(location.altitude)} m` : ''}
            </Text>
            <Text style={styles.debugText}>
              {visibleCount} peak{visibleCount !== 1 ? 's' : ''} visible
            </Text>
          </View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  gated: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0f1e',
    padding: 32,
  },
  gatedText: {
    color: '#ccc',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },

  // Loading
  loadingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 60,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  loadingText: {
    color: '#00E5FF',
    fontSize: 13,
  },

  // Generic badge
  badge: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
  },
  errorBadge: {
    backgroundColor: 'rgba(180, 30, 30, 0.85)',
  },
  warningBadge: {
    backgroundColor: 'rgba(160, 100, 0, 0.85)',
  },

  // Debug panel
  debugPanel: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 8,
    borderRadius: 6,
    gap: 2,
  },
  debugText: {
    color: '#88aacc',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});
