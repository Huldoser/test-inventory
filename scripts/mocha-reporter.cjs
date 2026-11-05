// A Mocha reporter for scripts/compare-runners.ts: after the run, it writes every test Mocha registered to
// mocha-tests.json in the folder Mocha runs in, with its titles, file and whether it was skipped. Mocha's own JSON
// reporter joins the titles with spaces and gives no line, so describes can't be told apart there.
const { writeFileSync } = require('node:fs');
const path = require('node:path');

module.exports = function CompareReporter(runner) {
  runner.once('end', () => {
    const tests = [];
    const visit = (suite) => {
      for (const test of suite.tests)
        tests.push({ file: test.file, titles: test.titlePath(), pending: test.isPending() });
      for (const child of suite.suites) visit(child);
    };
    visit(runner.suite);
    writeFileSync(path.join(process.cwd(), 'mocha-tests.json'), JSON.stringify(tests));
  });
};
