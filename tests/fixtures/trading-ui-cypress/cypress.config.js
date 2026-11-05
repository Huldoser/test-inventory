const { defineConfig } = require('cypress');

module.exports = defineConfig({
  video: false,
  retries: { runMode: 1, openMode: 0 },
  e2e: {
    supportFile: false,
  },
});
