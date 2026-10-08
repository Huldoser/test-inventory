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
