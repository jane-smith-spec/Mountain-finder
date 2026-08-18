/**
 * The camera with a computed horizon drawn over it.
 *
 * This is a convention check you can read at a glance, and it is why it exists
 * before any peak labelling: the line is produced by the SAME `projectToImage`
 * the still pipeline uses, fed by the SAME `poseWithSensors` the live loop
 * will use. If pitch or roll carries the wrong sign, the drawn line pulls away
 * from the real horizon behind it — tilt the phone left and the line tilts
 * right. No test in this repository can catch that. A window can.
 *
 * What is deliberately NOT here: peaks. Labelling summits needs terrain, and
 * terrain needs a decision about how a phone gets square degrees of DEM
 * offline (D7). Building an AR overlay on top of an unverified sign convention
 * is the ordering mistake this project keeps declining to make — so the
 * horizon comes first, and the peaks come after the holds pass.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import {
  cameraAxes,
  cameraPoseFromFocalLength,
  directionVector,
  projectToImage,
} from '../../src/core/projection';
import type { CameraPose } from '../../src/core/types';
import { poseWithSensors, type SensorAnswer } from '../../src/live/sensors';
import { colors, styles } from './theme';
import type { DeviceSensors } from './useDeviceSensors';

/**
 * 35 mm-equivalent focal lengths for the common phone rear cameras. The app
 * cannot ask the hardware what it is currently using through Expo Go, so this
 * is a stated assumption the user can correct — never a silent default. A
 * wrong choice scales the horizon's spread across the frame; it does NOT
 * change which way the line tilts, which is what this screen is really for.
 */
const LENS_PRESETS: readonly { label: string; focalLength35mm: number }[] = [
  { label: 'Ultra-wide · 13 mm', focalLength35mm: 13 },
  { label: 'Main · 26 mm', focalLength35mm: 26 },
  { label: 'Tele · 77 mm', focalLength35mm: 77 },
];

/** Bearings marked along the horizon, degrees. */
const TICK_STEP_DEG = 15;

function cardinal(bearingDeg: number): string {
  const normalised = ((bearingDeg % 360) + 360) % 360;
  const names: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  return names[normalised] ?? `${normalised}`;
}

/** Dot product of two East-North-Up vectors. */
function dot(a: { e: number; n: number; u: number }, b: { e: number; n: number; u: number }): number {
  return a.e * b.e + a.n * b.n + a.u * b.u;
}

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  readonly bearingDeg: number;
}

/**
 * The zero-altitude horizon as screen points.
 *
 * Points behind the camera are dropped rather than projected: the perspective
 * divide mirrors them back into frame with finite coordinates, so drawing them
 * would produce a confident line through the wrong part of the sky. That is
 * the same rule `projectToImage` documents; the depth test is repeated here
 * because a polyline needs to omit those vertices, not merely mark them.
 */
function horizonPoints(pose: CameraPose, widthPx: number, heightPx: number): ScreenPoint[] {
  const axes = cameraAxes(pose);
  const halfSpan = Math.min(80, pose.hFovDeg * 0.75);
  const steps = 61;
  const points: ScreenPoint[] = [];
  for (let i = 0; i < steps; i += 1) {
    const bearingDeg = pose.headingDeg - halfSpan + (2 * halfSpan * i) / (steps - 1);
    if (dot(directionVector(bearingDeg, 0), axes.forward) <= 0.05) continue;
    const projected = projectToImage(pose, bearingDeg, 0);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) continue;
    points.push({ x: projected.x * widthPx, y: projected.y * heightPx, bearingDeg });
  }
  return points;
}

function tickPoints(pose: CameraPose, widthPx: number, heightPx: number): ScreenPoint[] {
  const axes = cameraAxes(pose);
  const first = Math.ceil((pose.headingDeg - pose.hFovDeg / 2) / TICK_STEP_DEG) * TICK_STEP_DEG;
  const last = pose.headingDeg + pose.hFovDeg / 2;
  const points: ScreenPoint[] = [];
  for (let bearingDeg = first; bearingDeg <= last; bearingDeg += TICK_STEP_DEG) {
    if (dot(directionVector(bearingDeg, 0), axes.forward) <= 0.05) continue;
    const projected = projectToImage(pose, bearingDeg, 0);
    if (!projected.inFrame) continue;
    points.push({ x: projected.x * widthPx, y: projected.y * heightPx, bearingDeg });
  }
  return points;
}

function answerText(answer: SensorAnswer, unit = '°'): string {
  if (!answer.ok) return answer.refusal;
  const spread = answer.field.spreadDeg;
  return (
    `${answer.field.valueDeg.toFixed(2)}${unit}` +
    (spread === undefined ? '' : ` ±${spread.toFixed(2)}`)
  );
}

export function HorizonScreen({ sensors }: { sensors: DeviceSensors }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [lensIndex, setLensIndex] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const lens = LENS_PRESETS[lensIndex] ?? LENS_PRESETS[1];
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  const ready = size.width > 0 && size.height > 0 && lens !== undefined;
  const base: CameraPose | undefined = ready
    ? cameraPoseFromFocalLength({
        headingDeg: 0,
        focalLength35mm: lens.focalLength35mm,
        imageWidthPx: size.width,
        imageHeightPx: size.height,
      })
    : undefined;
  const applied = base ? poseWithSensors(base, sensors.pose) : undefined;
  // Every angle the sensors refused keeps the base pose's value, so a partial
  // answer still draws — but the readout below names what was assumed.
  const pose = applied?.pose;
  const canDraw = pose !== undefined && applied !== undefined && applied.applied.includes('heading');

  if (!permission) {
    return (
      <View style={[styles.screen, styles.body]}>
        <Text style={styles.p}>Checking camera permission…</Text>
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={[styles.screen, styles.body]}>
        <Text style={styles.h2}>Camera permission needed</Text>
        <Text style={styles.p}>
          The preview is only a backdrop — the horizon line is computed from the sensors either
          way. Without it you can still use the frame convention check.
        </Text>
        <Pressable style={styles.button} onPress={() => void requestPermission()}>
          <Text style={styles.buttonText}>Grant camera access</Text>
        </Pressable>
      </View>
    );
  }

  const horizon = pose && ready ? horizonPoints(pose, size.width, size.height) : [];
  const ticks = pose && ready ? tickPoints(pose, size.width, size.height) : [];

  return (
    <View style={styles.screen}>
      <View style={{ flex: 1 }} onLayout={onLayout}>
        <CameraView style={StyleSheet.absoluteFill} facing="back" />
        {canDraw && horizon.length > 1 ? (
          <Svg style={StyleSheet.absoluteFill}>
            <Polyline
              points={horizon.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={colors.accent}
              strokeWidth={2}
            />
            {ticks.map((tick) => (
              <Fragment key={tick.bearingDeg}>
                <Line
                  x1={tick.x}
                  y1={tick.y - 10}
                  x2={tick.x}
                  y2={tick.y + 10}
                  stroke={colors.accent}
                  strokeWidth={2}
                />
                <SvgText x={tick.x} y={tick.y - 16} fill={colors.text} fontSize={12} textAnchor="middle">
                  {cardinal(tick.bearingDeg)}
                </SvgText>
              </Fragment>
            ))}
            <Circle cx={size.width / 2} cy={size.height / 2} r={3} fill={colors.accent} />
          </Svg>
        ) : null}
      </View>

      <View style={[styles.panel, { margin: 12 }]}>
        <View style={styles.row}>
          <Text style={styles.mono}>heading {answerText(sensors.pose.heading)}</Text>
          <Text style={styles.mono}>pitch {answerText(sensors.pose.pitch)}</Text>
          <Text style={styles.mono}>roll {answerText(sensors.pose.roll)}</Text>
        </View>
        {!canDraw ? (
          <Text style={{ color: colors.warn, fontSize: 12 }}>
            No line drawn: a true heading is required, and the compass has not supplied one.
            {sensors.locationPermission !== 'granted'
              ? ' Location permission is not granted, so Core Location reports true north as unavailable rather than guessing it.'
              : ''}
          </Text>
        ) : null}
        <View style={styles.row}>
          {LENS_PRESETS.map((preset, index) => (
            <Pressable
              key={preset.label}
              style={[styles.buttonGhost, index === lensIndex ? { borderColor: colors.accent } : null]}
              onPress={() => setLensIndex(index)}
            >
              <Text style={[styles.buttonGhostText, { fontSize: 11 }]}>{preset.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.p}>
          The lens is an assumption, not a measurement — it scales how far the line spreads across
          the frame, but not which way it tilts. Tilt the phone: the line must stay on the real
          horizon.
        </Text>
      </View>
    </View>
  );
}
