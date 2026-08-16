import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Unit + integration tests. Acceptance tests run from their own config
    // (vitest.acceptance.config.ts) so `npm run check` stays fast.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
