import type { OxcError } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { firstError, parseFile } from '../src/parse.ts';

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
