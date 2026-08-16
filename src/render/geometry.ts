/**
 * Pixel-space geometry helpers: is a direction in front of the lens, and what
 * is left of a line segment once the frame has been cut out of it.
 *
 * Nothing here re-implements the projection — `src/core/projection.ts` owns
 * that, and this module imports `cameraAxes`/`directionVector` from it for the
 * one thing the projection's public result does not expose.
 */

import { cameraAxes, directionVector } from '../core/projection';
import type { CameraAxes } from '../core/projection';
import type { CameraPose } from '../core/types';
import type { PointPx } from './types';

/**
 * Is a world direction on the visible side of the lens?
 *
 * `projectToImage` reports `inFrame: false` for anything behind the camera, but
 * it still returns an x/y — the perspective divide by a negative depth mirrors
 * the point back through the centre of the frame, so a summit directly behind
 * the photographer produces coordinates that look perfectly reasonable. For
 * peaks that does not matter (they are simply dropped), but for the horizon
 * *polyline* it does: a sample that folds back into frame would draw a line
 * across the photograph from a piece of terrain nobody can see. So the sign of
 * the depth has to be recovered explicitly, and that means the dot product with
 * the forward axis.
 *
 * Pass `axes` when testing many directions against one pose — `cameraAxes` is
 * six trig calls, and the horizon sweep asks this question a few hundred times.
 */
export function isInFrontOfCamera(
  pose: CameraPose,
  bearingDeg: number,
  altitudeDeg: number,
  axes: CameraAxes = cameraAxes(pose),
): boolean {
  const direction = directionVector(bearingDeg, altitudeDeg);
  const depth =
    direction.e * axes.forward.e +
    direction.n * axes.forward.n +
    direction.u * axes.forward.u;
  return depth > 0;
}

/**
 * Clip a segment to the rectangle `[0,widthPx] × [0,heightPx]`, returning the
 * surviving piece or `undefined` if the segment misses the frame entirely.
 *
 * Liang–Barsky: the segment is `a + t·(b−a)` for t ∈ [0,1], and each of the
 * four edges contributes an inequality `p·t ≤ q`. Shrinking [t0,t1] against all
 * four leaves exactly the visible interval, and `p = 0` (parallel to an edge)
 * with `q < 0` (outside it) rejects the whole segment. Chosen over
 * Cohen–Sutherland because it computes the two surviving parameters directly
 * instead of iterating, so the result is a deterministic pair of numbers rather
 * than the fixed point of a loop.
 *
 * A degenerate segment (a == b) inside the frame survives as itself, which is
 * what lets a one-point polyline still be reported honestly instead of vanishing.
 */
export function clipSegmentToFrame(
  a: PointPx,
  b: PointPx,
  widthPx: number,
  heightPx: number,
): readonly [PointPx, PointPx] | undefined {
  const dx = b.xPx - a.xPx;
  const dy = b.yPx - a.yPx;

  // [p, q] per edge: left, right, top, bottom.
  const edges: readonly (readonly [number, number])[] = [
    [-dx, a.xPx],
    [dx, widthPx - a.xPx],
    [-dy, a.yPx],
    [dy, heightPx - a.yPx],
  ];

  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return undefined;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return undefined;
      if (t < t1) t1 = t;
    }
  }

  return [
    { xPx: a.xPx + t0 * dx, yPx: a.yPx + t0 * dy },
    { xPx: a.xPx + t1 * dx, yPx: a.yPx + t1 * dy },
  ];
}

/** Largest coordinate difference for which two clipped endpoints are "the same point". */
const JOIN_EPSILON_PX = 1e-9;

/**
 * Clip a polyline to the frame, splitting it into the runs that survive.
 *
 * Consecutive clipped segments are joined into one polyline only when the end
 * of one is the start of the next, which happens exactly when the polyline
 * stayed inside the frame between them. Where it left and re-entered, the two
 * clipped pieces meet the frame edge at different points and a new run starts —
 * so a skyline that dips below the bottom of the photo and comes back produces
 * two polylines, not one with a false chord drawn across the gap.
 *
 * `undefined` entries in the input mark breaks (a sample behind the camera) and
 * always end the current run.
 */
export function clipPolylineToFrame(
  points: readonly (PointPx | undefined)[],
  widthPx: number,
  heightPx: number,
): readonly (readonly PointPx[])[] {
  const runs: PointPx[][] = [];
  let current: PointPx[] | undefined;

  const startRun = (from: PointPx, to: PointPx): void => {
    current = [from, to];
    runs.push(current);
  };

  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a === undefined || b === undefined) {
      current = undefined;
      continue;
    }

    const clipped = clipSegmentToFrame(a, b, widthPx, heightPx);
    if (clipped === undefined) {
      current = undefined;
      continue;
    }

    const [from, to] = clipped;
    const tail = current?.[current.length - 1];
    if (
      current !== undefined &&
      tail !== undefined &&
      Math.abs(tail.xPx - from.xPx) <= JOIN_EPSILON_PX &&
      Math.abs(tail.yPx - from.yPx) <= JOIN_EPSILON_PX
    ) {
      current.push(to);
    } else {
      startRun(from, to);
    }
  }

  return runs;
}
