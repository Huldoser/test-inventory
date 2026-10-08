import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'broker-gateway',
    environment: 'node',
  },
});
