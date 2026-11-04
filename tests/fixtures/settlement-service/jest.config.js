/** @type {import('jest').Config} */
module.exports = {
  testTimeout: 10000,
  projects: [
    { displayName: 'unit', testMatch: ['<rootDir>/src/**/*.test.js', '<rootDir>/src/__tests__/**/*.js'] },
    { displayName: 'integration', testMatch: ['<rootDir>/tests/integration/**/*.test.js'] },
  ],
};
