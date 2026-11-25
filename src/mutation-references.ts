import type { BindingPattern, Expression, Node, VariableDeclarator } from 'oxc-parser';
import { propertyKey, propertyName, unwrapChain } from './ast.ts';

type Key = string | null;
interface Reference {
  value: Expression;
  path: Key[];
  /** A rest binding is a shallow copy. Array rest starts at this index in the original array. */
  rest?: number;
}

const direct = (value: Expression): Reference => ({ value: unwrapChain(value), path: [] });
const DEFINED = new Set<Node['type']>([
  'Literal',
  'ArrayExpression',
  'ObjectExpression',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassExpression',
  'TemplateLiteral',
]);

/** Which operand supplies a reference when the condition can be decided without reading mutable bindings. */
function selected(value: Extract<Expression, { type: 'ConditionalExpression' | 'LogicalExpression' }>): Expression[] {
  const conditional = value.type === 'ConditionalExpression';
  const test = unwrapChain(conditional ? value.test : value.left);
  const present = !conditional && value.operator === '??';
  let truth: boolean | null = null;
  if (test.type === 'Literal') truth = 'regex' in test || (present ? test.value !== null : Boolean(test.value));
  else if (test.type === 'UnaryExpression' && test.operator === 'void') truth = false;
  else if (DEFINED.has(test.type) && (present || test.type !== 'TemplateLiteral')) truth = true;
  const first = conditional ? value.consequent : value.left;
  const second = conditional ? value.alternate : value.right;
  if (truth === null) return [first, second];
  const takeFirst = !conditional && value.operator === '&&' ? !truth : truth;
  return [takeFirst ? first : second];
}

/** Possible references at a property, including a missing value when destructuring could use its default. */
function* property(ref: Reference, key: Key): Generator<Reference | null> {
  const value = ref.value;
  if (ref.path.length || (value.type !== 'ObjectExpression' && value.type !== 'ArrayExpression')) {
    yield { value, path: [...ref.path, key] };
    return;
  }
  if (value.type === 'ObjectExpression') {
    for (let index = value.properties.length - 1; index >= 0; index--) {
      const entry = value.properties[index];
      if (entry.type === 'SpreadElement') {
        yield* property(direct(entry.argument), key);
        continue;
      }
      const name = propertyKey(entry);
      if (key !== null && name !== null && key !== name) continue;
      yield direct(entry.value);
      if (key !== null && key === name) return;
    }
  } else {
    const index = key === null ? null : Number(key);
    let earliest = 0;
    let afterSpread = false;
    for (const item of value.elements) {
      if (index !== null && earliest > index) break;
      if (item?.type === 'SpreadElement') {
        yield* property(direct(item.argument), index === null || afterSpread ? null : String(index - earliest));
        afterSpread = true;
      } else {
        if (index === null || afterSpread || earliest === index) yield item && direct(item);
        if (!afterSpread && index === earliest) return;
        earliest++;
      }
    }
  }
  yield null;
}

function bind(pattern: BindingPattern, ref: Reference | null, add: (name: string, ref: Reference) => void): void {
  if (pattern.type === 'AssignmentPattern') {
    if (ref) bind(pattern.left, ref, add);
    if (!ref || ref.path.length || !DEFINED.has(ref.value.type)) bind(pattern.left, direct(pattern.right), add);
  } else if (!ref) return;
  else if (pattern.type === 'Identifier') add(pattern.name, ref);
  else if (pattern.type === 'ObjectPattern') {
    for (const entry of pattern.properties) {
      if (entry.type === 'RestElement') bind(entry.argument, { ...ref, rest: 0 }, add);
      else for (const child of property(ref, propertyKey(entry))) bind(entry.value, child, add);
    }
  } else {
    for (const [index, item] of pattern.elements.entries()) {
      if (!item) continue;
      if (item.type === 'RestElement') bind(item.argument, { ...ref, rest: index }, add);
      else for (const child of property(ref, String(index))) bind(item, child, add);
    }
  }
}

/** Follow the container of each write. Replacing a copy's property and mutating a shared child have different owners. */
export function changedReferences(
  declarations: { id: VariableDeclarator['id']; init: Expression }[],
  targets: Expression[],
): Set<string> {
  const names = new Set<string>();
  if (!targets.length) return names;
  const bindings = new Map<string, Reference[]>();
  const add = (name: string, ref: Reference) => {
    const previous = bindings.get(name);
    if (previous) previous.push(ref);
    else bindings.set(name, [ref]);
  };
  for (const declaration of declarations) bind(declaration.id, direct(declaration.init), add);
  const active = new Set<string>();
  const follow = (ref: Reference, suffix: Key[]): void => {
    if (ref.rest !== undefined && suffix.length === 0) return;
    const path = [...ref.path, ...suffix];
    if (ref.rest && suffix[0] !== null) path[ref.path.length] = String(Number(suffix[0]) + ref.rest);
    let value = ref.value;
    while (value.type === 'MemberExpression') {
      const key = value.property;
      path.unshift(key.type === 'Literal' && typeof key.value === 'number' ? String(key.value) : propertyName(value));
      value = unwrapChain(value.object);
    }
    if (value.type === 'Identifier') {
      const name = value.name;
      names.add(name);
      const sources = bindings.get(name);
      if (!sources || active.has(name)) return;
      active.add(name);
      for (const source of sources) follow(source, path);
      active.delete(name);
    } else if (value.type === 'ConditionalExpression' || value.type === 'LogicalExpression') {
      for (const source of selected(value)) follow(direct(source), path);
    } else if (value.type === 'SequenceExpression') {
      follow(direct(value.expressions[value.expressions.length - 1]), path);
    } else if (path.length && (value.type === 'ObjectExpression' || value.type === 'ArrayExpression')) {
      for (const child of property(direct(value), path[0])) if (child) follow(child, path.slice(1));
    }
  };
  for (const target of targets) follow(direct(target), []);
  return names;
}
