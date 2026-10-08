import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'market-data',
    globals: true,
  },
});
