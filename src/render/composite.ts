/**
 * P4.2 — the PNG compositor: photograph + SVG overlay → one exported image.
 *
 * ## Why this runs in a browser
 *
 * Everything else in `src/render` is pure and runs anywhere. This module is the
 * deliberate exception, and it is the only one: it needs a rasteriser. The
 * alternative — `node-canvas` — drags in a native build of Cairo, Pango and
 * libjpeg, which is a heavy dependency to install, a fragile one to build, and
 * a *second* text-and-SVG rendering engine that would disagree with the browser
 * the app itself renders in. Chromium is already installed here and already
 * driven by Playwright, so the raster the tests check is produced by exactly
 * the engine that will produce the user's export. Zero new dependencies.
 *
 * That is also why the module is not re-exported from `src/render/index.ts`:
 * the purity of the overlay builder should be visible in the import graph.
 *
 * ## Why the overlay goes through an `<img>`
 *
 * The overlay is drawn by handing the SVG to the browser as an image and
 * calling `drawImage`, rather than by re-issuing every line and label as canvas
 * calls. Re-issuing them would mean a second implementation of the overlay —
 * one for the screen, one for the export — that could drift apart, and canvas
 * has no equivalent of `paint-order`, so the label halos would have to be
 * re-invented too. One SVG, rendered by one engine, exported and displayed
 * identically.
 *
 * The image is loaded from a `data:` URL. `data:` sources do not taint the
 * canvas, so `toDataURL`/`toBlob` keep working; an SVG fetched from another
 * origin would poison the canvas and make the export throw a SecurityError.
 */

/**
 * Encode an SVG document as a `data:` URL.
 *
 * Base64 over UTF-8 bytes, not `btoa(svg)` directly: `btoa` throws on any code
 * point above U+00FF, and peak names are full of them — `Dent d'Hérens` is
 * fine, but `Ōyama` or `Дыхтау` would take the export down. Encoding to UTF-8
 * first and base64-ing the bytes is the only form that round-trips every name
 * the peak database can produce.
 */
export function svgToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/** Load an image source, resolving once it is decodable. */
export function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = (): void => resolve(image);
    image.onerror = (): void =>
      reject(new Error(`failed to load image (${source.slice(0, 64)}…)`));
    image.src = source;
  });
}

/** What the compositor needs: a photo, an overlay, and the output size. */
export interface CompositeInput {
  /** The photograph. A `data:` URL or a same-origin URL. */
  photoSrc: string;
  /** The overlay document from {@link import('./svg').buildOverlaySvg}. */
  overlaySvg: string;
  /** Output width in pixels — normally the photograph's own width. */
  widthPx: number;
  /** Output height in pixels. */
  heightPx: number;
}

/**
 * Draw the photograph and then the overlay onto a fresh canvas.
 *
 * The photograph is stretched to the output box rather than letterboxed. That
 * is correct here and not a shortcut: the overlay's coordinates come from
 * projecting through a camera pose whose field of view was derived from *this
 * photograph's* aspect ratio, so any letterboxing would put the flags in the
 * wrong place. The caller passes the photo's own dimensions and the two agree
 * exactly.
 */
export async function compositeToCanvas(input: CompositeInput): Promise<HTMLCanvasElement> {
  if (!(input.widthPx > 0) || !(input.heightPx > 0)) {
    throw new RangeError(
      `output dimensions must be > 0, received ${input.widthPx}×${input.heightPx}`,
    );
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(input.widthPx);
  canvas.height = Math.round(input.heightPx);

  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('could not acquire a 2d canvas context');
  }

  const [photo, overlay] = await Promise.all([
    loadImage(input.photoSrc),
    loadImage(svgToDataUrl(input.overlaySvg)),
  ]);

  context.drawImage(photo, 0, 0, canvas.width, canvas.height);
  context.drawImage(overlay, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Compose and encode as a PNG `data:` URL. */
export async function compositeToPngDataUrl(input: CompositeInput): Promise<string> {
  const canvas = await compositeToCanvas(input);
  return canvas.toDataURL('image/png');
}

/**
 * Compose and encode as a PNG `Blob` — the form a download link wants.
 *
 * `toBlob` reports failure by passing `null` rather than throwing, which is
 * easy to miss and would surface much later as a download of zero bytes.
 */
export async function compositeToPngBlob(input: CompositeInput): Promise<Blob> {
  const canvas = await compositeToCanvas(input);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error('canvas.toBlob returned null — PNG encoding failed'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}
