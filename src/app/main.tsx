/**
 * Browser entry point — and the wiring point TODO.md Q1 called for.
 *
 * The app itself imports nothing from the pipeline or the renderer; it takes
 * both as props typed in `seam.ts`. This file is where the real ones are built
 * and handed over:
 *
 *   terrain   HttpTerrainStore over /terrain/ (static SRTM grids on this app's
 *             OWN origin — no live elevation API at runtime, decision D7) read
 *             through TileElevationProvider, exactly as the Node side reads a
 *             tile directory.
 *   peaks     the committed offline peak database (fixtures/peaks). Summit
 *             heights come from here and never from the DEM — SRTM under-reads
 *             a sharp summit by hundreds of metres and displaces it sideways.
 *   overlay   createOverlayBuilder: pipeline → renderer → SVG.
 *   export    compositePng: photo + overlay → PNG blob, in the same Chromium
 *             the page is drawn in.
 *
 * The throwaway `?seam-probe=1` implementations that proved this seam before
 * the real ones existed are gone, along with `seam-probe.ts`. What used to be a
 * placeholder region is now either a real overlay or an explicit reason there
 * is none.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { groundTruthPeakStore } from '../../fixtures/peaks';
import { HttpTerrainStore } from '../providers/http-terrain-store';
import { DEFAULT_TERRAIN_MANIFEST_URL } from '../providers/terrain-manifest';
import { TileElevationProvider } from '../providers/tile-elevation';
import { App, type AppProps } from './App';
import { compositePng } from './composite-export';
import { createOverlayBuilder, type TerrainSource } from './overlay-builder';
import './styles.css';

const store = new HttpTerrainStore(DEFAULT_TERRAIN_MANIFEST_URL);
const terrain: TerrainSource = {
  elevation: new TileElevationProvider(store),
  coverage: (lat, lon) => store.coverage(lat, lon),
};

const props: AppProps = {
  overlayBuilder: createOverlayBuilder({ terrain, peaks: groundTruthPeakStore }),
  pngExporter: compositePng,
};

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <App {...props} />
  </StrictMode>,
);
