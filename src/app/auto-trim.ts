/**
 * The browser side of the auto-trim seam (P7.4): photo pixels in, a
 * `TrimSuggestionView` out.
 *
 * Two layers, split so the policy is testable without a DOM:
 *
 *   `viewOfSuggestion`   pure — projects `PoseTrimSuggestion` onto what the
 *                        panel shows. THE one place alignment results become
 *                        sentences, so wording cannot drift per call site.
 *   `createTrimSuggester` DOM — loads the photo URL into an image, reads RGBA
 *                        off a canvas, and calls `suggestPoseTrim`.
 *
 * The photograph is downscaled before extraction. Not for looks: the
 * extractor reduces to ≤512 columns anyway, and reading a 4032×3024 frame's
 * `getImageData` allocates ~48 MB to feed a 512-column reduction. A ~1600 px
 * copy preserves more rows than the extractor's evidence bands need and keeps
 * the allocation under 8 MB. The SUGGESTION is unaffected: offsets are
 * angles, and the pose's fields of view describe the frame at any pixel size.
 */

import {
  suggestPoseTrim,
  type PoseTrimSuggestion,
} from '../pipeline/cv-alignment.js';
import type { TrimSuggester, TrimSuggestionRequest, TrimSuggestionView } from './seam.js';

/** Longest edge of the working copy the extractor reads. */
export const EXTRACTION_MAX_WIDTH_PX = 1600;

/** The gates' names, in words a slider-dragging user can act on. */
const CONCERN_TEXT: Record<string, string> = {
  'insufficient-skyline': 'much of the skyline was unreadable',
  'featureless-photo-skyline': 'the photographed skyline is nearly flat',
  'featureless-terrain-profile': 'the terrain profile is nearly flat here',
  'ambiguous-correlation': 'several offsets fit almost equally well',
  'no-correlation': 'the match to the terrain shape is weak',
  'residual-too-large': 'the matched skyline still misses by a lot',
  'search-range-exhausted': 'the best match sits at the edge of the compass budget',
  'profile-does-not-cover-frame': 'the terrain profile does not cover this frame',
};

function concernSentence(concern: string): string {
  return CONCERN_TEXT[concern] ?? concern;
}

/** Pure projection: pipeline suggestion → what the panel says. */
export function viewOfSuggestion(suggestion: PoseTrimSuggestion): TrimSuggestionView {
  if (suggestion.status === 'declined') {
    return {
      status: 'declined',
      message:
        suggestion.reason === 'near-field-in-profile'
          ? 'Auto-align declined: the terrain profile here rests on ground too close to the ' +
            'camera to resolve. The manual controls are the honest option.'
          : `Auto-align found no trustworthy match: ${suggestion.detail}`,
    };
  }
  return {
    status: 'suggested',
    headingTrimDeg: suggestion.headingTrimDeg,
    pitchTrimDeg: suggestion.pitchTrimDeg,
    tentative: suggestion.alignment.status === 'low-confidence',
    concerns: suggestion.alignment.concerns.map(concernSentence),
  };
}

/** Load an object/data URL into pixels. Rejects if the browser cannot decode. */
async function rgbaFromUrl(
  url: string,
): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  const scale = Math.min(1, EXTRACTION_MAX_WIDTH_PX / Math.max(1, image.naturalWidth));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Could not create a canvas context to read the photo.');
  context.drawImage(image, 0, 0, width, height);
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

/** The seam implementation `main.tsx` hands to `<App>`. */
export function createTrimSuggester(): TrimSuggester {
  return async (request: TrimSuggestionRequest): Promise<TrimSuggestionView> => {
    const image = await rgbaFromUrl(request.photoUrl);
    const suggestion = suggestPoseTrim({
      image,
      scene: { camera: request.camera, horizon: request.horizon },
    });
    return viewOfSuggestion(suggestion);
  };
}
