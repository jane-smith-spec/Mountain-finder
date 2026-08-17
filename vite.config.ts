import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

import { peaksServerPlugin } from './scripts/peaks-server';
import { terrainServerPlugin } from './scripts/terrain-server';

export default defineConfig({
  // The terrain plugin publishes /terrain/ from data/tiles/ and
  // fixtures/tiles/cases/ during dev and preview — see scripts/terrain-server.ts
  // for what it serves, what it refuses to serve, and what a production
  // deployment has to do instead. The peaks plugin does the same for /peaks/
  // from fixtures/peaks/regions/ (Q8) — in production both are staged as
  // static files by `npm run package:deploy`.
  plugins: [react(), terrainServerPlugin(), peaksServerPlugin()],
  test: {
    // Unit + integration tests. Acceptance tests run from their own config
    // (vitest.acceptance.config.ts) so `npm run check` stays fast.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
