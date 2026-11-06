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
