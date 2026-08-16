import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

import { terrainServerPlugin } from './scripts/terrain-server';

export default defineConfig({
  // The terrain plugin publishes /terrain/ from data/tiles/ and
  // fixtures/tiles/cases/ during dev and preview — see scripts/terrain-server.ts
  // for what it serves, what it refuses to serve, and what a production
  // deployment has to do instead.
  plugins: [react(), terrainServerPlugin()],
  test: {
    // Unit + integration tests. Acceptance tests run from their own config
    // (vitest.acceptance.config.ts) so `npm run check` stays fast.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
