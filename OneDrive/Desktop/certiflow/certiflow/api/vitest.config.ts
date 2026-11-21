import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests share one test database, so run files one after another.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
    setupFiles: ['./tests/setup.ts'],
  },
});
