/**
 * A synthetic mountain photograph, drawn in the browser.
 *
 * The compositor test needs a photo to composite onto, and it needs one whose
 * *content* is known — the whole point of probing the exported raster is to
 * assert that a specific pixel is overlay ink rather than background, and that
 * only means something if the background is known not to be that colour.
 *
 * It is also a deliberately hostile background rather than a flat grey. The
 * overlay has to stay legible over the three things a real mountain photo does
 * to it: a bright hazy band right at the skyline (where the horizon line and
 * every summit dot land), near-black rock below it (which swallows dark ink),
 * and a bright sky above (which swallows white ink). All three are here, so the
 * saved artifact is a genuine legibility review and not a flattering one.
 *
 * Deterministic by construction: the "texture" is a fixed sine sum, never
 * `Math.random`, so the same scene exports the same bytes every run.
 */

import type { PointPx } from '../types';

export interface SyntheticPhotoInput {
  widthPx: number;
  heightPx: number;
  /**
   * The skyline to draw rock beneath, in image pixels — normally the layout's
   * own `horizonPolylinesPx`, so the photograph's ridge lines up with the
   * overlay's horizon and any misregistration is visible at a glance.
   */
  ridgePolylinesPx: readonly (readonly PointPx[])[];
}

/** Collect every ridge point, ordered left to right and spanning the frame. */
function ridgeProfile(input: SyntheticPhotoInput): PointPx[] {
  const points = input.ridgePolylinesPx
    .flat()
    .slice()
    .sort((a, b) => a.xPx - b.xPx);

  if (points.length === 0) {
    // No skyline supplied: put a flat ridge across the lower third so the
    // photo still has a sky, a haze band and rock.
    const yPx = input.heightPx * 0.62;
    return [
      { xPx: 0, yPx },
      { xPx: input.widthPx, yPx },
    ];
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return [];
  const extended = [...points];
  if (first.xPx > 0) extended.unshift({ xPx: 0, yPx: first.yPx });
  if (last.xPx < input.widthPx) extended.push({ xPx: input.widthPx, yPx: last.yPx });
  return extended;
}

/**
 * Draw the photograph and return it as a PNG `data:` URL.
 *
 * A `data:` URL rather than a canvas so the result can be handed straight to
 * the compositor's `photoSrc`, which is exactly how a user-supplied photo
 * arrives (a `FileReader` result) — the test path and the real path are the
 * same path.
 */
export function drawSyntheticMountainPhoto(input: SyntheticPhotoInput): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(input.widthPx);
  canvas.height = Math.round(input.heightPx);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('could not acquire a 2d canvas context');

  const { width, height } = canvas;
  const ridge = ridgeProfile(input);
  const ridgeTopYPx = ridge.reduce((min, point) => Math.min(min, point.yPx), height);

  // Sky: deep blue at the top fading into bright haze at the skyline. The pale
  // band is where labels are hardest to read, so it sits exactly at the ridge.
  const sky = context.createLinearGradient(0, 0, 0, ridgeTopYPx);
  sky.addColorStop(0, '#1d5c9e');
  sky.addColorStop(0.55, '#7fb0d6');
  sky.addColorStop(0.88, '#dfe9ee');
  sky.addColorStop(1, '#f2f4f2');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  // A low sun: a blown-out highlight to put white text over.
  const glow = context.createRadialGradient(
    width * 0.22,
    height * 0.2,
    0,
    width * 0.22,
    height * 0.2,
    height * 0.55,
  );
  glow.addColorStop(0, 'rgba(255,250,235,0.95)');
  glow.addColorStop(0.35, 'rgba(255,246,220,0.35)');
  glow.addColorStop(1, 'rgba(255,246,220,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  // Rock: everything below the ridge, near-black so dark ink disappears into it.
  context.beginPath();
  const first = ridge[0];
  if (first === undefined) throw new Error('empty ridge');
  context.moveTo(first.xPx, first.yPx);
  for (const point of ridge) context.lineTo(point.xPx, point.yPx);
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();

  const rock = context.createLinearGradient(0, ridgeTopYPx, 0, height);
  rock.addColorStop(0, '#4a4038');
  rock.addColorStop(0.35, '#2a2420');
  rock.addColorStop(1, '#0f0d0c');
  context.save();
  context.clip();
  context.fillStyle = rock;
  context.fillRect(0, 0, width, height);

  // Deterministic strata, so the rock is not a flat swatch that would make the
  // overlay look more legible than it is over real texture.
  context.strokeStyle = 'rgba(255,255,255,0.045)';
  context.lineWidth = Math.max(1, height / 400);
  for (let index = 0; index < 40; index += 1) {
    const offsetPx = (index / 40) * (height - ridgeTopYPx) * 1.2;
    context.beginPath();
    for (let xPx = 0; xPx <= width; xPx += width / 32) {
      const wobblePx =
        14 * Math.sin(xPx / 130 + index) + 7 * Math.sin(xPx / 47 + index * 2.3);
      const yPx = ridgeTopYPx + offsetPx + wobblePx;
      if (xPx === 0) context.moveTo(xPx, yPx);
      else context.lineTo(xPx, yPx);
    }
    context.stroke();
  }
  context.restore();

  return canvas.toDataURL('image/png');
}
