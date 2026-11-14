import { describe, expect, it } from 'vitest';
import { nodeTestCommands, runnerCommands, scriptsRunBy } from '../src/node-scripts.ts';

describe('the node --test commands of a package.json script', () => {
  it('keeps preload arguments separate from values of other Node options', () => {
    expect(
      nodeTestCommands(
        'node --test --test-timeout 5000 -r ./setup/clock.cjs --import=./setup/venue.mjs tests/orders.test.mjs',
        true,
      ),
    ).toEqual([['./setup/clock.cjs', './setup/venue.mjs']]);
    expect(nodeTestCommands('node --test --require', true)).toEqual([[]]);
  });

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
  it('keeps an empty preparation script without inventing a child command', () => {
    const scripts = { orders: 'npm run prepare', prepare: '' };
    expect(scriptsRunBy(scripts, 'orders')).toEqual([scripts.orders, scripts.prepare]);
  });

  it.each(['test', 't', 'tst'])('follows the npm %s alias without following its script arguments', (alias) => {
    const scripts = {
      orders: `npm ${alias} -- --run audit`,
      test: 'node --test tests/orders.test.mjs',
      audit: 'node audit.mjs',
    };
    expect(scriptsRunBy(scripts, 'orders')).toEqual([scripts.orders, scripts.test]);
  });

  it('uses npm-run-all task globs only before its argument separator', () => {
    const scripts = {
      orders: 'npm-run-all order:* -- audit',
      'order:quotes': 'node --test tests/quotes.test.mjs',
      audit: 'node audit.mjs',
    };
    expect(scriptsRunBy(scripts, 'orders')).toEqual([scripts.orders, scripts['order:quotes']]);
  });

  it('lets npm-run-all task globs span slashes, while colons separate task groups', () => {
    const scripts = {
      orders: 'run-s exchange/*',
      'exchange/quotes': 'node --test tests/quotes.test.mjs',
      'exchange/quotes/depth': 'node --test tests/depth.test.mjs',
    };
    expect(scriptsRunBy(scripts, 'orders')).toEqual([
      scripts.orders,
      scripts['exchange/quotes'],
      scripts['exchange/quotes/depth'],
    ]);
  });

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

describe('the test runner commands of a package.json script', () => {
  const named = (config: string | null, root: string | null = null) => ({ config, root, unreadable: false });

  it('reads the config each runner names, in either form, and none for a command that names none', () => {
    expect(runnerCommands('vitest run --config vitest.integration.config.ts', 'vitest')).toEqual([
      named('vitest.integration.config.ts'),
    ]);
    expect(runnerCommands('vitest -c=test/node/vitest.config.mjs --root .', 'vitest')).toEqual([
      named('test/node/vitest.config.mjs', '.'),
    ]);
    expect(runnerCommands('jest --ci --config=./test/jest-e2e.json', 'jest')).toEqual([named('./test/jest-e2e.json')]);
    expect(runnerCommands('playwright test -c e2e/playwright.config.mock.ts --project chromium', 'playwright')).toEqual(
      [named('e2e/playwright.config.mock.ts')],
    );
    expect(runnerCommands('cypress run -C cypress.orders.config.ts --project apps/web', 'cypress')).toEqual([
      named('cypress.orders.config.ts', 'apps/web'),
    ]);
    expect(runnerCommands('wdio run ./wdio.android.conf.ts --spec tests/orders.e2e.ts', 'webdriverio')).toEqual([
      named('./wdio.android.conf.ts'),
    ]);
    expect(runnerCommands('wdio wdio.ios.conf.ts', 'webdriverio')).toEqual([named('wdio.ios.conf.ts')]);
    expect(runnerCommands('vitest run --coverage', 'vitest')).toEqual([named(null)]);
    expect(runnerCommands('wdio run', 'webdriverio')).toEqual([named(null)]);
  });

  it('finds the runner past variables, cross-env, dotenv and the package managers that start it', () => {
    const scripts = [
      'TZ=UTC vitest run -c vitest.orders.config.ts',
      'cross-env NODE_ENV=test FEED=replay npx --yes vitest run -c vitest.orders.config.ts',
      'dotenv -e .env.test -- pnpm exec vitest -c vitest.orders.config.ts',
      'pnpm vitest -c vitest.orders.config.ts && yarn exec vitest -c vitest.orders.config.ts',
      'bunx vitest -c vitest.orders.config.ts; bun x vitest -c vitest.orders.config.ts',
      'npm exec -- vitest -c vitest.orders.config.ts',
      'node --max-old-space-size=4096 node_modules/.bin/vitest -c vitest.orders.config.ts',
      'node -r ./setup/clock.cjs ./node_modules/vitest/vitest.mjs -c vitest.orders.config.ts',
    ];
    for (const script of scripts) {
      expect(runnerCommands(script, 'vitest').map((command) => command.config)).toEqual(
        Array(script.split(/&&|;/).length).fill('vitest.orders.config.ts'),
      );
    }
    expect(
      runnerCommands('node --experimental-vm-modules node_modules/jest/bin/jest.js -c jest.config.orders.js', 'jest'),
    ).toEqual([named('jest.config.orders.js')]);
  });

  it('finds a runner node starts from a scoped package with Windows separators', () => {
    expect(
      runnerCommands('node node_modules\\@playwright\\test\\cli.js test -c e2e\\playwright.ci.config.ts', 'playwright'),
    ).toEqual([named('e2e\\playwright.ci.config.ts')]);
  });

  it('takes npm exec without --, and no command dotenv starts without --, as dotenv reads the options after it', () => {
    expect(runnerCommands('npm exec vitest -c vitest.orders.config.ts;', 'vitest')).toEqual([
      named('vitest.orders.config.ts'),
    ]);
    expect(runnerCommands('dotenv -e .env.test vitest -c vitest.orders.config.ts', 'vitest')).toEqual([]);
  });

  it('takes no command whose program is another tool, or a script of the same name', () => {
    expect(runnerCommands('node --version && node node_modules/tsx/dist/cli.mjs --test', 'vitest')).toEqual([]);
    expect(runnerCommands('eslint . --plugin jest -c .eslintrc.orders.json', 'jest')).toEqual([]);
    expect(runnerCommands('echo vitest -c vitest.config.ts && tsc -p tsconfig.test.json', 'vitest')).toEqual([]);
    expect(runnerCommands('pnpm run vitest -c vitest.config.ts && npm run jest', 'vitest')).toEqual([]);
    expect(runnerCommands('playwright install --with-deps chromium', 'playwright')).toEqual([]);
    expect(runnerCommands('cypress verify', 'cypress')).toEqual([]);
    expect(runnerCommands('node scripts/jest/jest-cli.js --config ./scripts/jest/config.source.js', 'jest')).toEqual(
      [],
    );
  });

  it('says so when the scan cannot read the config a command names', () => {
    const unreadable = (config: string | null, root: string | null = null) => ({ config, root, unreadable: true });
    expect(runnerCommands('vitest -c $VITEST_CONFIG', 'vitest')).toEqual([unreadable('$VITEST_CONFIG')]);
    expect(runnerCommands('vitest --root=${PACKAGE_DIR} run', 'vitest')).toEqual([unreadable(null, '${PACKAGE_DIR}')]);
    expect(runnerCommands('jest --config \'{"testMatch":["**/orders/*.check.ts"]}\'', 'jest')).toEqual([
      unreadable('{"testMatch":["**/orders/*.check.ts"]}'),
    ]);
    expect(runnerCommands('jest --config', 'jest')).toEqual([unreadable(null)]);
  });
});
