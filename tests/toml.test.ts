import { describe, expect, it } from 'vitest';
import { readToml } from '../src/toml.ts';

describe('the TOML reader', () => {
  it('refuses inline table entries without a comma', () => {
    expect(() => readToml('test = { retry = 2 timeout = 5000 }')).toThrow('Expected "," or "}"');
  });

  it('keeps quoted dotted keys and inline tables on their own lines', () => {
    expect(readToml("\t'quote desk'.timeout\t=\t5.25e+12\r\n[test]\r\nratio = 1.25e-12\r\n")).toEqual({
      'quote desk': { timeout: 5.25e12 },
      test: { ratio: 1.25e-12 },
    });
    expect(() => readToml("'quote desk'\n.timeout = 5")).toThrow('Expected "="');
    expect(() => readToml('test = {\n retry = 2 }')).toThrow('Expected a key');
    expect(() => readToml('test = { retry =\n2 }')).toThrow('Value');
    expect(() => readToml('venue = "closed\nopen"')).toThrow('The string is not closed');
    expect(readToml('venue = "line\\nreturn\\rslash\\\\"')).toEqual({ venue: 'line\nreturn\rslash\\' });
  });

  it('reads tables, dotted keys, strings, numbers, booleans, arrays and inline tables', () => {
    const text = [
      'name = "quote-gateway" # the service',
      "path = 'C:\\gateway'",
      'escaped = "tab\\there \\"quoted\\""',
      '[test]',
      'retry = 2',
      'timeout = 5_000',
      'ratio = -1.5e2',
      'limit = inf',
      'coverage = false',
      'preload = [',
      '  "./setup.ts", # first',
      "  './mocks.ts',",
      ']',
      'reporter.junit = "out.xml"',
      '"quoted key" = { a = 1, b.c = true }',
      '[install.cache]',
      'dir = "cache"',
    ].join('\n');
    expect(readToml(text)).toEqual({
      name: 'quote-gateway',
      path: 'C:\\gateway',
      escaped: 'tab\there "quoted"',
      test: {
        retry: 2,
        timeout: 5000,
        ratio: -150,
        limit: Infinity,
        coverage: false,
        preload: ['./setup.ts', './mocks.ts'],
        reporter: { junit: 'out.xml' },
        'quoted key': { a: 1, b: { c: true } },
      },
      install: { cache: { dir: 'cache' } },
    });
  });

  it('reads __proto__, constructor and toString as plain keys, and leaves Object.prototype alone', () => {
    const text = [
      '[__proto__]',
      'ignore = ["**"]',
      '[test]',
      '__proto__.root = "src"',
      'constructor = "MarketData"',
      'toString = { coverage = true, __proto__ = { preload = "./poison.ts" } }',
    ].join('\n');
    const read = readToml(text);
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(JSON.parse(JSON.stringify(read))).toEqual({
      ['__proto__']: { ignore: ['**'] },
      test: {
        ['__proto__']: { root: 'src' },
        constructor: 'MarketData',
        toString: { coverage: true, ['__proto__']: { preload: './poison.ts' } },
      },
    });
    expect(Object.hasOwn(read, '__proto__')).toBe(true);
  });

  it.each([
    ['[[test.mocks]]', 'Arrays of tables are not read', 1],
    ['[test]\nroot = "src', 'The string is not closed', 2],
    ['root = "\\x41"', 'Escape \\x is not read', 1],
    ['root = "src" extra', 'Unexpected "e"', 1],
    ['root = 1\n[root]', 'root is not a table', 2],
    ['when = 2026-11-05', 'Value 2026-11-05 is not read', 1],
    ['= 1', 'Expected a key', 1],
    ['[test\n', 'Expected "]"', 1],
    ['list = [1 2]', 'Expected "," or "]"', 1],
    ['limit = ,', 'Value , is not read', 1],
    ['limit = -inf', '', 0],
  ])('refuses %j', (text, message, line) => {
    if (message === '') {
      expect(readToml(text)).toEqual({ limit: -Infinity });
      return;
    }
    expect(() => readToml(text)).toThrow(expect.objectContaining({ message, line }));
  });
});
