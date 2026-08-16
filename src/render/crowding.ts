/**
 * Saying out loud that the frame was too full.
 *
 * The renderer is allowed to leave a name off a summit when there is no room
 * for it (see rule 7 in `layout.ts`), and the price of that permission is that
 * the omission has to be visible. Not visible in a debug field somewhere —
 * visible to whoever is looking at the picture. A frame that quietly names 24
 * of 74 summits reads as a view with 24 summits in it, which is a claim, and a
 * false one; this project's whole discipline is that a plausible wrong answer
 * is more dangerous than a loud failure.
 *
 * So the omission is stated three times over, in three places with three
 * different audiences:
 *
 *   1. **On the image** — {@link crowdingIndicatorText}, drawn in the corner of
 *      the SVG by `svg.ts`. Survives being screenshotted, cropped and pasted
 *      into a chat, which is what actually happens to an exported overlay.
 *   2. **In the picture's own marks** — every crowded-out summit still gets a
 *      dot. The count of unnamed dots is what makes an over-full frame look
 *      over-full. That is `svg.ts`'s job, not this module's.
 *   3. **In prose** — {@link crowdingNote}, for `OverlayResult.notes`, which is
 *      the same channel that already reports off-frame and foreground-occluded
 *      summits. It names names, because "18 more" is a number and "18 more,
 *      including Bietschhorn and Wiwannihorn" is an answer.
 *
 * Pure string building. No layout maths, no DOM, no clock.
 */

import type { OverlayLayout } from './types';

/** Up to `limit` names, then "and N more". */
function nameList(names: readonly string[], limit = 4): string {
  if (names.length <= limit) return names.join(', ');
  return `${names.slice(0, limit).join(', ')} and ${String(names.length - limit)} more`;
}

/**
 * The one line drawn on the image itself when labels had to be withheld.
 *
 * Deliberately says what the reader can SEE — dots without names — rather than
 * an abstraction like "decluttered". Returns `undefined` for a frame that fit,
 * which is how `svg.ts` knows to draw nothing at all.
 */
export function crowdingIndicatorText(crowdedOutCount: number): string | undefined {
  if (crowdedOutCount <= 0) return undefined;
  const plural = crowdedOutCount === 1 ? '' : 's';
  return (
    `+${String(crowdedOutCount)} more named summit${plural} in this frame — ` +
    `marked, too crowded to label`
  );
}

/**
 * The prose form, for `OverlayResult.notes`.
 *
 * Names the summits in the order they lost, which is highest-riding first, so
 * the first names in the sentence are the ones a viewer is most likely to be
 * pointing at and asking about.
 */
export function crowdingNote(layout: OverlayLayout): string | undefined {
  const dropped = layout.crowdedOutSummits;
  if (dropped.length === 0) return undefined;
  const total = layout.markers.length + dropped.length;
  return (
    `${String(dropped.length)} of the ${String(total)} named summits in this frame ` +
    `${dropped.length === 1 ? 'is' : 'are'} marked with a dot but not labelled: there is no ` +
    `room for ${dropped.length === 1 ? 'its name' : 'their names'} without burying the ` +
    `overlay in text. Dropped in order of how high they ride in the view: ` +
    `${nameList(dropped.map((entry) => entry.peak.name))}.`
  );
}
