/**
 * The screen that closes P8.2's open bar.
 *
 * `src/live/sensors.ts` states the problem in its own header: every one of its
 * expectations is hand-derived from the frame convention written just above
 * them, so the suite proves the mathematics and cannot prove the convention. A
 * sign error passes all 16 tests and inverts the overlay on hardware.
 *
 * This screen is the missing evidence. Four holds have gravity vectors known a
 * priori from geometry; the phone reports what it reports; `calibration.ts`
 * decides whether they agree and, when they do not, names the single signed
 * axis permutation that explains every hold at once.
 *
 * All the judgement lives in that pure module. This file collects taps.
 */

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';

import {
  CALIBRATION_HOLDS,
  diagnoseConvention,
  type CalibrationHold,
  type Observation,
  type Vector3,
} from '../../src/live/calibration';
import { colors, styles, verdictColor } from './theme';
import type { DeviceSensors } from './useDeviceSensors';

function formatVector(v: Vector3 | undefined): string {
  if (!v) return '—';
  const f = (n: number) => (n >= 0 ? ' ' : '') + n.toFixed(3);
  return `(${f(v.x)}, ${f(v.y)}, ${f(v.z)})`;
}

export function CalibrateScreen({ sensors }: { sensors: DeviceSensors }) {
  const [captured, setCaptured] = useState<Partial<Record<CalibrationHold, Vector3>>>({});

  const live = sensors.gravity?.sample;
  const liveVector: Vector3 | undefined = live ? { x: live.x, y: live.y, z: live.z } : undefined;

  const observations = useMemo<Observation[]>(
    () =>
      CALIBRATION_HOLDS.flatMap((spec) => {
        const measured = captured[spec.hold];
        return measured ? [{ hold: spec.hold, measured }] : [];
      }),
    [captured],
  );

  const diagnosis = useMemo(
    () => (observations.length > 0 ? diagnoseConvention(observations) : undefined),
    [observations],
  );

  const verdictState =
    diagnosis === undefined
      ? 'unknown'
      : diagnosis.verdict === 'matches-convention'
        ? 'good'
        : diagnosis.verdict === 'insufficient'
          ? 'unknown'
          : diagnosis.verdict === 'systematic-remap'
            ? 'bad'
            : 'warn';

  const share = () => {
    // The traces go with the verdict deliberately: a verdict is a claim, and
    // the samples behind it are what lets someone else re-derive it — or turn
    // it into the replayed fixture P8.2 asks for.
    const payload = {
      recordedFor: 'Mountain Finder P8.2 — device frame convention',
      holds: observations,
      diagnosis: diagnosis
        ? {
            verdict: diagnosis.verdict,
            worstErrorDeg: diagnosis.worstErrorDeg,
            constrainedAxes: diagnosis.constrainedAxes,
            bestMap: diagnosis.bestMap,
            detail: diagnosis.detail,
          }
        : undefined,
      rawTraceAtCapture: sensors.captureTraces(),
    };
    void Share.share({ message: JSON.stringify(payload, null, 2) });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <Text style={styles.h1}>Frame convention check</Text>
      <Text style={styles.p}>
        Four holds whose gravity vector is known from geometry alone. Put the phone in each
        position, hold it still, and capture. Two holds on different axes are enough for a verdict;
        all four leave nothing untested.
      </Text>

      <View style={styles.panel}>
        <View style={styles.row}>
          <Text style={styles.h2}>Live gravity</Text>
          <Text style={{ color: sensors.moving ? colors.warn : colors.good, fontSize: 12 }}>
            {sensors.gravity === undefined
              ? 'no samples'
              : sensors.moving
                ? 'moving — hold still'
                : 'steady'}
          </Text>
        </View>
        <Text style={styles.mono}>{formatVector(liveVector)}</Text>
        <Text style={styles.p}>
          Unit vector pointing DOWN in device coordinates. {sensors.gravityCount} samples buffered.
          {sensors.motionPermission !== 'granted' ? ` Motion permission: ${sensors.motionPermission}.` : ''}
        </Text>
      </View>

      {CALIBRATION_HOLDS.map((spec) => {
        const measured = captured[spec.hold];
        const result = diagnosis?.results.find((r) => r.hold === spec.hold);
        return (
          <View key={spec.hold} style={styles.panel}>
            <View style={styles.row}>
              <Text style={styles.h2}>{spec.label}</Text>
              {result ? (
                <Text
                  style={{
                    color: verdictColor(result.pass ? 'good' : 'bad'),
                    fontSize: 12,
                    fontWeight: '700',
                  }}
                >
                  {result.pass ? 'matches' : `off by ${result.errorDeg.toFixed(1)}°`}
                </Text>
              ) : null}
            </View>
            <Text style={styles.p}>{spec.instruction}</Text>
            <Text style={[styles.p, { color: colors.dim }]}>Proves: {spec.proves}</Text>
            <View style={styles.row}>
              <Text style={styles.mono}>expected {formatVector(spec.expected)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.mono}>measured {formatVector(measured)}</Text>
            </View>
            <Pressable
              style={liveVector ? styles.button : styles.buttonGhost}
              disabled={!liveVector}
              onPress={() =>
                liveVector && setCaptured((prev) => ({ ...prev, [spec.hold]: liveVector }))
              }
            >
              <Text style={liveVector ? styles.buttonText : styles.buttonGhostText}>
                {measured ? 'Capture again' : 'Capture'}
              </Text>
            </Pressable>
          </View>
        );
      })}

      <View style={styles.panel}>
        <Text style={styles.h2}>Verdict</Text>
        {diagnosis === undefined ? (
          <Text style={styles.p}>Capture at least two holds on different axes.</Text>
        ) : (
          <>
            <Text style={{ color: verdictColor(verdictState), fontWeight: '700', fontSize: 15 }}>
              {diagnosis.verdict}
            </Text>
            <Text style={styles.p}>{diagnosis.detail}</Text>
          </>
        )}
        <Pressable style={styles.buttonGhost} onPress={share}>
          <Text style={styles.buttonGhostText}>Share result + trace</Text>
        </Pressable>
        <Pressable style={styles.buttonGhost} onPress={() => setCaptured({})}>
          <Text style={styles.buttonGhostText}>Clear</Text>
        </Pressable>
      </View>

      {sensors.error ? (
        <View style={styles.panel}>
          <Text style={{ color: colors.bad }}>{sensors.error}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
