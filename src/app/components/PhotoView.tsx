/**
 * The photo with its overlay layer.
 *
 * Until the pipeline and renderer are wired in (TODO.md Q1) the overlay layer
 * shows a hatched, dashed, explicitly-labelled placeholder. It draws no flags,
 * no horizon line and no peak names, because a plausible-looking stand-in
 * summit is the one artefact that could be mistaken for a working pipeline —
 * and this project has been bitten by exactly that class of mistake before.
 *
 * When an `OverlayResult` is supplied it is injected as-is: `svgMarkup` comes
 * from `buildOverlaySvg`, a pure string-producing function in our own tree, and
 * is sized to the photo's pixel frame so CSS scaling keeps it registered.
 */

import type { LoadedPhoto } from '../state';
import type { OverlayResult } from '../seam';

export interface PhotoViewProps {
  photo: LoadedPhoto;
  overlay?: OverlayResult;
  /** Whether an overlay build is in flight. */
  busy: boolean;
  /** Set when the overlay build failed. */
  errorMessage?: string;
  /** False when no `overlayBuilder` prop was supplied at all. */
  builderWired: boolean;
  /** Fields still needing manual input; the overlay cannot run until zero. */
  missingFieldCount: number;
}

function placeholderNote(props: PhotoViewProps): string {
  if (!props.builderWired) return 'Pipeline not wired up yet (TODO.md Q1)';
  if (props.missingFieldCount > 0) return 'Waiting on manual pose input';
  if (props.busy) return 'Computing the skyline…';
  if (props.errorMessage !== undefined) return 'Overlay failed';
  return 'No overlay yet';
}

export function PhotoView(props: PhotoViewProps): JSX.Element {
  const { photo, overlay } = props;
  return (
    <section className="panel" aria-labelledby="view-heading">
      <h2 id="view-heading">5. View</h2>
      <div
        className="stage"
        data-testid="photo-stage"
        style={{ aspectRatio: `${photo.widthPx} / ${photo.heightPx}` }}
      >
        <img className="stage__photo" data-testid="photo-image" src={photo.url} alt={photo.fileName} />
        {overlay === undefined ? (
          <svg
            className="stage__layer"
            data-testid="overlay-placeholder"
            viewBox={`0 0 ${photo.widthPx} ${photo.heightPx}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Overlay placeholder: ${placeholderNote(props)}`}
          >
            <defs>
              <pattern
                id="placeholder-hatch"
                width="16"
                height="16"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="16" height="16" fill="none" />
                <line x1="0" y1="0" x2="0" y2="16" stroke="#f0b429" strokeWidth="3" opacity="0.35" />
              </pattern>
            </defs>
            <rect
              x="2%"
              y="2%"
              width="96%"
              height="96%"
              fill="url(#placeholder-hatch)"
              stroke="#f0b429"
              strokeWidth="4"
              strokeDasharray="18 12"
            />
          </svg>
        ) : (
          <div
            className="stage__layer"
            data-testid="overlay-svg"
            // The markup is produced by our own pure renderer, not by user input
            // or the network. This is the single wiring point for P4.1 output.
            dangerouslySetInnerHTML={{ __html: overlay.svgMarkup }}
          />
        )}
      </div>

      {overlay === undefined ? (
        <p className="status status--warn" data-testid="overlay-state" data-overlay="placeholder">
          <strong>Placeholder overlay.</strong> {placeholderNote(props)}. No peaks have been
          computed, so none are drawn — nothing on this image is a real result.
        </p>
      ) : (
        <p className="status status--ok" data-testid="overlay-state" data-overlay="live">
          {overlay.peakNames.length} peak{overlay.peakNames.length === 1 ? '' : 's'} labelled
          {overlay.peakNames.length > 0 ? `: ${overlay.peakNames.join(', ')}` : ''}.
        </p>
      )}
      {props.errorMessage !== undefined && (
        <p className="status status--error" role="alert" data-testid="overlay-error">
          {props.errorMessage}
        </p>
      )}
    </section>
  );
}
