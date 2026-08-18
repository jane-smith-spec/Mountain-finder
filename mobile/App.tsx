/**
 * Mountain Finder — the mobile shell (P8.1).
 *
 * Two screens, no navigation library, no state management, no data layer. The
 * shell's entire job is to put a device's sensors in front of the pure modules
 * in `/src/live` and `/src/core`, which it imports **unchanged** across the
 * repository root — that is P8.1's bar, and there is no copy of them here to
 * drift out of sync.
 *
 * Read `mobile/README.md` for what this can and cannot prove.
 */

import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { CalibrateScreen } from './src/CalibrateScreen';
import { HorizonScreen } from './src/HorizonScreen';
import { colors, styles } from './src/theme';
import { useDeviceSensors } from './src/useDeviceSensors';

type Tab = 'calibrate' | 'horizon';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'calibrate', label: 'Calibrate' },
  { id: 'horizon', label: 'Horizon' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('calibrate');
  // Declination is left undefined on purpose. Supplying a guess here would
  // make magnetic headings silently "true", which is the one thing the EXIF
  // path refuses to do; iOS resolves true north itself when it has a fix.
  const sensors = useDeviceSensors(undefined);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={{ flex: 1 }}>
          {tab === 'calibrate' ? (
            <CalibrateScreen sensors={sensors} />
          ) : (
            <HorizonScreen sensors={sensors} />
          )}
        </View>
        <View style={styles.tabBar}>
          {TABS.map((entry) => (
            <Pressable key={entry.id} style={styles.tab} onPress={() => setTab(entry.id)}>
              <Text
                style={[
                  styles.tabLabel,
                  { color: tab === entry.id ? colors.accent : colors.dim },
                ]}
              >
                {entry.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
