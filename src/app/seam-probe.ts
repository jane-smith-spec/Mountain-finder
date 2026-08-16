/**
 * ⚠ TEST-ONLY SEAM PROBE — NOT PART OF THE PRODUCT.
 *
 * These two implementations exist for exactly one reason: to prove that the
 * `OverlayBuilder` / `PngExporter` seam in `seam.ts` actually works end to end
 * in a browser — the effect fires, the SVG lands over the photo, the export
 * button un-disables, and a PNG of the right size reaches the user — BEFORE the
 * real pipeline (TODO.md Q1) exists. Without this, "the seam is mechanical to
 * wire up" would be an untested claim, which this project does not accept.
 *
 * They are reachable ONLY via the `?seam-probe=1` query parameter and they
 * fabricate NOTHING that could be mistaken for a result:
 *
 *   - the overlay draws one crossed-out box reading "SEAM PROBE";
 *   - the only "peak name" it reports is literally "SEAM PROBE (not a peak)";
 *   - the exported PNG is a flat colour with the same words on it. It does not
 *     composite the photo — compositing is P4.2's job, in src/render/composite,
 *     and duplicating it here would be the kind of second implementation that
 *     quietly disagrees with the first.
 *
 * DELETE THIS FILE when the real builder and compositor are wired in.
 */

import type { OverlayBuilder, PhotoFrame, PngExporter } from './seam';

export const SEAM_PROBE_PARAM = 'seam-probe';

const PROBE_LABEL = 'SEAM PROBE';

/** True when the page URL explicitly asks for the probe. Off in every other case. */
export function seamProbeEnabled(search: string): boolean {
  return new URLSearchParams(search).get(SEAM_PROBE_PARAM) === '1';
}

function probeSvg({ widthPx, heightPx }: PhotoFrame): string {
  const fontPx = Math.max(16, Math.round(heightPx * 0.06));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(widthPx)} ${String(heightPx)}"`,
    ` width="${String(widthPx)}" height="${String(heightPx)}">`,
    `<rect x="4" y="4" width="${String(widthPx - 8)}" height="${String(heightPx - 8)}"`,
    ' fill="none" stroke="#ff00ff" stroke-width="6" stroke-dasharray="20 14"/>',
    `<line x1="4" y1="4" x2="${String(widthPx - 4)}" y2="${String(heightPx - 4)}"`,
    ' stroke="#ff00ff" stroke-width="4"/>',
    `<text x="${String(widthPx / 2)}" y="${String(heightPx / 2)}" fill="#ff00ff"`,
    ` font-family="monospace" font-size="${String(fontPx)}" text-anchor="middle">`,
    `${PROBE_LABEL} — not a real overlay</text>`,
    '</svg>',
  ].join('');
}

export const probeOverlayBuilder: OverlayBuilder = (request) =>
  Promise.resolve({
    svgMarkup: probeSvg(request.frame),
    peakNames: [`${PROBE_LABEL} (not a peak)`],
  });

export const probePngExporter: PngExporter = async ({ frame }) => {
  const canvas = document.createElement('canvas');
  canvas.width = frame.widthPx;
  canvas.height = frame.heightPx;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D canvas context unavailable');
  context.fillStyle = '#202020';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ff00ff';
  context.font = `${String(Math.max(16, Math.round(frame.heightPx * 0.06)))}px monospace`;
  context.textAlign = 'center';
  context.fillText(`${PROBE_LABEL} — not a real export`, canvas.width / 2, canvas.height / 2);
  return new Promise<Blob>((resolvePromise, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('canvas.toBlob produced nothing'));
      else resolvePromise(blob);
    }, 'image/png');
  });
};
