/**
 * Field-of-view derivation from lens focal length.
 *
 * A "35 mm equivalent" focal length is, by definition, the focal length that
 * would give the same framing on a full-frame (36 mm x 24 mm) film gate. The
 * horizontal field of view therefore only needs the 36 mm gate *width*:
 *
 *   hFovDeg = 2 * atan(36 / (2 * f35))
 *
 * The vertical field of view is NOT hFov * height / width — that is only true
 * for very narrow lenses. The rectilinear relation runs through the tangent:
 *
 *   tan(vFov / 2) = tan(hFov / 2) * (heightPx / widthPx)
 *
 * Angles are degrees (`Deg` suffix per src/core/types.ts naming rules).
 */

/** Width of the 35 mm full-frame reference gate, in millimetres. */
export const FULL_FRAME_WIDTH_MM = 36;

const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

/**
 * Horizontal field of view for a 35 mm-equivalent focal length.
 * @throws RangeError if the focal length is not a positive finite number.
 */
export function hFovDegFromFocalLength35mm(focalLength35mmMm: number): number {
  if (!Number.isFinite(focalLength35mmMm) || focalLength35mmMm <= 0) {
    throw new RangeError(
      `35mm-equivalent focal length must be a positive number, got ${String(focalLength35mmMm)}`,
    );
  }
  return 2 * Math.atan(FULL_FRAME_WIDTH_MM / (2 * focalLength35mmMm)) * DEG_PER_RAD;
}

/**
 * Vertical field of view implied by a horizontal field of view and the image
 * aspect ratio. Only the ratio of the pixel dimensions matters.
 * @throws RangeError on non-positive dimensions or an hFov outside (0, 180).
 */
export function vFovDegFromHFov(hFovDeg: number, widthPx: number, heightPx: number): number {
  if (!Number.isFinite(hFovDeg) || hFovDeg <= 0 || hFovDeg >= 180) {
    throw new RangeError(`hFovDeg must lie in (0, 180), got ${String(hFovDeg)}`);
  }
  if (!Number.isFinite(widthPx) || widthPx <= 0 || !Number.isFinite(heightPx) || heightPx <= 0) {
    throw new RangeError(
      `image dimensions must be positive, got ${String(widthPx)}x${String(heightPx)}`,
    );
  }
  const halfWidthTan = Math.tan((hFovDeg * RAD_PER_DEG) / 2);
  return 2 * Math.atan(halfWidthTan * (heightPx / widthPx)) * DEG_PER_RAD;
}
