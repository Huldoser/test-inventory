import type { OxcError } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { firstError, parseFile, tooDeeplyNested } from '../src/parse.ts';

describe('parseFile', () => {
  it.each([
    ['chart.spec.tsx', 'test("renders", () => { mount(<Chart symbol="AAPL" />); });'],
    ['chart.spec.js', 'test("renders", () => { mount(<Chart />); });'],
    ['chart.spec.jsx', 'test("renders", () => { mount(<Chart />); });'],
    ['quotes.spec.mts', 'const symbol: string = "AAPL";'],
    ['quotes.spec.cts', 'const symbol: string = "AAPL";'],
    ['quotes.spec.mjs', 'import { test } from "@playwright/test";'],
    ['quotes.spec.cjs', 'const { test } = require("@playwright/test");\nreturn;'],
    ['quotes.spec', 'const symbol: string = "AAPL";'],
  ])('parses %s by its extension', (fileName, code) => {
    expect(parseFile(fileName, code).error).toBeNull();
  });

  it('treats .ts as TypeScript without JSX, so type assertions with angle brackets work', () => {
    expect(parseFile('orders.test.ts', 'const price = <number>input;').error).toBeNull();
  });

  it('drops a byte order mark, so columns match editors', () => {
    const parsed = parseFile('orders.spec.ts', '﻿test("fills", () => {});');
    expect(parsed.program.body[0].start).toBe(0);
    expect(parsed.source.text.startsWith('test')).toBe(true);
  });

  it('returns the first error with its location', () => {
    const parsed = parseFile('orders.spec.ts', 'test("fills", () => {\n  const = 1;\n});');
    expect(parsed.error).toMatchObject({ message: 'Unexpected token' });
    expect(parsed.source.position(parsed.error?.start ?? 0).line).toBe(2);
  });

  it('parses brackets nested 500 deep', () => {
    const parsed = parseFile('order-book.spec.ts', `const depth = ${'['.repeat(500)}101.5${']'.repeat(500)};`);
    expect(parsed.error).toBeNull();
  });

  it('refuses brackets nested more than 500 deep instead of letting the parser overflow its stack', () => {
    const parsed = parseFile('order-book.spec.ts', `const depth = ${'['.repeat(501)}101.5${']'.repeat(501)};`);
    expect(parsed.error).toEqual({
      message: 'Brackets are nested more than 500 deep, too deep to parse safely',
      start: 514,
      end: 515,
    });
    expect(parsed.program.body).toEqual([]);
    expect(parsed.comments).toEqual([]);
  });
});

describe('tooDeeplyNested', () => {
  it('gives the offset of the first bracket nested deeper than the limit', () => {
    expect(tooDeeplyNested('placeOrder({ legs: [1] });', 3)).toBeNull();
    expect(tooDeeplyNested('placeOrder({ legs: [[1]] });', 3)).toBe(20);
  });

  it('counts parentheses, brackets, braces and template substitutions alike', () => {
    expect(tooDeeplyNested('log(`filled ${fills.map((fill) => fill.price)}`);', 3)).toBe(24);
    expect(tooDeeplyNested('log(`${`${symbol}`}`);', 2)).toBe(8);
    expect(tooDeeplyNested('log(`${`${symbol}`}`);', 3)).toBeNull();
  });

  it('ignores brackets in strings, comments and template text', () => {
    const code = [
      "const note = 'it\\'s [[[ (';",
      'const label = "(((";',
      "const open = '[[[",
      '// ((((',
      '/* [[[[ */',
      'const line = `[[[ \\${ ((( `;',
      '/* {{{{',
    ].join('\n');
    expect(tooDeeplyNested(code, 1)).toBeNull();
    expect(tooDeeplyNested('const draft = `[[[ (((', 1)).toBeNull();
    expect(tooDeeplyNested('submit(order); // fill (((', 1)).toBeNull();
  });

  it('ignores brackets in regular expressions, but reads on after a division', () => {
    expect(tooDeeplyNested('const ticker = /^[(/A-Z]{1,5}\\(/;', 1)).toBeNull();
    expect(tooDeeplyNested('if (side) return /[[(]/.test(symbol);', 1)).toBeNull();
    expect(tooDeeplyNested('const open = /((\n[[x]]', 1)).toBe(18);
    expect(tooDeeplyNested('const mid = total / count + ((fee));', 1)).toBe(29);
    expect(tooDeeplyNested('const mid = (ask + bid) / 2 + ((fee));', 1)).toBe(31);
  });

  it('closes up to the matching bracket, so stray or unclosed brackets do not add up', () => {
    expect(tooDeeplyNested('submit() ) ] } submit()', 1)).toBeNull();
    expect(tooDeeplyNested('{ total(fills[0 } { total(fills[0 } { (', 3)).toBeNull();
  });
});

describe('firstError', () => {
  it('is null without errors and falls back to the file start without labels', () => {
    expect(firstError([])).toBeNull();
    const error = {
      severity: 'Error',
      message: 'Broken',
      labels: [],
      helpMessage: null,
      codeframe: null,
    } as unknown as OxcError;
    expect(firstError([error])).toEqual({
      message: 'Broken',
      start: 0,
      end: 0,
    });
  });
});
