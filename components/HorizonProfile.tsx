/**
 * HorizonProfile
 *
 * Renders the terrain silhouette as an SVG polyline overlaid on the camera
 * feed.  Only the portion of the horizon that falls within the camera's
 * horizontal FOV is drawn — as the user pans, the visible segment slides.
 *
 * A filled polygon below the line tints the terrain area for legibility.
 */

import React, { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import { HorizonPoint } from '../utils/terrainProjection';
import { CONFIG } from '../constants/config';

interface Props {
  profile: HorizonPoint[];
  heading: number;
}

export function HorizonProfile({ profile, heading }: Props) {
  const { width: W, height: H } = useWindowDimensions();
  const { CAMERA_HFOV: hFOV, CAMERA_VFOV: vFOV } = CONFIG;

  // Convert horizon profile points that are within the FOV to SVG coordinates.
  const { linePoints, polygonPoints } = useMemo(() => {
    // Keep samples within FOV + a small bleed margin
    const margin = 4; // degrees
    const visible = profile
      .map((p) => {
        let dAz = p.bearingDeg - heading;
        if (dAz > 180) dAz -= 360;
        if (dAz < -180) dAz += 360;
        return { dAz, elevationAngleDeg: p.elevationAngleDeg };
      })
      .filter(({ dAz }) => Math.abs(dAz) <= hFOV / 2 + margin)
      .sort((a, b) => a.dAz - b.dAz);

    if (visible.length < 2) return { linePoints: '', polygonPoints: '' };

    const svgPts = visible.map(({ dAz, elevationAngleDeg }) => {
      const x = ((0.5 + dAz / hFOV) * W).toFixed(1);
      const y = ((0.5 - elevationAngleDeg / vFOV) * H).toFixed(1);
      return `${x},${y}`;
    });

    const line = svgPts.join(' ');

    // Close the polygon along the bottom edge of the screen
    const firstX = ((0.5 + visible[0].dAz / hFOV) * W).toFixed(1);
    const lastX = ((0.5 + visible[visible.length - 1].dAz / hFOV) * W).toFixed(1);
    const polygon = `${line} ${lastX},${H} ${firstX},${H}`;

    return { linePoints: line, polygonPoints: polygon };
  }, [profile, heading, W, H, hFOV, vFOV]);

  if (!linePoints) return null;

  return (
    <Svg
      width={W}
      height={H}
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      {/* Terrain fill */}
      <Polygon
        points={polygonPoints}
        fill="rgba(0, 10, 30, 0.35)"
      />
      {/* Silhouette line */}
      <Polyline
        points={linePoints}
        fill="none"
        stroke="rgba(0, 229, 255, 0.7)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}
