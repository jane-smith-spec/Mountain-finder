/**
 * AROverlay
 *
 * Transparent full-screen layer that sits above the live camera feed.
 * Renders:
 *   1. The terrain silhouette (HorizonProfile).
 *   2. A floating badge for each visible peak (PeakMarker).
 *   3. The compass heading indicator (CompassIndicator).
 *
 * All positioning is derived from the compass heading so the overlay updates
 * in real-time as the user pans the phone.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { PeakMarker } from './PeakMarker';
import { HorizonProfile } from './HorizonProfile';
import { CompassIndicator } from './CompassIndicator';
import { VisiblePeak } from '../hooks/useTerrainData';
import { HorizonPoint, projectToScreen } from '../utils/terrainProjection';
import { CONFIG } from '../constants/config';

interface Props {
  /** Pre-filtered list from filterVisiblePeaks() — all peaks passed in are rendered. */
  peaks: VisiblePeak[];
  horizonProfile: HorizonPoint[];
  heading: number;
  showHorizon?: boolean;
  showDistance?: boolean;
  showElevation?: boolean;
}

export function AROverlay({
  peaks,
  horizonProfile,
  heading,
  showHorizon = true,
  showDistance = true,
  showElevation = true,
}: Props) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* ── Terrain silhouette ── */}
      {showHorizon && horizonProfile.length > 0 && (
        <HorizonProfile profile={horizonProfile} heading={heading} />
      )}

      {/* ── Peak markers ── */}
      {peaks.map((peak) => {
        const screen = projectToScreen(
          peak.bearingDeg,
          peak.verticalAngleDeg,  // renamed from elevationAngleDeg in new service
          heading,
          CONFIG.CAMERA_HFOV,
          CONFIG.CAMERA_VFOV,
        );
        if (!screen.inView) return null;

        return (
          <PeakMarker
            key={peak.id}
            name={peak.name}
            elevationM={peak.elevationM}
            distanceKm={peak.distanceKm}
            screenX={screen.x}
            screenY={screen.y}
            showDistance={showDistance}
            showElevation={showElevation}
          />
        );
      })}

      {/* ── Compass HUD ── */}
      <View style={styles.compassWrapper}>
        <CompassIndicator heading={heading} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  compassWrapper: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
  },
});
