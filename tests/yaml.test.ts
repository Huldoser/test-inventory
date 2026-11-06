import { describe, expect, it } from 'vitest';
import { readYaml, YamlError } from '../src/yaml.ts';

describe('readYaml', () => {
  it('reads the keys of a .mocharc.yml: scalars, lists in lines or brackets, and comments', () => {
    const text = [
      '---',
      '# Mocha settings for the order service',
      'require: ts-node/register',
      "spec: 'test/**/*.spec.ts'",
      'extension:',
      '  - ts',
      '  - "js"',
      'ignore: [test/fixtures/**, test/legacy/**,]',
      'node-option: []',
      'timeout: 5000',
      'retries: 2',
      'slow: 1.5e3',
      'recursive: true',
      'parallel: False',
      'grep: ~',
      'fgrep: "fills # partially"',
      "reporter: 'spec' # the default",
      "invert: don't route # to the dark pool",
      'jobs: 1_000',
      'check-leaks: .5',
      'bail: 0o17',
      'delay: 0x1F',
      'ui:',
      '',
    ].join('\n');
    expect(readYaml(text)).toEqual({
      require: 'ts-node/register',
      spec: 'test/**/*.spec.ts',
      extension: ['ts', 'js'],
      ignore: ['test/fixtures/**', 'test/legacy/**'],
      'node-option': [],
      timeout: 5000,
      retries: 2,
      slow: 1500,
      recursive: true,
      parallel: false,
      grep: null,
      fgrep: 'fills # partially',
      reporter: 'spec',
      invert: "don't route",
      jobs: '1_000',
      'check-leaks': 0.5,
      bail: 15,
      delay: 31,
      ui: null,
    });
  });

  it('reads a list at the same indent as its key, a nested map, quoted keys and quotes in quotes', () => {
    const text = [
      'spec:',
      '- test/unit/**/*.spec.js',
      '- test/integration/**/*.spec.js',
      'reporter-option:',
      '  output: reports/orders.xml',
      '  "suiteName": orders',
      "fgrep: 'trader''s blotter'",
    ].join('\r\n');
    expect(readYaml(text)).toEqual({
      spec: ['test/unit/**/*.spec.js', 'test/integration/**/*.spec.js'],
      'reporter-option': { output: 'reports/orders.xml', suiteName: 'orders' },
      fgrep: "trader's blotter",
    });
  });

  it("reads what js-yaml, Mocha's reader, reads: a byte order mark, a directive, YAML escapes, commas in quotes", () => {
    const text = [
      '\uFEFF# Mocha settings for the order router',
      '%YAML 1.2',
      '---',
      'spec: [\'test/**/*.{ts,js}\', "test/fills/*.spec.js" , \'it\'\'s, quoted\', "say \\"hi\\", then fill",]',
      'grep: "say \\"fill\\" #slow"',
      "fgrep: 'it''s #slow'",
      'reporter: "\\x41PL\\tquotes\\u00e9\\ \\/\\U0001F4C8"',
      'invert: "AAPL\tquotes"',
      'ui: bdd',
      '...',
      '# the end of the settings',
    ].join('\n');
    expect(readYaml(text)).toEqual({
      spec: ['test/**/*.{ts,js}', 'test/fills/*.spec.js', "it's, quoted", 'say "hi", then fill'],
      grep: 'say "fill" #slow',
      fgrep: "it's #slow",
      reporter: 'APL\tquotes\u00e9 /\u{1F4C8}',
      invert: 'AAPL\tquotes',
      ui: 'bdd',
    });
  });

  it('reads a quote inside a plain value as part of it, so a # after a space still starts a comment', () => {
    expect(readYaml('grep: buy \'limit # the order type\nfgrep: sell"stop\n')).toEqual({
      grep: "buy 'limit",
      fgrep: 'sell"stop',
    });
  });

  it('reads a long line in time linear in its length', () => {
    const quotes = "'".repeat(200_000);
    const started = performance.now();
    expect(readYaml(`grep: a${quotes} # comment`)).toEqual({ grep: `a${quotes}` });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('reads an empty file as an empty config', () => {
    expect(readYaml('# nothing set yet\n')).toEqual({});
  });

  it('reads __proto__ as a plain key, so it sets no settings of the map', () => {
    const read = readYaml('__proto__:\n  spec: test/settlement/**\nreporter: dot\n') as Record<string, unknown>;
    expect(read.spec).toBeUndefined();
    expect(JSON.parse(JSON.stringify(read))).toEqual({
      ['__proto__']: { spec: 'test/settlement/**' },
      reporter: 'dot',
    });
  });

  it.each([
    ['spec: &unit test/unit', 1, '"&unit test/unit" uses YAML that is not read'],
    ['spec: |\n  test/unit', 1, '"|" uses YAML that is not read'],
    ['spec:\n  - spec: test/unit', 2, 'a list item that is a map or spans lines is not read'],
    ['spec:\n  -', 2, 'a list item that is a map or spans lines is not read'],
    ['spec: [test/unit', 1, 'a list in brackets must end on its line'],
    ['spec: "test/unit', 1, 'a quoted value must end on its line'],
    ['spec: "test\\qunit"', 1, '"test\\qunit" has an escape that is not read'],
    ['spec: "test\\x4"', 1, '"test\\x4" has an escape that is not read'],
    ['spec: "test/a\\"', 1, 'a quoted value must end on its line'],
    ['spec: "test/"a"', 1, 'a quoted value must end on its line'],
    ["spec: 'it's'", 1, 'a quoted value must end on its line'],
    ['spec:\n  -a.js', 2, '"-a.js" is not a key and its value'],
    ['spec: [[test/unit]]', 1, '"[test/unit]" uses YAML that is not read'],
    ['spec: ["test/unit\\]', 1, 'a quoted value must end on its line'],
    ['require: @babel/register', 1, '"@babel/register" uses YAML that is not read'],
    ['spec:\n  - - test/unit', 2, '"- test/unit" uses YAML that is not read'],
    ['spec: [test/unit,,test/e2e]', 1, 'a list in brackets has an empty item'],
    ['spec: test/unit\nspec: test/e2e', 2, 'spec is set twice, which YAML refuses'],
    ['grep: limit: buy', 1, '"limit: buy" has a colon and a space outside quotes, which YAML refuses'],
    ['spec:\n\t- test/unit', 2, 'the line is indented with a tab, which YAML refuses'],
    ['spec: test/unit\n---\nspec: test/e2e', 2, 'documents after the first are not read'],
    ['spec: test/unit\n...\nspec: test/e2e', 3, 'documents after the first are not read'],
    ['timeout 5000', 1, '"timeout 5000" is not a key and its value'],
    ['  spec: test/unit\ntimeout: 5000', 2, 'a line is indented less than the one it continues'],
  ])('refuses YAML it does not read: %s', (text, line, message) => {
    const error = (() => {
      try {
        readYaml(text);
      } catch (thrown) {
        return thrown;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(YamlError);
    expect([(error as YamlError).line, (error as YamlError).message]).toEqual([line, message]);
  });
});
