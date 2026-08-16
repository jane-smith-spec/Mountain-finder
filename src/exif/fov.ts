/**
 * Field-of-view derivation from lens focal length.
 *
 * A "35 mm equivalent" focal length is, by definition, the focal length that
 * would give the same framing on a full-frame film gate. That gate is
 * 36 mm x 24 mm, and the angle a focal length spans across it depends on WHICH
 * side you measure:
 *
 *   long side (36 mm):   2 * atan(36 / (2 * f35))
 *   short side (24 mm):  2 * atan(24 / (2 * f35))
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE CONVENTION THIS MODULE USES, STATED AS A CONVENTION
 * ───────────────────────────────────────────────────────────────────────────
 * `FocalLengthIn35mmFormat` is one number and a frame has two dimensions, so
 * turning it into a field of view needs an assumption about what the camera
 * maker matched when it computed the equivalence. Two are in circulation:
 *
 *   LONG SIDE (used here). f35 is the focal length that frames the same view
 *     across the 36 mm side of the gate. The 36 mm angle therefore belongs to
 *     the LONGER side of the photograph, and the other side follows through the
 *     rectilinear tangent relation.
 *   DIAGONAL. f35 is derived from the ratio of frame diagonals (43.267 mm for
 *     the 35 mm gate), which is how crop factors are usually quoted.
 *
 * The two agree EXACTLY on a 3:2 frame — the shape of the 35 mm gate itself —
 * and diverge elsewhere: on the 3:4 dead-sea fixture at f35 = 50 the long-side
 * convention gives hFOV 30.219° and the diagonal convention 29.105°.
 *
 * The long side is chosen because the tag names the 35 mm FILM FORMAT, whose
 * gate is 36 x 24, and because the sensor's true diagonal — the input the
 * diagonal convention actually needs — is not in the file. Neither reading is
 * derivable from the EXIF alone; this one is stated so it can be argued with,
 * and it is worth roughly a degree of hFOV on a 4:3 phone frame. It is NOT the
 * error this module was rewritten to fix: applying the 36 mm angle to the image
 * WIDTH regardless of orientation (adversarial review 2, finding 3) was worth
 * 12 % of the frame's width on a portrait photograph, and both conventions
 * agree that it was wrong.
 *
 * The vertical field of view is NOT hFov * height / width — that is only true
 * for very narrow lenses. The rectilinear relation runs through the tangent:
 *
 *   tan(vFov / 2) = tan(hFov / 2) * (heightPx / widthPx)
 *
 * Angles are degrees (`Deg` suffix per src/core/types.ts naming rules).
 */

/** Long side of the 35 mm full-frame reference gate, in millimetres. */
export const FULL_FRAME_WIDTH_MM = 36;

/** Short side of the same gate. Present so the shape is stated, not implied. */
export const FULL_FRAME_HEIGHT_MM = 24;

const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

/**
 * The angle a 35 mm-equivalent focal length spans across the LONG side of the
 * frame — the 36 mm dimension of the gate.
 *
 * This is the honest name for `2 * atan(36 / (2 * f35))`. It is an hFov only
 * when the photograph is landscape; see {@link fovDegFromFocalLength35mm},
 * which is what callers with pixel dimensions should use.
 *
 * @throws RangeError if the focal length is not a positive finite number.
 */
export function longSideFovDegFromFocalLength35mm(focalLength35mmMm: number): number {
  if (!Number.isFinite(focalLength35mmMm) || focalLength35mmMm <= 0) {
    throw new RangeError(
      `35mm-equivalent focal length must be a positive number, got ${String(focalLength35mmMm)}`,
    );
  }
  return 2 * Math.atan(FULL_FRAME_WIDTH_MM / (2 * focalLength35mmMm)) * DEG_PER_RAD;
}

/**
 * Horizontal field of view for a 35 mm-equivalent focal length, ASSUMING a
 * landscape frame.
 *
 * Kept for callers that genuinely have no pixel dimensions to orient by (an
 * hFov typed into the override panel is the same quantity). With dimensions in
 * hand, use {@link fovDegFromFocalLength35mm} instead — on a portrait photo
 * this function returns the angle across the frame's HEIGHT.
 *
 * @throws RangeError if the focal length is not a positive finite number.
 */
export function hFovDegFromFocalLength35mm(focalLength35mmMm: number): number {
  return longSideFovDegFromFocalLength35mm(focalLength35mmMm);
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

/** Both fields of view of one photograph. */
export interface FieldOfViewDeg {
  readonly hFovDeg: number;
  readonly vFovDeg: number;
}

/**
 * Both fields of view from a 35 mm-equivalent focal length and the frame's
 * DISPLAYED pixel dimensions.
 *
 * The 36 mm angle goes to whichever displayed axis is longer, and the other
 * axis follows through the tangent relation. A square frame is not a special
 * case: both sides are "the longer one" and the two angles come out equal,
 * which is the right answer.
 *
 * "Displayed" is load-bearing. A phone held upright stores its sensor's
 * landscape frame and sets EXIF Orientation 6; the pixel dimensions in the file
 * describe the STORED frame, and using them here would give the long-side angle
 * to the wrong axis of the picture the user is actually looking at. Callers
 * must apply Orientation first — `photoExifFromTags` does.
 *
 * @throws RangeError on a non-positive focal length or non-positive dimensions.
 */
export function fovDegFromFocalLength35mm(
  focalLength35mmMm: number,
  displayedWidthPx: number,
  displayedHeightPx: number,
): FieldOfViewDeg {
  const longSideDeg = longSideFovDegFromFocalLength35mm(focalLength35mmMm);
  if (
    !Number.isFinite(displayedWidthPx) ||
    displayedWidthPx <= 0 ||
    !Number.isFinite(displayedHeightPx) ||
    displayedHeightPx <= 0
  ) {
    throw new RangeError(
      `image dimensions must be positive, got ${String(displayedWidthPx)}x${String(displayedHeightPx)}`,
    );
  }

  if (displayedWidthPx >= displayedHeightPx) {
    return {
      hFovDeg: longSideDeg,
      vFovDeg: vFovDegFromHFov(longSideDeg, displayedWidthPx, displayedHeightPx),
    };
  }
  // Portrait: the long side is the height, so the 36 mm angle is the vertical
  // one and the horizontal follows from the inverted ratio.
  return {
    hFovDeg: vFovDegFromHFov(longSideDeg, displayedHeightPx, displayedWidthPx),
    vFovDeg: longSideDeg,
  };
}
