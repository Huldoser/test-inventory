// A WebdriverIO reporter for scripts/compare-runners.ts. WebdriverIO starts it in each worker; it adds every test the
// worker runs to the file its `outputFile` option names, one JSON line each, with its spec, titles and whether it was
// skipped. WebdriverIO's own reporters give no line and join titles with spaces.
import { appendFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

export default class CompareReporter extends EventEmitter {
  isSynchronised = true;

  constructor({ outputFile }) {
    super();
    const specs = [];
    const suites = [];
    const tests = new Map();
    const path = (file) => (file.startsWith('file://') ? fileURLToPath(file) : file);
    const record = (test, pending) => {
      const titles = [...suites.map((suite) => suite.title), test.title];
      const file = path(test.file ?? suites.at(-1)?.file ?? specs[0]);
      tests.set(`${file}\n${titles.join('\n')}`, { file, titles, pending });
    };
    this.on('runner:start', (runner) => specs.push(...runner.specs));
    this.on('suite:start', (suite) => {
      // Mocha's root suite has no title; WebdriverIO starts no suite for it, or one without a title.
      if (!suite.title) return;
      suites.push({ title: suite.title, file: path(suite.file ?? suites.at(-1)?.file ?? specs[0]) });
    });
    this.on('suite:end', (suite) => {
      if (suite.title) suites.pop();
    });
    this.on('test:pass', (test) => record(test, false));
    this.on('test:fail', (test) => record(test, false));
    this.on('test:pending', (test) => record(test, true));
    this.on('runner:end', () => {
      appendFileSync(outputFile, [...tests.values()].map((test) => `${JSON.stringify(test)}\n`).join(''));
    });
  }
}
