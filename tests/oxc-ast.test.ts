import { parseSync, visitorKeys, type ExpressionStatement, type Node } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

/**
 * The scanner relies on these shapes of oxc-parser's AST. If an upgrade changes one, this file says which, before
 * the change shows up as wrong records.
 */
function expression(code: string, fileName = 'shape.ts'): Node {
  const result = parseSync(fileName, code, { preserveParens: false });
  expect(result.errors).toEqual([]);
  return (result.program.body[0] as ExpressionStatement).expression;
}

describe('oxc-parser AST shapes', () => {
  it('counts offsets in UTF-16 code units', () => {
    const code = "'📈 AAPL'; test('fills', () => {});";
    const result = parseSync('shape.ts', code);
    expect(result.program.body[1].start).toBe(code.indexOf('test'));
  });

  it('drops parentheses with preserveParens: false', () => {
    expect(expression('(test.skip)("fills", () => {});')).toMatchObject({
      type: 'CallExpression',
      callee: { type: 'MemberExpression', object: { name: 'test' } },
    });
  });

  it.each([
    ['test!.only();', 'TSNonNullExpression'],
    ['(test as any).only();', 'TSAsExpression'],
    ['(test satisfies object).only();', 'TSSatisfiesExpression'],
    ['(<any>test).only();', 'TSTypeAssertion'],
  ])('wraps %s in %s', (code, type) => {
    expect(expression(code)).toMatchObject({ callee: { object: { type, expression: { name: 'test' } } } });
  });

  it('wraps optional calls in a ChainExpression', () => {
    expect(expression('test?.skip("fills", () => {});')).toMatchObject({
      type: 'ChainExpression',
      expression: { type: 'CallExpression', optional: false, callee: { optional: true } },
    });
  });

  it('marks computed members and keeps string keys as literals', () => {
    expect(expression("test['skip'];")).toMatchObject({ computed: true, property: { type: 'Literal', value: 'skip' } });
    expect(expression('test.skip;')).toMatchObject({ computed: false, property: { type: 'Identifier', name: 'skip' } });
  });

  it('gives literals the fields that tell them apart', () => {
    expect(expression('/AAPL/g;')).toMatchObject({ type: 'Literal', regex: { pattern: 'AAPL', flags: 'g' } });
    expect(expression('10n;')).toMatchObject({ type: 'Literal', bigint: '10' });
    expect(expression('`a${b}c`;')).toMatchObject({
      type: 'TemplateLiteral',
      quasis: [{ value: { cooked: 'a' } }, { value: { cooked: 'c' } }],
    });
    expect(expression('test.each`a ${1}`;')).toMatchObject({
      type: 'TaggedTemplateExpression',
      quasi: { type: 'TemplateLiteral' },
    });
  });

  it('reads import.meta.vitest as a member of a MetaProperty', () => {
    expect(expression('import.meta.vitest;', 'shape.mts')).toMatchObject({
      type: 'MemberExpression',
      object: { type: 'MetaProperty', meta: { name: 'import' }, property: { name: 'meta' } },
      property: { name: 'vitest' },
    });
  });

  it('marks type-only imports with importKind', () => {
    const [declaration] = parseSync('shape.ts', "import type { test } from '@playwright/test';").program.body;
    expect(declaration).toMatchObject({ type: 'ImportDeclaration', importKind: 'type' });
  });

  it('returns an empty program after errors it cannot recover from, and a partial one after others', () => {
    const broken = parseSync('shape.ts', 'test("fills", () => {\n  const = 1;\n});');
    expect(broken.program.body).toEqual([]);
    expect(broken.errors[0]).toMatchObject({ message: 'Unexpected token', labels: [{ start: 30, end: 31 }] });
    const partial = parseSync('shape.ts', 'return;\ntest("fills", () => {});');
    expect(partial.errors).toHaveLength(1);
    expect(partial.program.body).toHaveLength(2);
  });

  it('lists comments with their type, value and offsets', () => {
    expect(parseSync('shape.ts', '// FIXME: TRD-1\n/** SKIP */ test();').comments).toEqual([
      { type: 'Line', value: ' FIXME: TRD-1', start: 0, end: 15 },
      { type: 'Block', value: '* SKIP ', start: 16, end: 27 },
    ]);
  });

  it('parses JSX only with a JSX language', () => {
    expect(parseSync('shape.js', 'render(<Chart />);').errors).toHaveLength(1);
    expect(parseSync('shape.js', 'render(<Chart />);', { lang: 'jsx' }).errors).toEqual([]);
  });

  it('has visitor keys for the nodes the scanner walks into', () => {
    for (const type of [
      'CallExpression',
      'IfStatement',
      'ConditionalExpression',
      'LogicalExpression',
      'SwitchStatement',
      'ForOfStatement',
      'ArrowFunctionExpression',
    ]) {
      expect(visitorKeys[type].length).toBeGreaterThan(0);
    }
  });
});
