/**
 * Settings screen
 *
 * Controls display preferences that are passed down to the AROverlay.
 * Settings are persisted via AsyncStorage so they survive app restarts.
 *
 * TODO: lift settings state up (e.g. React Context or Zustand) so the AR
 * screen can read the values without prop-drilling through navigation.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Persisted settings keys ──────────────────────────────────────────────────

const STORAGE_KEY = '@mountain_finder_settings';

interface AppSettings {
  showHorizon: boolean;
  showOccluded: boolean;
  showDistance: boolean;
  showElevation: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  showHorizon: true,
  showOccluded: false,
  showDistance: true,
  showElevation: true,
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  // Load from storage on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
      })
      .finally(() => setReady(true));
  }, []);

  // Persist whenever a value changes
  const update = (key: keyof AppSettings, value: boolean) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#00E5FF" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        {/* ── Display section ─────────────────────────────────────── */}
        <Text style={styles.sectionHeader}>Display</Text>

        <SettingRow
          label="Show terrain horizon"
          description="Draw the terrain silhouette on the AR view"
          value={settings.showHorizon}
          onValueChange={(v) => update('showHorizon', v)}
        />
        <SettingRow
          label="Show occluded peaks"
          description="Also label peaks that are hidden behind terrain"
          value={settings.showOccluded}
          onValueChange={(v) => update('showOccluded', v)}
        />
        <SettingRow
          label="Show distance"
          description="Include the distance (km) in peak labels"
          value={settings.showDistance}
          onValueChange={(v) => update('showDistance', v)}
        />
        <SettingRow
          label="Show elevation"
          description="Include the elevation (m) in peak labels"
          value={settings.showElevation}
          onValueChange={(v) => update('showElevation', v)}
        />

        {/* ── About section ────────────────────────────────────────── */}
        <Text style={styles.sectionHeader}>About</Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Mountain Finder</Text>
          <Text style={styles.infoBody}>
            Uses GPS, compass, SRTM 90m elevation data, and OpenStreetMap to
            identify the mountain peaks in your line of sight in real time.
          </Text>
          <View style={styles.divider} />
          <Text style={styles.infoCaption}>
            Elevation data · OpenTopoData (SRTM 90m){'\n'}
            Peak data · OpenStreetMap Overpass API{'\n'}
            Compass · Device magnetometer
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── SettingRow ───────────────────────────────────────────────────────────────

function SettingRow({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#223344', true: '#006070' }}
        thumbColor={value ? '#00E5FF' : '#556677'}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0f1e',
  },
  container: {
    flex: 1,
    backgroundColor: '#0a0f1e',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 24,
  },
  sectionHeader: {
    color: '#00E5FF',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: 24,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  rowText: {
    flex: 1,
    marginRight: 12,
  },
  rowLabel: {
    color: '#eee',
    fontSize: 15,
    fontWeight: '500',
  },
  rowDescription: {
    color: '#667788',
    fontSize: 12,
    marginTop: 3,
    lineHeight: 16,
  },
  infoCard: {
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 16,
  },
  infoTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  infoBody: {
    color: '#aabbcc',
    fontSize: 13,
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: '#1e2d40',
    marginVertical: 12,
  },
  infoCaption: {
    color: '#556677',
    fontSize: 12,
    lineHeight: 20,
  },
});
