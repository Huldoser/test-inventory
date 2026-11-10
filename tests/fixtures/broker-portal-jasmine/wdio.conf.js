export const config = {
  runner: 'local',
  specs: ['./test/specs/**/*.e2e.js'],
  baseUrl: 'http://localhost:4173',
  capabilities: [{ browserName: 'chrome' }],
  framework: 'jasmine',
  jasmineOpts: { defaultTimeoutInterval: 45000 },
};
