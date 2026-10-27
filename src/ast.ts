import {
  visitorKeys,
  type ArrowFunctionExpression,
  type Expression,
  type Function,
  type MemberExpression,
  type Node,
  type StringLiteral,
} from 'oxc-parser';

export type FunctionNode = Function | ArrowFunctionExpression;

export function childNodes(node: Node): Node[] {
  const children: Node[] = [];
  const fields = node as unknown as Record<string, unknown>;
  for (const key of visitorKeys[node.type]) {
    const value = fields[key];
    if (Array.isArray(value)) {
      for (const item of value as (Node | null)[]) {
        if (item) children.push(item);
      }
    } else if (value) {
      children.push(value as Node);
    }
  }
  return children;
}

/** Strips TypeScript-only wrappers such as `test!`, `test as any` and `<any>test`. */
export function unwrap(node: Expression): Expression {
  let current = node;
  while (
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSNonNullExpression' ||
    current.type === 'TSTypeAssertion' ||
    current.type === 'TSInstantiationExpression' ||
    current.type === 'ParenthesizedExpression'
  ) {
    current = current.expression;
  }
  return current;
}

export function isFunctionNode(node: Node | null | undefined): node is FunctionNode {
  return node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression';
}

/** A value a function returns, with the nodes inside the function around its `return`, outermost first. */
export interface ReturnValue {
  expression: Expression;
  around: Node[];
}

/**
 * The values a function returns; null when it may return no value, as with `return;` or no `return` at all, and for
 * an async function or a generator, which returns a promise or an iterator whatever its `return` says. With `awaited`,
 * an async function's values are those its promise resolves to. A `return` in a function inside it is that function's.
 */
export function returnValues(fn: FunctionNode, awaited = false): ReturnValue[] | null {
  if ((fn.async && !awaited) || fn.generator) return null;
  // Only declarations of overloads have no body.
  const body = fn.body as Node;
  if (body.type !== 'BlockStatement') return [{ expression: body as Expression, around: [] }];
  const values: (ReturnValue | null)[] = [];
  // Copied only at a `return`, so that a long function costs no more than its size.
  const around: Node[] = [];
  const visit = (node: Node): void => {
    if (node.type === 'ReturnStatement') {
      values.push(node.argument ? { expression: node.argument, around: [...around] } : null);
      return;
    }
    if (node.type === 'FunctionDeclaration' || isFunctionNode(node)) return;
    around.push(node);
    for (const child of childNodes(node)) visit(child);
    around.pop();
  };
  visit(body);
  return values.length > 0 && !values.includes(null) ? (values as ReturnValue[]) : null;
}

export function isStringLiteral(node: Node): node is StringLiteral {
  return node.type === 'Literal' && typeof node.value === 'string';
}

/** `import.meta.vitest`, which in-source Vitest tests read their functions from. */
export function isImportMetaVitest(expression: Expression): boolean {
  const node = unwrap(expression);
  return node.type === 'MemberExpression' && node.object.type === 'MetaProperty' && propertyName(node) === 'vitest';
}

/** The name of a property in an object or pattern, written `a`, `'a'` or `['a']`; null when computed from code. */
export function propertyKey(property: { key: Node; computed: boolean }): string | null {
  const { key } = property;
  if (!property.computed && key.type === 'Identifier') return key.name;
  return isStringLiteral(key) ? key.value : null;
}

/** The property name of `a.b` or `a['b']`; null for other computed or private properties. */
export function propertyName(member: MemberExpression): string | null {
  if (!member.computed) {
    return member.property.type === 'Identifier' ? member.property.name : null;
  }
  return isStringLiteral(member.property) ? member.property.value : null;
}
