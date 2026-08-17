/**
 * The photo with its overlay layer.
 *
 * With no overlay to show — no pose yet, a build in flight, or a build that
 * failed — the layer is a hatched, dashed, explicitly-labelled placeholder. It
 * draws no flags, no horizon line and no peak names, because a plausible-looking
 * stand-in summit is the one artefact that could be mistaken for a working
 * pipeline, and this project has been bitten by exactly that before.
 *
 * When an `OverlayResult` is supplied it is injected as-is: `svgMarkup` comes
 * from `buildOverlaySvg`, a pure string-producing function in our own tree, and
 * is sized to the photo's pixel frame so CSS scaling keeps it registered.
 *
 * `OverlayResult.notes` is rendered next to the label count, and that pairing is
 * the point: "2 peaks labelled" and "5 summits are outside this frame" have to
 * be read together, or a sparse overlay looks like a verdict about the view
 * rather than about the data behind it.
 *
 * DRAGGING (D9). The overlay can be pushed around with a pointer, which is the
 * primary way a user corrects the pose — the sliders remain, and both write the
 * same trim state, so neither can disagree with the other about where things
 * are. Drags are reported in the PHOTO's own pixel coordinates, not the
 * element's: the stage is CSS-scaled to fit, and handing the caller screen
 * pixels would make the same gesture mean different angles on different
 * displays. The conversion is the bounding rect, done here because this is the
 * only place that knows the rendered size.
 */

import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

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
  /**
   * Called as the overlay is dragged, with both points in PHOTO pixels.
   * Absent means dragging is off (no overlay, or no pose to trim).
   */
  onAlignDrag?: (
    fromPx: { xPx: number; yPx: number },
    toPx: { xPx: number; yPx: number },
  ) => void;
}

function placeholderNote(props: PhotoViewProps): string {
  // Only reachable when <App> is rendered without an overlayBuilder — a
  // component test, never the shipped app, which wires one in main.tsx.
  if (!props.builderWired) return 'No pipeline supplied to this view';
  if (props.missingFieldCount > 0) return 'Waiting on manual pose input';
  if (props.busy) return 'Computing the skyline…';
  if (props.errorMessage !== undefined) return 'Overlay failed';
  return 'No overlay yet';
}

export function PhotoView(props: PhotoViewProps): JSX.Element {
  const { photo, overlay, onAlignDrag } = props;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const lastRef = useRef<{ xPx: number; yPx: number } | null>(null);
  const draggable = onAlignDrag !== undefined && overlay !== undefined;

  /** Client coordinates -> the photo's own pixel grid. */
  const toPhotoPx = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): { xPx: number; yPx: number } | null => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width <= 0 || rect.height <= 0) return null;
    return {
      xPx: ((event.clientX - rect.left) / rect.width) * photo.widthPx,
      yPx: ((event.clientY - rect.top) / rect.height) * photo.heightPx,
    };
  };

  const handleDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!draggable) return;
    const at = toPhotoPx(event);
    if (at === null) return;
    lastRef.current = at;
    // Capture so a drag that leaves the stage keeps working — letting go
    // outside the picture is normal and must not strand the overlay.
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const from = lastRef.current;
    if (!draggable || from === null) return;
    const to = toPhotoPx(event);
    if (to === null) return;
    // Incremental: report each step from the previous one, so the caller adds
    // to the existing trim rather than recomputing it from the gesture start.
    // That composes with the sliders instead of fighting them.
    lastRef.current = to;
    onAlignDrag(from, to);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    lastRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <section className="panel" aria-labelledby="view-heading">
      <h2 id="view-heading">5. View</h2>
      {draggable ? (
        <p className="stage__hint" data-testid="drag-hint">
          Drag the picture to slide the labels into place. The overlay says which
          <em> way</em> a summit lies, not exactly which bump it is.
        </p>
      ) : null}
      <div
        className="stage"
        ref={stageRef}
        data-testid="photo-stage"
        data-draggable={draggable ? 'true' : 'false'}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          aspectRatio: `${photo.widthPx} / ${photo.heightPx}`,
          cursor: draggable ? 'grab' : undefined,
          touchAction: draggable ? 'none' : undefined,
        }}
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
      {overlay?.notes !== undefined && overlay.notes.length > 0 && (
        <ul
          className="status status--warn"
          data-testid="overlay-notes"
          data-note-count={overlay.notes.length}
        >
          {overlay.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {props.errorMessage !== undefined && (
        <p className="status status--error" role="alert" data-testid="overlay-error">
          {props.errorMessage}
        </p>
      )}
    </section>
  );
}
