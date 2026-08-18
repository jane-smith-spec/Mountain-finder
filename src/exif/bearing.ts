/**
 * Bearing arithmetic, kept deliberately free of any photo-reading dependency.
 *
 * This function lived in `extract.ts` until 2026-08-18, which was harmless
 * until something outside the browser wanted it: `extract.ts` imports `exifr`
 * at module scope, so `src/app/trim.ts` — pure angle arithmetic with no
 * interest in photographs — could not be imported by the React Native app
 * without dragging a JPEG parser into the bundle behind it.
 *
 * Splitting it out costs nothing (`extract.ts` and `index.ts` both re-export
 * it, so every existing import keeps working) and buys the mobile shell the
 * SAME trim model the web app uses, rather than a reimplementation that could
 * drift. That reuse is the point of D1's "the core is later reused unchanged".
 */

/**
 * Wrap any bearing into [0, 360).
 *
 * The `=== 0` branch collapses negative zero, which `%` produces for exact
 * negative multiples of 360 (`-360 % 360` is `-0`). Arithmetically that is
 * harmless — `-0 === 0` — but `(-0).toFixed(1)` is the string `"-0.0"`, so
 * without this a due-north bearing can reach the screen as "−0.0°".
 */
export function normaliseBearingDeg(bearingDeg: number): number {
  const wrapped = bearingDeg % 360;
  const positive = wrapped < 0 ? wrapped + 360 : wrapped;
  return positive === 0 ? 0 : positive;
}

/**
 * The signed difference `a − b`, wrapped into (−180, 180].
 *
 * The short way round, in other words: 350° and 10° are 20° apart, not 340°.
 * Used wherever a heading error is reported, where the naive subtraction
 * produces a number that is both huge and wrong near the seam.
 */
export function bearingDeltaDeg(aDeg: number, bDeg: number): number {
  const delta = normaliseBearingDeg(aDeg - bDeg);
  return delta > 180 ? delta - 360 : delta;
}
