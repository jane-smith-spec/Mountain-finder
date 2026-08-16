/**
 * P5.1 / P5.2 — the app shell: photo in, honest pose out, overlay seam ready.
 *
 * The component tree holds exactly one piece of state (`AppState` in state.ts,
 * a pure module) plus whatever the async seam calls produce. Every rule worth
 * testing — provenance, trim arithmetic, export readiness — lives in the pure
 * modules and is covered by `npx vitest run src/app`; this file is composition
 * and effects.
 *
 * It imports NOTHING from `src/render` or `src/pipeline`. Both arrive as
 * optional props typed in `seam.ts` and are constructed in `main.tsx`; with
 * neither supplied the app still runs, showing a labelled placeholder instead
 * of inventing peaks.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { AttributionFooter } from './components/AttributionFooter';
import { DropZone } from './components/DropZone';
import { ExifSummary } from './components/ExifSummary';
import { ExportControl } from './components/ExportControl';
import { ObscuredPeaksControl } from './components/ObscuredPeaksControl';
import { OverridePanel } from './components/OverridePanel';
import { PhotoView } from './components/PhotoView';
import { PoseReadout } from './components/PoseReadout';
import { TrimSliders } from './components/TrimSliders';
import { readPhotoFile } from './photo';
import { annotatedFileName, type OverlayBuilder, type OverlayResult, type PngExporter } from './seam';
import { deriveSession, exportDisabledReason, INITIAL_STATE, reducer } from './state';

export interface AppProps {
  /**
   * The pipeline + renderer call (`createOverlayBuilder`, wired in main.tsx).
   * Optional so this component can be rendered without one — the app then
   * shows its placeholder rather than pretending to have computed anything.
   */
  overlayBuilder?: OverlayBuilder;
  /** The PNG compositor (P4.2), likewise wired in main.tsx. */
  pngExporter?: PngExporter;
}

export function App({ overlayBuilder, pngExporter }: AppProps = {}): JSX.Element {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [overlay, setOverlay] = useState<OverlayResult | undefined>(undefined);
  const [overlayError, setOverlayError] = useState<string | undefined>(undefined);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | undefined>(undefined);

  const session = useMemo(() => deriveSession(state), [state]);

  // Object URLs are owned by this component: revoke the previous photo's URL
  // whenever it is replaced, and on unmount.
  const currentUrl = useRef<string | undefined>(undefined);
  const photoUrl = session?.photo.url;
  useEffect(() => {
    const previous = currentUrl.current;
    if (previous !== undefined && previous !== photoUrl) URL.revokeObjectURL(previous);
    currentUrl.current = photoUrl;
  }, [photoUrl]);

  const handleFile = useCallback((file: File) => {
    dispatch({ type: 'photo-reading', fileName: file.name });
    void readPhotoFile(file).then(
      (photo) => {
        dispatch({ type: 'photo-loaded', photo });
      },
      (error: unknown) => {
        dispatch({
          type: 'photo-failed',
          message: error instanceof Error ? error.message : 'Could not read that file.',
        });
      },
    );
  }, []);

  const request = session?.overlayRequest;
  // The request is rebuilt on every render, so the effect keys off its VALUE
  // rather than its identity; otherwise the pipeline would be re-run on every
  // keystroke that changes nothing it depends on.
  const requestKey = request === undefined ? '' : JSON.stringify(request);
  useEffect(() => {
    if (overlayBuilder === undefined || request === undefined) {
      setOverlay(undefined);
      setOverlayError(undefined);
      return;
    }
    const controller = new AbortController();
    let live = true;
    setOverlayBusy(true);
    void overlayBuilder({ ...request, signal: controller.signal })
      .then((result) => {
        if (!live) return;
        setOverlay(result);
        setOverlayError(undefined);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setOverlay(undefined);
        setOverlayError(error instanceof Error ? error.message : 'Overlay build failed.');
      })
      .finally(() => {
        if (live) setOverlayBusy(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
    // `request` is intentionally absent from the dependency list: `requestKey`
    // is its value, and depending on the object itself would re-run the
    // pipeline on every single render.
  }, [overlayBuilder, requestKey]);

  const downloadName = annotatedFileName(session?.photo.fileName ?? 'photo.jpg');

  const handleExport = useCallback(() => {
    if (pngExporter === undefined || overlay === undefined || session === undefined) return;
    setExportBusy(true);
    setExportMessage(undefined);
    void pngExporter({
      photoUrl: session.photo.url,
      svgMarkup: overlay.svgMarkup,
      frame: { widthPx: session.photo.widthPx, heightPx: session.photo.heightPx },
    })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = downloadName;
        anchor.click();
        // Revoke on the next macrotask: the browser needs the URL to stay
        // alive long enough to start the download it was just handed.
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 0);
        setExportMessage(`Saved ${downloadName}.`);
      })
      .catch((error: unknown) => {
        setExportMessage(error instanceof Error ? error.message : 'Export failed.');
      })
      .finally(() => {
        setExportBusy(false);
      });
  }, [pngExporter, overlay, session, downloadName]);

  const disabledReason = exportDisabledReason({
    hasPhoto: session !== undefined,
    missingFieldCount: session?.missing.length ?? 0,
    hasOverlay: overlay !== undefined,
    hasExporter: pngExporter !== undefined,
  });

  return (
    <>
      <main className="app">
        <header className="app__header">
          <h1 data-testid="app-title">Mountain Finder</h1>
          <p data-testid="app-phase" className="app__tagline">
            Drop a mountain photo. Every number it uses is shown with where it came from — EXIF, you,
            or an assumption you opted into. Nothing is invented.
          </p>
        </header>

        <DropZone
          onFile={handleFile}
          busy={state.status === 'reading'}
          errorMessage={state.errorMessage}
          loadedFileName={session?.photo.fileName}
          onClear={() => {
            dispatch({ type: 'photo-cleared' });
          }}
        />

        {session === undefined ? (
          <p className="status" data-testid="empty-state">
            No photo loaded yet.
          </p>
        ) : (
          <div className="app__columns">
            <div className="app__column">
              <PhotoView
                photo={session.photo}
                overlay={overlay}
                busy={overlayBusy}
                errorMessage={overlayError}
                builderWired={overlayBuilder !== undefined}
                missingFieldCount={session.missing.length}
              />
              <TrimSliders
                trim={state.trim}
                onTrimChange={(axis, valueDeg) => {
                  dispatch({ type: 'trim-changed', axis, valueDeg });
                }}
                onReset={() => {
                  dispatch({ type: 'trim-reset' });
                }}
                basePose={session.basePose}
                effectivePose={session.effectivePose}
              />
              <PoseReadout
                request={session.overlayRequest}
                missing={session.missing}
              />
              <ObscuredPeaksControl
                showObscuredPeaks={state.showObscuredPeaks}
                onToggle={(enabled) => {
                  dispatch({ type: 'obscured-peaks-toggled', enabled });
                }}
              />
              <ExportControl
                disabledReason={disabledReason}
                busy={exportBusy}
                message={exportMessage}
                onExport={handleExport}
                fileName={downloadName}
              />
            </div>
            <div className="app__column">
              <ExifSummary exif={session.photo.exif} dimensions={session.dimensions} />
              <OverridePanel
                resolution={session.resolution}
                drafts={state.drafts}
                onDraftChange={(field, text) => {
                  dispatch({ type: 'draft-changed', field, text });
                }}
                onDraftRevert={(field) => {
                  dispatch({ type: 'draft-reverted', field });
                }}
                declinationDraft={state.declinationDraft}
                onDeclinationChange={(text) => {
                  dispatch({ type: 'declination-changed', text });
                }}
                useStandardAssumptions={state.useStandardAssumptions}
                onAssumptionsToggle={(enabled) => {
                  dispatch({ type: 'assumptions-toggled', enabled });
                }}
              />
            </div>
          </div>
        )}
      </main>

      {/*
       * Outside <main> on purpose: a <footer> that is not nested in a sectioning
       * element is the document's contentinfo landmark, so a screen-reader user
       * can jump straight to the data credit. It is the last thing in the
       * document and sticks to the bottom of the viewport — see the component.
       */}
      <AttributionFooter />
    </>
  );
}
