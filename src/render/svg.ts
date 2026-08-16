/**
 * Serialisation: a laid-out overlay → an SVG document, as a string.
 *
 * Pure by construction — `string` in, `string` out, no DOM, no clock, no
 * randomness — which is the property that makes P4.1 checkable without a
 * browser in the loop.
 *
 * ## Legibility over photographs
 *
 * The overlay has to stay readable over whatever the photo happens to be: a
 * blown-out hazy sky, sunlit snow, and near-black rock, often within a hundred
 * pixels of each other along the same skyline. A single flat colour cannot do
 * that — white vanishes into snow, black vanishes into rock. So every mark is
 * drawn twice: a dark, semi-transparent halo underneath and the bright mark on
 * top. Text gets the same treatment via `paint-order="stroke"`, which paints
 * the stroke *before* the fill so the outline sits behind the glyph instead of
 * eating into it. The result reads as light-on-dark against sky and
 * dark-on-light against snow without knowing anything about the image.
 *
 * The accent colour is a warm amber. It is chosen against the actual
 * backgrounds this renderer faces: sky and snow shadows are blue, distant haze
 * is blue-grey, so the accent that separates furthest from all of them is their
 * complement.
 */

import { layoutOverlay } from './layout';
import type { OverlayLayout, OverlayOptions, OverlayScene, PeakMarker } from './types';
import { attributes, escapeXml, formatCoordinate } from './xml';

/** Colours and stroke weights. Exported so the app can restyle without a fork. */
export interface OverlayTheme {
  horizonColor: string;
  poleColor: string;
  summitFillColor: string;
  summitStrokeColor: string;
  nameColor: string;
  detailColor: string;
  /** Colour of every halo — the dark under-layer that buys contrast. */
  haloColor: string;
  haloOpacity: number;
  /** Extra stroke width the halo adds on each side of a line, px. */
  haloSpreadPx: number;
  fontFamily: string;
  fontWeight: string;
}

export const DEFAULT_THEME: OverlayTheme = {
  horizonColor: '#ffd166',
  poleColor: '#ffffff',
  summitFillColor: '#ffd166',
  summitStrokeColor: '#1b1b1b',
  nameColor: '#ffffff',
  detailColor: '#ffe3a3',
  haloColor: '#000000',
  haloOpacity: 0.6,
  haloSpreadPx: 3,
  fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif',
  fontWeight: '600',
};

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function strokeWidths(layout: OverlayLayout): { horizonPx: number; polePx: number } {
  return {
    horizonPx: Math.max(1.5, layout.heightPx * 0.0018),
    polePx: Math.max(1.25, layout.heightPx * 0.0015),
  };
}

function polylinePoints(points: readonly { xPx: number; yPx: number }[]): string {
  return points
    .map((point) => `${formatCoordinate(point.xPx)},${formatCoordinate(point.yPx)}`)
    .join(' ');
}

function poleLine(marker: PeakMarker, extra: Readonly<Record<string, string | number>>): string {
  return `<line${attributes({
    x1: marker.summitPx.xPx,
    y1: marker.summitPx.yPx,
    x2: marker.poleTipPx.xPx,
    y2: marker.poleTipPx.yPx,
    ...extra,
  })}/>`;
}

function textElement(
  x: number,
  y: number,
  fontSizePx: number,
  fill: string,
  theme: OverlayTheme,
  content: string,
): string {
  return `<text${attributes({
    x,
    y,
    'font-size': formatCoordinate(fontSizePx),
    fill,
    stroke: theme.haloColor,
    'stroke-opacity': formatCoordinate(theme.haloOpacity + 0.2),
    'stroke-width': formatCoordinate(Math.max(2, fontSizePx * 0.18)),
    'stroke-linejoin': 'round',
    'paint-order': 'stroke',
  })}>${escapeXml(content)}</text>`;
}

/** Serialise an already-laid-out overlay. */
export function buildOverlaySvgFromLayout(
  layout: OverlayLayout,
  theme: OverlayTheme = DEFAULT_THEME,
): string {
  const widths = strokeWidths(layout);
  const lines: string[] = [];

  lines.push(
    `<svg${attributes({
      xmlns: SVG_NAMESPACE,
      width: layout.widthPx,
      height: layout.heightPx,
      viewBox: `0 0 ${formatCoordinate(layout.widthPx)} ${formatCoordinate(layout.heightPx)}`,
    })}>`,
  );

  // Pass 1 — every halo, so that a pole crossing another pole cannot lay its
  // own dark under-stroke over a neighbour's bright one.
  lines.push(
    `<g${attributes({
      class: 'mf-halo',
      fill: 'none',
      stroke: theme.haloColor,
      'stroke-opacity': formatCoordinate(theme.haloOpacity),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    })}>`,
  );
  for (const polyline of layout.horizonPolylinesPx) {
    lines.push(
      `<polyline${attributes({
        points: polylinePoints(polyline),
        'stroke-width': formatCoordinate(widths.horizonPx + 2 * theme.haloSpreadPx),
      })}/>`,
    );
  }
  for (const marker of layout.markers) {
    lines.push(
      poleLine(marker, {
        'stroke-width': formatCoordinate(widths.polePx + 2 * theme.haloSpreadPx),
      }),
    );
  }
  lines.push('</g>');

  // Pass 2 — the bright marks.
  lines.push(
    `<g${attributes({
      class: 'mf-horizon',
      fill: 'none',
      stroke: theme.horizonColor,
      'stroke-width': formatCoordinate(widths.horizonPx),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    })}>`,
  );
  for (const polyline of layout.horizonPolylinesPx) {
    lines.push(`<polyline${attributes({ points: polylinePoints(polyline) })}/>`);
  }
  lines.push('</g>');

  lines.push(
    `<g${attributes({
      class: 'mf-poles',
      stroke: theme.poleColor,
      'stroke-width': formatCoordinate(widths.polePx),
      'stroke-linecap': 'round',
    })}>`,
  );
  for (const marker of layout.markers) {
    lines.push(poleLine(marker, {}));
  }
  lines.push('</g>');

  lines.push(
    `<g${attributes({
      class: 'mf-summits',
      fill: theme.summitFillColor,
      stroke: theme.summitStrokeColor,
      'stroke-width': formatCoordinate(Math.max(1, widths.polePx * 0.8)),
    })}>`,
  );
  for (const marker of layout.markers) {
    lines.push(
      `<circle${attributes({
        cx: marker.summitPx.xPx,
        cy: marker.summitPx.yPx,
        r: layout.options.summitDotRadiusPx,
      })}/>`,
    );
  }
  lines.push('</g>');

  lines.push(
    `<g${attributes({
      class: 'mf-labels',
      'font-family': theme.fontFamily,
      'font-weight': theme.fontWeight,
      'text-anchor': 'middle',
    })}>`,
  );
  for (const marker of layout.markers) {
    lines.push(
      textElement(
        marker.labelCentreXPx,
        marker.nameBaselineYPx,
        layout.options.nameFontPx,
        theme.nameColor,
        theme,
        marker.nameText,
      ),
    );
    lines.push(
      textElement(
        marker.labelCentreXPx,
        marker.detailBaselineYPx,
        layout.options.detailFontPx,
        theme.detailColor,
        theme,
        marker.detailText,
      ),
    );
  }
  lines.push('</g>');

  lines.push('</svg>');
  return lines.join('\n');
}

/**
 * The P4.1 product: a scene in, an SVG document out.
 *
 * Deterministic in every respect — the same scene and options always produce
 * the same bytes, which is what lets the PNG compositor's output be compared
 * across runs and what makes a snapshot test mean something.
 */
export function buildOverlaySvg(
  scene: OverlayScene,
  options: OverlayOptions = {},
  theme: OverlayTheme = DEFAULT_THEME,
): string {
  return buildOverlaySvgFromLayout(layoutOverlay(scene, options), theme);
}
