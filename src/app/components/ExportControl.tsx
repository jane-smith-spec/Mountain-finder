/**
 * P5.2 — export the annotated view as a PNG.
 *
 * The compositing itself belongs to the renderer (P4.2, `PngExporter` in
 * seam.ts). What lives here is the control and, more importantly, an HONEST
 * disabled state: the button is enabled only when there is genuinely something
 * to export, and when it is disabled it says which of the four reasons applies
 * (no photo / incomplete pose / no compositor wired / no overlay computed).
 * `exportDisabledReason` is pure and unit-tested, so "disabled" is a checkable
 * claim rather than a hopeful one.
 */

export interface ExportControlProps {
  /** undefined = the button is genuinely usable. */
  disabledReason?: string;
  busy: boolean;
  /** Set after a successful or failed export. */
  message?: string;
  onExport: () => void;
  fileName: string;
}

export function ExportControl({
  disabledReason,
  busy,
  message,
  onExport,
  fileName,
}: ExportControlProps): JSX.Element {
  const disabled = disabledReason !== undefined || busy;
  return (
    <section className="panel" aria-labelledby="export-heading">
      <h2 id="export-heading">7. Export</h2>
      <button
        type="button"
        className="button button--primary"
        data-testid="export-png"
        disabled={disabled}
        aria-describedby="export-state"
        onClick={onExport}
      >
        {busy ? 'Exporting…' : 'Export annotated PNG'}
      </button>
      <p
        className={`status${disabledReason === undefined ? ' status--ok' : ' status--warn'}`}
        id="export-state"
        data-testid="export-state"
        data-disabled-reason={disabledReason ?? ''}
      >
        {disabledReason ?? `Ready — will download ${fileName} at full photo resolution.`}
      </p>
      {message !== undefined && (
        <p className="status" role="status" data-testid="export-message">
          {message}
        </p>
      )}
    </section>
  );
}
