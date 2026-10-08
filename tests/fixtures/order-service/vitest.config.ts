import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    tags: [{ name: 'db', description: 'Needs a Postgres database; set DATABASE_URL to run them' }],
  },
});
