import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    include: [
      'apps/electron/src/**/__tests__/**/*.test.ts',
      'apps/renderer/src/**/__tests__/**/*.test.ts',
      'packages/shared/src/**/__tests__/**/*.test.ts',
      'packages/core/src/**/__tests__/**/*.test.ts',
    ],
    environment: 'node',
    globals: false,
  },
  resolve: {
    // Resolve workspace packages to their SOURCE, not their built dist/.
    // Without this the suite only passes after an undocumented `npm run
    // compile`, and a fresh clone fails with unresolved imports.
    alias: {
      '@graph-client/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@graph-client/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
    },
  },
});
