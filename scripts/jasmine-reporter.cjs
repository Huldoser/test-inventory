// A Jasmine reporter for scripts/compare-runners.ts: after the run, it writes every spec to jasmine-tests.json in the
// folder Jasmine runs in, with its titles, file and status. Jasmine's own output gives no line, and its full names join
// the titles with spaces, so describes can't be told apart there.
const { writeFileSync } = require('node:fs');
const path = require('node:path');

module.exports = class CompareReporter {
  constructor() {
    this.titles = [];
    this.specs = [];
  }

  suiteStarted(suite) {
    this.titles.push(suite.description);
  }

  suiteDone() {
    this.titles.pop();
  }

  specDone(spec) {
    this.specs.push({ file: spec.filename, titles: [...this.titles, spec.description], status: spec.status });
  }

  jasmineDone() {
    writeFileSync(path.join(process.cwd(), 'jasmine-tests.json'), JSON.stringify(this.specs));
  }
};
