/**
 * PeakMarker
 *
 * Renders a single peak annotation on the AR overlay:
 *   • A small cyan dot at the peak's projected horizon position.
 *   • A vertical flag pole rising from the dot.
 *   • A name / info badge at the top of the pole.
 *
 * Positioned with absolute coordinates on a full-screen transparent View.
 */

import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';

interface Props {
  name: string;
  elevationM: number;
  distanceKm: number;
  /** Normalised screen X (0 = left, 1 = right) */
  screenX: number;
  /** Normalised screen Y (0 = top, 1 = bottom) */
  screenY: number;
  /** Whether to show the distance label */
  showDistance?: boolean;
  /** Whether to show the elevation label */
  showElevation?: boolean;
}

const POLE_HEIGHT = 48;

export function PeakMarker({
  name,
  elevationM,
  distanceKm,
  screenX,
  screenY,
  showDistance = true,
  showElevation = true,
}: Props) {
  const { width, height } = useWindowDimensions();
  const px = screenX * width;
  const py = screenY * height;

  // Don't render if clearly off-screen (with a generous margin for labels)
  if (px < -60 || px > width + 60 || py < -120 || py > height + 20) return null;

  const infoLine = [
    showElevation && elevationM > 0 && `${elevationM.toLocaleString()}m`,
    showDistance && distanceKm > 0 && `${distanceKm.toFixed(1)}km`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View
      style={[
        styles.container,
        {
          left: px - 2, // centre the 4px pole on the projected x
          top: py - POLE_HEIGHT - 4, // anchor bottom of pole to projected y
        },
      ]}
    >
      {/* Name / info badge */}
      <View style={styles.badge}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {infoLine ? (
          <Text style={styles.info} numberOfLines={1}>
            {infoLine}
          </Text>
        ) : null}
      </View>

      {/* Vertical flag pole */}
      <View style={styles.pole} />

      {/* Dot at the horizon point */}
      <View style={styles.dot} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignItems: 'center',
  },
  badge: {
    backgroundColor: 'rgba(5, 18, 45, 0.85)',
    borderWidth: 1,
    borderColor: '#00E5FF',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 4,
    maxWidth: 160,
    alignItems: 'center',
  },
  name: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 12,
    maxWidth: 144,
  },
  info: {
    color: '#00E5FF',
    fontSize: 10,
    marginTop: 1,
    opacity: 0.85,
  },
  pole: {
    width: 1.5,
    height: POLE_HEIGHT,
    backgroundColor: '#00E5FF',
    opacity: 0.8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00E5FF',
    marginTop: 2,
  },
});
