import { describe, expect, it } from 'vitest';
import { nodeTestCommands, scriptsRunBy } from '../src/node-scripts.ts';

describe('the node --test commands of a package.json script', () => {
  // Each option Node.js reads with its value as the next word, so the value is never a file to test.
  it.each([
    ['--allow-fs-read', './fixtures'],
    ['--allow-fs-write', './reports'],
    ['--conditions', 'development'],
    ['-C', 'development'],
    ['--config-file', 'node.config.json'],
    ['--cpu-prof-dir', 'profiles'],
    ['--cpu-prof-name', 'orders.cpuprofile'],
    ['--diagnostic-dir', 'diagnostics'],
    ['--disable-warning', 'ExperimentalWarning'],
    ['--dns-result-order', 'ipv4first'],
    ['--env-file', '.env.test'],
    ['--env-file-if-exists', '.env.local'],
    ['--experimental-config-file', 'node.config.json'],
    ['--experimental-loader', 'ts-node/esm'],
    ['--heap-prof-dir', 'profiles'],
    ['--heap-prof-name', 'orders.heapprofile'],
    ['--heapsnapshot-signal', 'SIGUSR2'],
    ['--icu-data-dir', 'icu'],
    ['--import', './test/setup.mjs'],
    ['--input-type', 'module'],
    ['--loader', 'ts-node/esm'],
    ['--localstorage-file', 'storage.json'],
    ['--max-http-header-size', '16384'],
    ['--openssl-config', 'openssl.cnf'],
    ['--redirect-warnings', 'warnings.log'],
    ['--report-dir', 'reports'],
    ['--report-filename', 'report.json'],
    ['--require', './test/setup.cjs'],
    ['-r', './test/setup.cjs'],
    ['--secure-heap', '65536'],
    ['--secure-heap-min', '2'],
    ['--test-concurrency', '4'],
    ['--test-coverage-branches', '90'],
    ['--test-coverage-exclude', 'src/legacy/**'],
    ['--test-coverage-functions', '90'],
    ['--test-coverage-include', 'src/**'],
    ['--test-coverage-lines', '90'],
    ['--test-global-setup', './test/global-setup.mjs'],
    ['--test-isolation', 'none'],
    ['--test-name-pattern', 'fills'],
    ['--test-random-seed', '42'],
    ['--test-reporter', 'spec'],
    ['--test-reporter-destination', 'stdout'],
    ['--test-rerun-failures', 'failures.json'],
    ['--test-shard', '1/3'],
    ['--test-skip-pattern', 'slow'],
    ['--test-timeout', '5000'],
    ['--title', 'order-router-tests'],
    ['--unhandled-rejections', 'strict'],
    ['--watch-kill-signal', 'SIGINT'],
    ['--watch-path', 'src'],
  ])('reads the word after %s as its value, before and after --test', (option, value) => {
    expect(nodeTestCommands(`node ${option} ${value} --test test/orders.test.mjs`)).toEqual([['test/orders.test.mjs']]);
    expect(nodeTestCommands(`node --test ${option} ${value} test/orders.test.mjs`)).toEqual([['test/orders.test.mjs']]);
  });

  it('reads node or node.exe at any path, each command of a chain, and --test after a file as an argument of the script', () => {
    expect(
      nodeTestCommands(
        "/usr/local/bin/node --test 'test/unit/*.test.mjs' && C:\\\\nodejs\\\\node.exe --test test/e2e; node build.js --test",
      ),
    ).toEqual([['test/unit/*.test.mjs'], ['test/e2e']]);
    expect(nodeTestCommands('nodemon --test test/orders.test.mjs | tee out.log || nodes --test')).toEqual([]);
  });
});

describe('the scripts a package.json script runs', () => {
  const scripts = {
    test: 'TZ=UTC npm t && cross-env CI=1 npm run-script lint -- --fix && pnpm run fills && yarn quotes',
    lint: 'npm rum format; npm urn types',
    format: 'prettier --check .',
    types: 'tsc --noEmit',
    fills: 'run-p "fills:*" "e2e/*" && bun x tsc',
    'fills:partial': 'node --test test/fills/partial.test.mjs',
    'fills:full': 'node --test test/fills/full.test.mjs',
    'fills:full:slow': 'node --test test/fills/slow.test.mjs',
    '.fills:hidden': 'node --test test/fills/hidden.test.mjs',
    'e2e/chromium': 'node --test test/e2e/chromium.test.mjs',
    quotes: 'yarn install && npm ci && bun run book',
    book: 'npm tst',
    unused: 'node --test test/unused.test.mjs',
    broken: 42,
  };

  it('follows npm, pnpm, yarn, bun run and npm-run-all, past variables set before the command, each script once', () => {
    expect(scriptsRunBy(scripts, 'test')).toEqual([
      scripts.test,
      scripts.lint,
      scripts.format,
      scripts.types,
      scripts.fills,
      scripts['fills:partial'],
      scripts['fills:full'],
      scripts['e2e/chromium'],
      scripts.quotes,
      scripts.book,
    ]);
  });

  it('runs nothing for a name that is no script or not a string, and npm-run-all matches no dot name and no negation', () => {
    expect(scriptsRunBy(scripts, 'missing')).toEqual([]);
    expect(scriptsRunBy(scripts, 'broken')).toEqual([]);
    const all = { all: 'npm-run-all --parallel "*:hidden" "!fills:partial"', ...scripts };
    expect(scriptsRunBy(all, 'all')).toEqual([all.all]);
  });
});
