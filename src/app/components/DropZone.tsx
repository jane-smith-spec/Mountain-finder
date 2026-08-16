/**
 * The photo drop zone.
 *
 * Accessibility: the primary control is a real `<input type="file">` with a
 * real `<label>`, so it is in the tab order, announced, and operable from the
 * keyboard by default. Drag-and-drop and click-anywhere are *additions* layered
 * on a plain region — never the only way in. The region itself is deliberately
 * not focusable and carries no `role`, so it does not become a second, silent
 * tab stop that duplicates the input.
 */

import { useCallback, useRef, useState, type DragEvent, type MouseEvent } from 'react';

export interface DropZoneProps {
  onFile: (file: File) => void;
  busy: boolean;
  /** Shown when the previous attempt failed. */
  errorMessage?: string;
  /** Name of the photo currently loaded, if any. */
  loadedFileName?: string;
  onClear?: () => void;
}

export function DropZone({
  onFile,
  busy,
  errorMessage,
  loadedFileName,
  onClear,
}: DropZoneProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const takeFirstFile = useCallback(
    (files: FileList | null) => {
      const file = files?.item(0);
      if (file) onFile(file);
    },
    [onFile],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      takeFirstFile(event.dataTransfer.files);
    },
    [takeFirstFile],
  );

  const handleRegionClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    // Only the empty area of the region opens the picker; clicks that land on
    // the label or the input are already handled natively.
    if (event.target === event.currentTarget) inputRef.current?.click();
  }, []);

  return (
    <section className="panel" aria-labelledby="dropzone-heading">
      <h2 id="dropzone-heading">1. Photo</h2>
      <div
        className={`dropzone${dragging ? ' dropzone--active' : ''}`}
        data-testid="dropzone"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => {
          setDragging(false);
        }}
        onDrop={handleDrop}
        onClick={handleRegionClick}
      >
        <p className="dropzone__prompt">Drag a JPEG here, or pick one:</p>
        <label className="file-label" htmlFor="photo-input">
          Choose photo
        </label>
        <input
          ref={inputRef}
          id="photo-input"
          data-testid="photo-input"
          className="file-input"
          type="file"
          accept="image/jpeg,.jpg,.jpeg"
          onChange={(event) => {
            takeFirstFile(event.target.files);
            // Allow re-picking the same file after a clear.
            event.target.value = '';
          }}
        />
        <p className="dropzone__note">
          JPEG only — it is the format that carries the EXIF this app reads. Nothing is uploaded;
          the photo never leaves the browser.
        </p>
      </div>

      {busy && (
        <p className="status" role="status" data-testid="photo-status">
          Reading photo…
        </p>
      )}
      {errorMessage !== undefined && (
        <p className="status status--error" role="alert" data-testid="photo-error">
          {errorMessage}
        </p>
      )}
      {loadedFileName !== undefined && (
        <p className="status" data-testid="photo-name">
          Loaded <strong>{loadedFileName}</strong>
          {onClear && (
            <button type="button" className="link-button" onClick={onClear}>
              Clear
            </button>
          )}
        </p>
      )}
    </section>
  );
}
