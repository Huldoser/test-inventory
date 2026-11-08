import { describe, expect, it } from 'vitest';
import { scanSource, type Framework } from '../src/index.ts';

const runners: { framework: Framework; prefix: string; test: string; suite: string; skip: string }[] = [
  {
    framework: 'playwright',
    prefix: "import { test } from '@playwright/test';",
    test: 'test',
    suite: 'test.describe',
    skip: 'test.describe.skip',
  },
  {
    framework: 'vitest',
    prefix: "import { test, describe } from 'vitest';",
    test: 'test',
    suite: 'describe',
    skip: 'describe.skip',
  },
  {
    framework: 'jest',
    prefix: "import { test, describe } from '@jest/globals';",
    test: 'test',
    suite: 'describe',
    skip: 'describe.skip',
  },
  { framework: 'mocha', prefix: '', test: 'it', suite: 'describe', skip: 'describe.skip' },
  { framework: 'jasmine', prefix: '', test: 'it', suite: 'describe', skip: 'xdescribe' },
  { framework: 'cypress', prefix: '', test: 'it', suite: 'describe', skip: 'describe.skip' },
  { framework: 'webdriverio', prefix: '', test: 'it', suite: 'describe', skip: 'describe.skip' },
  {
    framework: 'node',
    prefix: "import { test, describe } from 'node:test';",
    test: 'test',
    suite: 'describe',
    skip: 'describe.skip',
  },
  {
    framework: 'bun',
    prefix: "import { test, describe } from 'bun:test';",
    test: 'test',
    suite: 'describe',
    skip: 'describe.skip',
  },
];

describe.each(runners)('$framework named describe callbacks', ({ framework, prefix, test, suite, skip }) => {
  it('registers a function declaration in the calling suite', () => {
    const result = scanSource({
      framework,
      relativeFilePath: 'tests/orders.test.ts',
      code: `${prefix}
function ordersBlock() { ${test}('quotes the bid', () => {}); }
${suite}('paper venue', ordersBlock);`,
    });
    expect(result.tests.map(({ fullName }) => fullName)).toEqual(['paper venue > quotes the bid']);
    expect(result.tests[0].isInFunction).toBe(false);
    expect(result.diagnostics).toEqual([]);
  });

  it('reuses an arrow callback under active and skipped suites without duplicating its deferred body', () => {
    const result = scanSource({
      framework,
      relativeFilePath: 'tests/orders.test.ts',
      code: `${prefix}
const ordersBlock = () => { ${test}('quotes the bid', () => {}); };
${suite}('paper venue', ordersBlock);
${skip}('live venue', ordersBlock);`,
    });
    expect(result.tests.map(({ fullName, state }) => [fullName, state])).toEqual([
      ['paper venue > quotes the bid', 'active'],
      ['live venue > quotes the bid', 'skip'],
    ]);
    expect(new Set(result.tests.map(({ id }) => id)).size).toBe(2);
    expect(result.diagnostics).toEqual([]);
  });

  it('resolves the callback closure where it was declared', () => {
    const result = scanSource({
      framework,
      relativeFilePath: 'tests/orders.test.ts',
      code: `${prefix}
const venue = 'paper';
function ordersBlock() { ${test}('quotes ' + venue, () => {}); }
${suite}('orders', () => { const venue = 'live'; ${suite}('venue', ordersBlock); });`,
    });
    expect(result.tests.map(({ fullName }) => fullName)).toEqual(['orders > venue > quotes paper']);
  });

  it('bounds recursive named callbacks and explains the missing nested tests', () => {
    const result = scanSource({
      framework,
      relativeFilePath: 'tests/orders.test.ts',
      code: `${prefix}
function ordersBlock() { ${test}('quotes the bid', () => {}); ${suite}('nested venue', ordersBlock); }
${suite}('orders', ordersBlock);`,
    });
    expect(result.diagnostics.some(({ code }) => code === 'internal-error')).toBe(false);
    expect(result.diagnostics.some(({ code }) => code === 'test-in-function')).toBe(true);
    expect(result.tests).toHaveLength(1);
  });

  it.each(['declaration', 'arrow'])('keeps sibling test bodies out of dependencies for a named %s', (form) => {
    const read = (price: number) =>
      scanSource({
        framework,
        relativeFilePath: 'tests/orders.test.ts',
        code: `${prefix}
${form === 'arrow' ? 'const ordersBlock = () =>' : 'function ordersBlock()'} {
  ${test}('quotes the bid', () => 100);
  ${test}('quotes the ask', () => ${price});
}; ${suite}('orders', ordersBlock);`,
      });
    const before = read(101);
    const after = read(102);
    expect(before.tests[0].dependencyHash).toBe(after.tests[0].dependencyHash);
    expect(before.tests[1].dependencyHash).not.toBe(after.tests[1].dependencyHash);
  });
});

it.each(runners.filter(({ framework }) => ['vitest', 'jest', 'bun'].includes(framework)))(
  'binds a named $framework describe table callback once per case',
  (source) => {
    const { framework } = source;
    const result = scanSource({
      framework,
      relativeFilePath: 'tests/orders.test.ts',
      expandCases: true,
      code: `${source.prefix}
function ordersBlock(venue) { ${source.test}('quotes ' + venue, () => {}); }
${source.suite}.each(['paper', 'live'])('venue %s', ordersBlock);`,
    });
    expect(result.tests.map(({ fullName }) => fullName)).toEqual([
      'venue paper > quotes paper',
      'venue live > quotes live',
    ]);
    expect(result.diagnostics).toEqual([]);
  },
);

it.each(runners.filter(({ framework }) => ['playwright', 'jest', 'jasmine'].includes(framework)))(
  'checks a named async $framework callback like an inline callback',
  (source) => {
    const { framework } = source;
    const body = `${source.test}('quotes the bid', () => {}); await Promise.resolve();`;
    const named = scanSource({
      framework,
      relativeFilePath: 'tests/orders.test.ts',
      code: `${source.prefix} async function ordersBlock(){${body}} ${source.suite}('orders',ordersBlock);`,
    });
    const inline = scanSource({
      framework,
      relativeFilePath: 'tests/orders.test.ts',
      code: `${source.prefix} ${source.suite}('orders',async()=>{${body}});`,
    });
    expect(named.diagnostics.map(({ code }) => code)).toEqual(inline.diagnostics.map(({ code }) => code));
    expect(named.tests.map(({ state }) => state)).toEqual(inline.tests.map(({ state }) => state));
  },
);

it('reads an anonymous Playwright describe passed a named callback', () => {
  const result = scanSource({
    framework: 'playwright',
    relativeFilePath: 'tests/orders.spec.ts',
    code: `import { test } from '@playwright/test';
function ordersBlock() { test('quotes the bid', () => {}); } test.describe(ordersBlock);`,
  });
  expect(result.tests.map(({ fullName }) => fullName)).toEqual(['quotes the bid']);
  expect(result.diagnostics).toEqual([]);
});

it('applies the helper-call limit to repeated named callbacks', () => {
  const calls = Array.from({ length: 10_001 }, (_, index) => `describe('venue ${index}', ordersBlock);`).join('\n');
  const result = scanSource({
    framework: 'vitest',
    relativeFilePath: 'tests/orders.test.ts',
    code: `import { test, describe } from 'vitest';
function ordersBlock() { test('quotes the bid', () => {}); }
${calls}`,
  });
  expect(result.tests).toHaveLength(10_000);
  expect(result.diagnostics.filter(({ code }) => code === 'test-in-function')).toHaveLength(1);
  expect(result.diagnostics.some(({ code }) => code === 'internal-error')).toBe(false);
}, 20_000);
