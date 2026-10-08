import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The fixture projects contain test files of their own, which are scanned, never run.
    exclude: [...configDefaults.exclude, 'tests/fixtures/**'],
    globalSetup: ['tests/setup/build.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: { 100: true, perFile: true },
    },
  },
});
