const { defineConfig } = require('cypress');

module.exports = defineConfig({
  retries: { runMode: 1, openMode: 0 },
  e2e: {
    baseUrl: 'http://localhost:4173',
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: 'cypress/support/e2e.js',
  },
  component: {
    devServer: { framework: 'react', bundler: 'vite' },
    specPattern: 'src/**/*.cy.tsx',
    supportFile: 'cypress/support/component.js',
  },
});
