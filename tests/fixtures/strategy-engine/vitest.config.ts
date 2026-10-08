import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    includeSource: ['src/**/*.ts'],
    typecheck: { enabled: true, include: ['tests/**/*.test-d.ts'] },
    tags: [{ name: 'fees', description: 'Commission and regulatory fee rules that change with broker contracts' }],
  },
});
