// A Mocha reporter that Cypress runs for scripts/compare-runners.ts. Cypress starts it once per spec; at the end of
// each, it adds every test of the spec to cypress-tests.jsonl in the folder Cypress runs in, with its titles, spec and
// whether it was skipped. Cypress's own reporters give no line and join titles with spaces.
const { appendFileSync } = require('node:fs');
const path = require('node:path');

module.exports = function CompareReporter(runner) {
  runner.once('end', () => {
    const lines = [];
    const visit = (suite, titles, file) => {
      const spec = suite.file || file;
      for (const test of suite.tests) {
        const pending = test.pending === true || test.state === 'pending';
        lines.push(JSON.stringify({ file: spec, titles: [...titles, test.title], pending }));
      }
      for (const child of suite.suites) visit(child, [...titles, child.title], spec);
    };
    visit(runner.suite, [], null);
    appendFileSync(path.join(process.cwd(), 'cypress-tests.jsonl'), lines.map((line) => `${line}\n`).join(''));
  });
};
