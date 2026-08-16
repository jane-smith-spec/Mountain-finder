/**
 * Browser entry point.
 *
 * The single wiring point for TODO.md Q1: import the pipeline's `OverlayBuilder`
 * and the renderer's `PngExporter` (both typed in `seam.ts`) and pass them here:
 *
 *   <App overlayBuilder={buildOverlay} pngExporter={compositePng} />
 *
 * With neither supplied the app is fully usable — photo, EXIF autofill,
 * provenance panel, trim sliders — and shows an explicitly labelled placeholder
 * where the overlay will go.
 *
 * `?seam-probe=1` swaps in the throwaway probe implementations so the e2e suite
 * can prove that seam works before the real ones exist. See seam-probe.ts; both
 * it and this branch are deleted at wiring time.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, type AppProps } from './App';
import { probeOverlayBuilder, probePngExporter, seamProbeEnabled } from './seam-probe';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

const props: AppProps = seamProbeEnabled(window.location.search)
  ? { overlayBuilder: probeOverlayBuilder, pngExporter: probePngExporter }
  : {};

createRoot(root).render(
  <StrictMode>
    <App {...props} />
  </StrictMode>,
);
