import { describe, expect, it } from 'vitest';
import { scan, type Inventory } from '../src/index.ts';
import { testNamed } from './helpers.ts';
import { project, VITEST_PACKAGE } from './project.ts';

async function scanned(config: string, files: Record<string, string>, version?: string): Promise<Inventory> {
  const manifest = version ? JSON.stringify({ devDependencies: { vitest: version } }) : VITEST_PACKAGE;
  return scan({
    root: project({ 'package.json': manifest, 'vitest.config.ts': config, ...files }),
    patterns: ['tests/*.test.ts'],
    framework: 'vitest',
  });
}

// Vitest reads the comment anywhere in a file's text, also in a string, so it is put together.
const MODULE_TAG = ['@module', 'tag'].join('-');

const codes = (inventory: Inventory) => inventory.diagnostics.map((diagnostic) => diagnostic.code);

const BROKER = [
  "import { describe, test } from 'vitest';",
  "describe('broker', () => {",
  "  test('reconnects after a dropped session', { tags: ['flaky'] }, () => {});",
  "  test('rejects an expired token', { tags: ['slow-db'] }, () => {});",
  "  test('sends a heartbeat', () => {});",
  '});',
  '',
].join('\n');

describe('Vitest tags the config defines', () => {
  it('sets the state of the tests that carry a tag, from the config, without a warning', async () => {
    const inventory = await scanned(
      [
        'export default {',
        '  test: {',
        '    tags: [',
        "      { name: 'flaky', description: 'Fails now and then on the demo feed', skip: true },",
        "      { name: 'slow-db', todo: true },",
        '    ],',
        '  },',
        '};',
        '',
      ].join('\n'),
      { 'tests/broker.test.ts': BROKER },
    );
    expect(inventory.tests.map((test) => [test.title, test.state, test.stateSource, test.stateLine])).toEqual([
      ['reconnects after a dropped session', 'skip', 'config', null],
      ['rejects an expired token', 'todo', 'config', null],
      ['sends a heartbeat', 'active', null, null],
    ]);
    expect(codes(inventory)).toEqual([]);
  });

  it('takes run settings, the mode, only and meta from tags, the lowest priority number winning', async () => {
    const inventory = await scanned(
      [
        'export default {',
        '  test: {',
        '    sequence: { concurrent: true },',
        '    tags: [',
        "      { name: 'flaky', retry: 2, timeout: 20_000, meta: { owner: 'market-data' } },",
        "      { name: 'slow-db', timeout: 60_000, repeats: 1, concurrent: true, priority: 1, meta: { db: 'postgres' } },",
        "      { name: 'paper', timeout: 30_000, priority: 2 },",
        "      { name: 'focus', only: true, fails: true, concurrent: false },",
        '    ],',
        '  },',
        '};',
        '',
      ].join('\n'),
      {
        'tests/broker.test.ts': [
          "import { test } from 'vitest';",
          "test('reconnects after a dropped session', { tags: ['paper', 'flaky', 'slow-db'], meta: { owner: 'trading' } }, () => {});",
          "test('rejects an expired token', { tags: ['focus'] }, () => {});",
          '',
        ].join('\n'),
      },
    );
    expect(testNamed(inventory, 'reconnects after a dropped session')).toMatchObject({
      timeout: 60_000,
      timeoutSource: 'config',
      retries: 2,
      retriesSource: 'config',
      repeats: 1,
      repeatsSource: 'config',
      isParallel: true,
      meta: { owner: 'trading', db: 'postgres' },
    });
    expect(testNamed(inventory, 'rejects an expired token')).toMatchObject({
      isOnly: true,
      isParallel: false,
      state: 'expectedToFail',
      stateSource: 'config',
    });
  });

  it("lets a test's own options beat its tags, and the describe's beat them only before Vitest 5", async () => {
    const config = "export default { test: { tags: [{ name: 'slow-db', timeout: 60_000 }] } };\n";
    const files = {
      'tests/broker.test.ts': [
        "import { describe, test } from 'vitest';",
        "describe('broker', { timeout: 5_000 }, () => {",
        "  test('rejects an expired token', { tags: ['slow-db'] }, () => {});",
        "  test('sends a heartbeat', { tags: ['slow-db'], timeout: 1_000 }, () => {});",
        '});',
        '',
      ].join('\n'),
    };
    const timeouts = (inventory: Inventory) =>
      inventory.tests.map((test) => [test.title, test.timeout, test.timeoutSource]);
    expect(timeouts(await scanned(config, files))).toEqual([
      ['rejects an expired token', 60_000, 'config'],
      ['sends a heartbeat', 1_000, 'test'],
    ]);
    expect(timeouts(await scanned(config, files, '4.1.12'))).toEqual([
      ['rejects an expired token', 5_000, 'suite'],
      ['sends a heartbeat', 1_000, 'test'],
    ]);
  });

  it('fails the file at the first use of a tag the config does not define, unless strictTags is off', async () => {
    const files = {
      'tests/broker.test.ts': [
        `// ${MODULE_TAG} broker`,
        "import { describe, test } from 'vitest';",
        "describe('session', { tags: ['flaky'] }, () => {",
        "  test('reconnects after a dropped session', { tags: ['flaky', 'slow-db'] }, () => {});",
        '});',
        '',
      ].join('\n'),
    };
    const strict = await scanned("export default { test: { tags: [{ name: 'broker' }] } };\n", files);
    expect(strict.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.level, diagnostic.lineStart])).toEqual([
      ['undefined-tag', 'error', 3],
      ['undefined-tag', 'error', 4],
    ]);
    expect(strict.diagnostics[0].message).toBe(
      'The Vitest config doesn\'t define the tag "flaky", so with strictTags Vitest fails the file while it loads, and none of its tests run.',
    );
    expect(strict.tests[0]).toMatchObject({ state: 'notLoaded', stateSource: 'file', stateLine: 3 });
    const bare = await scanned('export default { test: {} };\n', files);
    expect(bare.diagnostics.map((diagnostic) => [diagnostic.lineStart, diagnostic.message.split(',')[0]])).toEqual([
      [1, 'The Vitest config doesn\'t define the tag "broker"'],
      [3, 'The Vitest config doesn\'t define the tag "flaky"'],
      [4, 'The Vitest config doesn\'t define the tag "slow-db"'],
    ]);
    const loose = await scanned('export default { test: { strictTags: false } };\n', files);
    expect(codes(loose)).toEqual([]);
    expect(loose.tests[0].state).toBe('active');
  });

  it("keeps the warning when the scan can't work out the tags, or the projects define different ones", async () => {
    const files = { 'tests/broker.test.ts': BROKER };
    const unknown = [
      "import { brokerTags } from './tags.config';",
      'export default { test: { tags: brokerTags } };',
      '',
    ].join('\n');
    const configs = [
      unknown,
      "export default { test: { strictTags: process.env.CI === 'true' } };\n",
      "export default { test: { tags: [{ name: 'flaky', skip: !!process.env.CI }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: [{ name: 'flaky', retry: { count: 2, condition: (error) => error.message.includes('ECONNRESET') } }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: [{ name: 'flaky', timeout: process.env.CI ? 60_000 : 20_000 }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: [{ name: 'flaky', meta: { owner: process.env.OWNER } }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: [{ name: 'flaky', meta: 'market-data' }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: [{ name: 'flaky', meta: { feeds: ['demo', process.env.FEED] } }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: [{ name: 'flaky', retry: Number(process.env.RETRIES) }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: ['flaky', 'slow-db'] } };\n",
      [
        "import { sharedTag } from '@trading/test-config';",
        "export default { test: { tags: [{ ...sharedTag, name: 'flaky' }, { name: 'slow-db' }] } };",
        '',
      ].join('\n'),
      "export default { test: { tags: [{ name: 'flaky', priority: Number(process.env.PRIORITY) }, { name: 'slow-db' }] } };\n",
      "export default { test: { tags: [{ name: process.env.TAG }, { name: 'slow-db' }] } };\n",
      'export default { test: { tags: [...process.env.TAGS] } };\n',
      'export default { test: { tags: process.env.TAGS } };\n',
      [
        'export default {',
        '  test: {',
        '    projects: [',
        "      { test: { name: 'unit', tags: [{ name: 'flaky' }, { name: 'slow-db' }] } },",
        "      { test: { name: 'integration', tags: [{ name: 'flaky', skip: true }, { name: 'slow-db' }] } },",
        '    ],',
        '  },',
        '};',
        '',
      ].join('\n'),
    ];
    for (const config of configs) {
      const inventory = await scanned(config, files);
      expect(
        codes(inventory).filter((code) => code !== 'config-value-unknown' && code !== 'dependency-not-followed'),
        config,
      ).toEqual(['config-may-change-state']);
      expect(inventory.tests[0].state, config).toBe('active');
    }
  });

  it('reads tag meta with lists and nested objects, and tags shared by the projects', async () => {
    const inventory = await scanned(
      [
        "const tags = [{ name: 'flaky', meta: { feeds: ['demo', 'paper'], limits: { retries: 3 } } }, { name: 'slow-db' }];",
        'export default {',
        "  test: { tags, projects: [{ extends: true, test: { name: 'unit' } }, { extends: true, test: { name: 'e2e' } }] },",
        '};',
        '',
      ].join('\n'),
      { 'tests/broker.test.ts': BROKER },
    );
    expect(testNamed(inventory, 'reconnects after a dropped session').meta).toEqual({
      feeds: ['demo', 'paper'],
      limits: { retries: 3 },
    });
    expect(codes(inventory)).toEqual([]);
  });
});

describe('Vitest tags, merged with the options as Vitest merges them', () => {
  const TAGS = [
    'export default {',
    '  test: {',
    '    tags: [',
    "      { name: 'focus', only: true },",
    "      { name: 'flaky', skip: true },",
    "      { name: 'wip', todo: true },",
    '    ],',
    '  },',
    '};',
    '',
  ].join('\n');
  const states = (inventory: Inventory) =>
    inventory.tests.map((test) => [test.title, test.state, test.isOnly, test.stateSource]);

  it.each([
    { version: '4.1.12', expected: ['active', 'active', 'skip', 'skip'] },
    { version: '5.1.1', expected: ['skip', 'todo', 'todo', 'todo'] },
  ])('merges false tag and suite options before deriving test states in $version', async ({ version, expected }) => {
    const inventory = await scanned(
      "export default {test:{tags:[{name:'blocked',skip:true},{name:'review',todo:true},{name:'ready',skip:false}]}};",
      {
        'tests/orders.test.ts': `import {describe,test} from 'vitest';
        describe('cash desk',{skip:false},()=>{test('prices a bond',{tags:['blocked']},()=>{});});
        describe('energy desk',{todo:false},()=>{test('delivers gas',{tags:['review']},()=>{});});
        describe('rates desk',{skip:true},()=>{test('settles a swap',{tags:['ready'],todo:true},()=>{});});
        describe('margin desk',{todo:true},()=>{describe('borrows',{skip:true},()=>{test('locates shares',{tags:['ready']},()=>{});});});`,
      },
      version,
    );
    expect(inventory.tests.map((test) => test.state)).toEqual(expected);
  });

  it.each([
    { version: '4.1.12', fromSuite: 'active', fromTag: 'todo', tagFocus: false },
    { version: '5.1.1', fromSuite: 'skip', fromTag: 'active', tagFocus: true },
  ])(
    'resolves focus from tags and inherited options in Vitest $version',
    async ({ version, fromSuite, fromTag, tagFocus }) => {
      const inventory = await scanned(
        "export default {test:{allowOnly:true,tags:[{name:'regular',only:false},{name:'focus',only:true}]}};",
        {
          'tests/orders.test.ts': `import {describe,test} from 'vitest';
        describe('opening auction',{only:true},()=>{
          test.skip('clears the opening order',{tags:['regular']},()=>{});
        });
        describe('opening prices',{only:true},()=>{
          test.only.skip('posts the opening price',{tags:['regular']},()=>{});
        });
        describe('closing auction',{only:false},()=>{
          test.todo('clears the closing order',{tags:['focus']},()=>{});
          test('posts the closing price',{tags:['focus']},()=>{});
        });`,
        },
        version,
      );
      expect(inventory.tests.map((test) => [test.state, test.isOnly])).toEqual([
        [fromSuite, true],
        ['active', true],
        [fromTag, tagFocus],
        ['active', tagFocus],
      ]);
    },
  );

  it('picks only over skip over todo from all of them, as one declaration does', async () => {
    const inventory = await scanned(TAGS, {
      'tests/orders.test.ts': [
        "import { test } from 'vitest';",
        "test.skip('places a market order', { tags: ['focus'] }, () => {});",
        "test.only('places a limit order', { tags: ['flaky'] }, () => {});",
        "test('cancels an order', { tags: ['focus', 'flaky'] }, () => {});",
        "test('amends an order', { tags: ['flaky'], todo: true }, () => {});",
        '',
      ].join('\n'),
    });
    expect(states(inventory)).toEqual([
      ['places a market order', 'active', true, null],
      ['places a limit order', 'active', true, null],
      ['cancels an order', 'active', true, null],
      ['amends an order', 'skip', false, 'config'],
    ]);
    expect(inventory.diagnostics.map((d) => [d.code, d.level, d.lineStart])).toEqual([
      ['forbidden-only', 'warning', 2],
      ['forbidden-only', 'warning', 3],
      ['forbidden-only', 'warning', 4],
    ]);
  });

  it.each([
    ['3.2.7', false, true, false],
    ['4.1.12', false, true, false],
    ['5.1.1', true, false, true],
  ] as const)(
    'resolves suite, tag and test expected-failure options in Vitest %s',
    async (version, chain, clearedTag, enabledTag) => {
      const inventory = await scanned(
        "export default {test:{tags:[{name:'known',fails:true},{name:'settled',fails:false}]}};",
        {
          'tests/clearing.test.ts': `import {describe,test} from 'vitest';
        describe('late settlement',{fails:true},()=>{
          test('posts a settled trade',{fails:false},()=>{});
          describe('fixed feed',{fails:false},()=>{test('records the fill',()=>{});});
          test('keeps the expected rejection',()=>{});
          test('honors the settled tag',{tags:['settled']},()=>{});
        });
        describe('verified trades',{fails:false},()=>{
          test.fails('rejects an uncovered order',()=>{});
          test('honors the known tag',{tags:['known']},()=>{});
        });`,
        },
        version,
      );
      expect(inventory.tests.map((test) => test.isExpectedToFail)).toEqual([
        false,
        false,
        true,
        clearedTag,
        chain,
        enabledTag,
      ]);
    },
  );

  it('narrows a focused suite to the test selected by a later tag', async () => {
    const inventory = await scanned("export default {test:{allowOnly:true,tags:[{name:'closing',only:true}]}};", {
      'tests/orders.test.ts': `import {describe,test} from 'vitest';
        describe.only('closing auction',()=>{
          test('publishes the depth',()=>{});
          describe('matched orders',()=>{
            test('reports the imbalance',()=>{});
            test('settles the cross',{tags:['closing']},()=>{});
          });
        });`,
    });
    expect(inventory.tests.map((t) => [t.title, t.isOnly])).toEqual([
      ['publishes the depth', false],
      ['reports the imbalance', false],
      ['settles the cross', true],
    ]);
  });

  it('reports forbidden focus at collection before a test or hook can skip', async () => {
    const inventory = await scanned("export default {test:{allowOnly:false,tags:[{name:'auction',only:true}]}};", {
      'tests/orders.test.ts': [
        "import {describe,test,beforeEach} from 'vitest';",
        "test.only('clears a limit order', ctx => ctx.skip());",
        "describe.only('opening auction', () => {",
        '  beforeEach(ctx => ctx.skip());',
        "  test('posts the opening price', {tags:['auction']}, () => {});",
        '});',
        "describe.skip('closed exchange', () => {",
        "  test('cancels the closing order', {tags:['auction']}, ctx => ctx.skip());",
        '});',
      ].join('\n'),
    });
    expect(inventory.diagnostics.filter((d) => d.code === 'forbidden-only').map((d) => [d.lineStart, d.level])).toEqual(
      [
        [2, 'error'],
        [3, 'error'],
        [5, 'error'],
      ],
    );
  });

  it("lets skipIf and runIf replace a tag's skip from Vitest 5, and an option set to undefined leave it", async () => {
    const files = {
      'tests/orders.test.ts': [
        "import { test } from 'vitest';",
        "test.skipIf(false)('settles a trade', { tags: ['flaky'] }, () => {});",
        "test.runIf(process.env.FEED === 'live')('nets positions', { tags: ['flaky'] }, () => {});",
        "test('cancels an order', { tags: ['flaky'], skip: undefined }, () => {});",
        '',
      ].join('\n'),
    };
    expect(states(await scanned(TAGS, files, '5.0.5'))).toEqual([
      ['settles a trade', 'active', false, null],
      ['nets positions', 'skip', false, 'test'],
      ['cancels an order', 'skip', false, 'config'],
    ]);
    expect(states(await scanned(TAGS, files, '4.1.12'))).toEqual([
      ['settles a trade', 'skip', false, 'config'],
      ['nets positions', 'skip', false, 'config'],
      ['cancels an order', 'active', false, null],
    ]);
  });

  it("lets a test's own option set to false undo its tag's, in Vitest 4.1 and 5", async () => {
    const config = TAGS.replace(
      "      { name: 'wip'",
      "      { name: 'known-bug', fails: true },\n      { name: 'wip'",
    );
    const files = {
      'tests/orders.test.ts': [
        "import { test } from 'vitest';",
        "test('settles a trade', { tags: ['flaky'], skip: false }, () => {});",
        "test('nets positions', { tags: ['wip'], todo: false }, () => {});",
        "test('rejects a short sale', { tags: ['known-bug'], fails: false }, () => {});",
        "test('amends an order', { tags: ['focus'], only: false }, () => {});",
        "test('reprices an order', { tags: ['flaky'], skip: process.env.FEED === 'delayed' }, () => {});",
        "test('cancels an order', { tags: ['flaky'] }, () => {});",
        '',
      ].join('\n'),
    };
    const expected = [
      ['settles a trade', 'active', false, null],
      ['nets positions', 'active', false, null],
      ['rejects a short sale', 'active', false, null],
      ['amends an order', 'active', false, null],
      ['reprices an order', 'skip', false, 'test'],
      ['cancels an order', 'skip', false, 'config'],
    ];
    for (const version of ['5.0.5', '4.1.12']) {
      const inventory = await scanned(config, files, version);
      expect(states(inventory)).toEqual(expected);
      expect(testNamed(inventory, 'reprices an order').condition).toBe("process.env.FEED === 'delayed'");
    }
  });

  it("leaves a describe's chain mode to the tests a tag gives no state, in Vitest 4.1 and 5", async () => {
    const files = {
      'tests/orders.test.ts': [
        "import { describe, test } from 'vitest';",
        "describe.skip('amendments', () => {",
        "  test('amends the quantity', { tags: ['wip'] }, () => {});",
        '});',
        "describe.todo('cancellations', () => {",
        "  test('cancels a partial fill', { tags: ['flaky'] }, () => {});",
        '});',
        "describe('fills', { skip: true }, () => {",
        "  test('fills at the limit price', { tags: ['wip'] }, () => {});",
        '});',
        '',
      ].join('\n'),
    };
    const expected = [
      ['amends the quantity', 'todo', false, 'config'],
      ['cancels a partial fill', 'skip', false, 'config'],
      ['fills at the limit price', 'skip', false, 'suite'],
    ];
    expect(states(await scanned(TAGS, files))).toEqual(expected);
    expect(states(await scanned(TAGS, files, '4.1.12'))).toEqual(expected);
  });

  it("gives Vitest 4.1's sequence.concurrent in the config the lead over a tag's concurrent", async () => {
    const config = (concurrent: boolean, tag: boolean) =>
      `export default { test: { sequence: { concurrent: ${concurrent} }, tags: [{ name: 'feed', concurrent: ${tag} }] } };\n`;
    const files = {
      'tests/feed.test.ts': "import { test } from 'vitest';\ntest('streams quotes', { tags: ['feed'] }, () => {});\n",
    };
    const parallel = async (concurrent: boolean, tag: boolean, version?: string) =>
      (await scanned(config(concurrent, tag), files, version)).tests[0].isParallel;
    expect(await parallel(true, false, '4.1.12')).toBe(true);
    expect(await parallel(false, true, '4.1.12')).toBe(false);
    expect(await parallel(true, false)).toBe(false);
    expect(await parallel(false, true)).toBe(true);
  });

  it("takes a Vitest 5 project's own tags in place of the root config's", async () => {
    const config = (projectTags: string) =>
      [
        'export default {',
        '  test: {',
        "    tags: [{ name: 'flaky', skip: true }],",
        `    projects: [{ extends: true, test: { name: 'unit', tags: ${projectTags} } }],`,
        '  },',
        '};',
        '',
      ].join('\n');
    const files = { 'tests/broker.test.ts': BROKER };
    const replaced = await scanned(config("[{ name: 'flaky' }, { name: 'slow-db' }]"), files);
    expect(replaced.tests[0]).toMatchObject({ state: 'active', stateSource: null });
    const missing = await scanned(config("[{ name: 'slow-db' }]"), files);
    expect(codes(missing)).toEqual(['undefined-tag']);
  });

  it('warns, without failing the file, about an undefined tag in code that may not run while it loads', async () => {
    const inventory = await scanned("export default { test: { tags: [{ name: 'flaky' }] } };\n", {
      'tests/broker.test.ts': [
        "import { describe, test } from 'vitest';",
        'if (process.env.DATABASE_URL) {',
        "  test('stores the session', { tags: ['db'] }, () => {});",
        '}',
        'export function sessionTests() {',
        "  describe('session', { tags: ['session'] }, () => {});",
        '}',
        "test('sends a heartbeat', { tags: ['flaky'] }, () => {});",
        '',
      ].join('\n'),
    });
    expect(inventory.diagnostics.filter((diagnostic) => diagnostic.code === 'undefined-tag')).toMatchObject([
      { level: 'warning', lineStart: 3 },
      { level: 'warning', lineStart: 6 },
    ]);
    expect(testNamed(inventory, 'sends a heartbeat').state).toBe('active');
  });

  it('reports a tag used under a condition and then for sure as an error where it surely runs', async () => {
    const inventory = await scanned("export default { test: { tags: [{ name: 'flaky' }] } };\n", {
      'tests/broker.test.ts': [
        "import { test } from 'vitest';",
        'if (process.env.DATABASE_URL) {',
        "  test('stores the session', { tags: ['db', 'session'] }, () => {});",
        '}',
        "test('restores the session', { tags: ['db'] }, () => {});",
        '',
      ].join('\n'),
    });
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.level, diagnostic.lineStart])).toEqual([
      ['warning', 3],
      ['error', 5],
    ]);
    expect(inventory.diagnostics[1].message).toContain('"db"');
    expect(testNamed(inventory, 'restores the session')).toMatchObject({ state: 'notLoaded', stateLine: 5 });
  });

  it("fails the file at the first tag Vitest meets: the file's, then the describes', then the tests'", async () => {
    const inventory = await scanned("export default { test: { tags: [{ name: 'flaky' }] } };\n", {
      'tests/broker.test.ts': [
        "import { describe, test } from 'vitest';",
        "describe('session', () => {",
        "  test('reconnects after a dropped session', { tags: ['db'] }, () => {});",
        '});',
        "describe('heartbeat', { tags: ['feed'] }, () => {",
        "  test('sends a heartbeat', () => {});",
        '});',
        '',
      ].join('\n'),
    });
    expect(inventory.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.lineStart])).toEqual([
      ['undefined-tag', 3],
      ['undefined-tag', 5],
    ]);
    expect(inventory.tests[0]).toMatchObject({ state: 'notLoaded', stateLine: 5 });
  });

  it('fails a file that uses a tag when no config defines any, as Vitest does without a config', async () => {
    const inventory = await scan({
      root: project({ 'package.json': VITEST_PACKAGE, 'tests/broker.test.ts': BROKER }),
      patterns: ['tests/*.test.ts'],
      framework: 'vitest',
    });
    expect(codes(inventory)).toEqual(['undefined-tag', 'undefined-tag']);
    expect(inventory.tests[0].state).toBe('notLoaded');
  });

  it("keeps the warning when a test's tag can't be worked out, as it may be one the config defines", async () => {
    const inventory = await scanned("export default { test: { tags: [{ name: 'flaky', skip: true }] } };\n", {
      'tests/broker.test.ts': [
        "import { test } from 'vitest';",
        "import { BROKER_TAG } from './tags';",
        "test('reconnects after a dropped session', { tags: [BROKER_TAG] }, () => {});",
        '',
      ].join('\n'),
    });
    expect(codes(inventory)).toEqual(['config-may-change-state', 'unresolved-tag', 'dependency-not-followed']);
  });
});
