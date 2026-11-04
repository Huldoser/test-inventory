/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-puppeteer',
  testMatch: ['<rootDir>/e2e/**/*.e2e.js'],
  testTimeout: 30000,
};
