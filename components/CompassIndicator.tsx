/**
 * CompassIndicator
 *
 * Small HUD badge that shows the current compass heading as both a cardinal
 * direction (N / NE / E …) and a numeric degree value.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

function toCardinal(heading: number): string {
  const index = Math.round(heading / 45) % 8;
  return CARDINALS[index];
}

interface Props {
  heading: number;
}

export function CompassIndicator({ heading }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.cardinal}>{toCardinal(heading)}</Text>
      <Text style={styles.separator}>·</Text>
      <Text style={styles.degrees}>{heading}°</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0, 229, 255, 0.3)',
    gap: 6,
  },
  cardinal: {
    color: '#00E5FF',
    fontWeight: 'bold',
    fontSize: 16,
    minWidth: 24,
    textAlign: 'center',
  },
  separator: {
    color: 'rgba(0,229,255,0.4)',
    fontSize: 14,
  },
  degrees: {
    color: '#FFFFFF',
    fontSize: 14,
    minWidth: 36,
  },
});
