export const config = {
  runner: 'local',
  specs: [['./test/specs/orders/*.e2e.js'], './test/specs/**/*.e2e.js'],
  exclude: ['./test/specs/drafts/**'],
  maxInstances: 4,
  capabilities: [{ browserName: 'chrome' }],
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 60000 },
};
