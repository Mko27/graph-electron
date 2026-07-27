import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/electron/src/**/__tests__/**/*.test.ts',
      'packages/shared/src/**/__tests__/**/*.test.ts',
    ],
    environment: 'node',
    globals: false,
  },
});
