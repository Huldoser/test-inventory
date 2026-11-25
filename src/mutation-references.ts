import type {
  AssignmentTarget,
  AssignmentTargetMaybeDefault,
  BindingPattern,
  CallExpression,
  Expression,
  Node,
} from 'oxc-parser';
import { isFunctionNode, propertyKey, propertyName, returnValues, unwrapChain, type FunctionNode } from './ast.ts';

type Key = string | null;
interface Site {
  scopes: readonly Node[];
  /** The top-level declaration or expression being evaluated, when the relative order is known. */
  statement: Node | null;
}
export interface MutationTarget extends Site {
  value: Expression;
}
export interface AliasBinding extends Site {
  pattern: BindingPattern | AssignmentTarget;
  source: Expression;
  end: number;
  replaces: boolean;
}
export interface HelperInvocation extends Site {
  call: CallExpression;
  fn: FunctionNode;
  parameterScopes: readonly Node[];
}
interface AliasSource extends Site {
  ref: Reference;
  end: number | null;
  replaces: boolean;
  invocation?: HelperInvocation;
}
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

function memberKey(member: Extract<Expression, { type: 'MemberExpression' }>): Key {
  const key = member.property;
  return key.type === 'Literal' && typeof key.value === 'number' ? String(key.value) : propertyName(member);
}

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
function* property(ref: Reference, key: Key): Generator<Reference | null, void> {
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

/** Literal data cannot call a getter, evaluate a computed key or change an earlier declaration. */
function plainData(node: Expression): boolean {
  if (node.type === 'Literal') return true;
  if (node.type === 'ArrayExpression')
    return node.elements.every((item) => !item || (item.type !== 'SpreadElement' && plainData(item)));
  return (
    node.type === 'ObjectExpression' &&
    node.properties.every(
      (entry) => entry.type === 'Property' && entry.kind === 'init' && !entry.computed && plainData(entry.value),
    )
  );
}

/** A top-level call can read consecutive declarations of literal data before anything can change their properties. */
function suppliedMember(ref: Reference, invocation: HelperInvocation): boolean {
  const { call, scopes, statement } = invocation;
  const program = scopes[0];
  if (
    statement?.type !== 'ExpressionStatement' ||
    statement.expression !== call ||
    program.type !== 'Program' ||
    call.arguments.length !== 1 ||
    call.arguments[0] !== ref.value
  )
    return false;
  let root = ref.value;
  const path = [...ref.path];
  while (root.type === 'MemberExpression') {
    path.unshift(memberKey(root));
    root = unwrapChain(root.object);
  }
  if (root.type !== 'Identifier') return false;
  for (let i = program.body.indexOf(statement) - 1; i >= 0; i--) {
    const previous = program.body[i];
    if (previous.type === 'FunctionDeclaration' || previous.type === 'EmptyStatement') continue;
    if (
      previous.type !== 'VariableDeclaration' ||
      previous.kind !== 'const' ||
      !previous.declarations.every((d) => d.id.type === 'Identifier' && d.init && plainData(d.init))
    )
      break;
    const initial = previous.declarations.find((d) => d.id.type === 'Identifier' && d.id.name === root.name)?.init;
    if (!initial) continue;
    let current = direct(initial);
    for (const key of path) {
      if (
        key === null ||
        key === '__proto__' ||
        (current.value.type !== 'ObjectExpression' && current.value.type !== 'ArrayExpression')
      )
        return false;
      const next = property(current, key).next().value;
      if (!next) return false;
      current = next;
    }
    return true;
  }
  return false;
}

function bind(
  pattern: BindingPattern | AssignmentTargetMaybeDefault | FunctionNode['params'][number],
  ref: Reference | null,
  add: (name: string, ref: Reference, fromDefault?: boolean) => void,
  invocation?: HelperInvocation,
): void {
  if (pattern.type === 'AssignmentPattern') {
    if (ref) bind(pattern.left, ref, add, invocation);
    if (!ref || ((ref.path.length || !DEFINED.has(ref.value.type)) && !(invocation && suppliedMember(ref, invocation))))
      bind(
        pattern.left,
        direct(pattern.right),
        (name, value) => {
          add(name, value, true);
        },
        invocation,
      );
  } else if (!ref) return;
  else if (pattern.type === 'Identifier') add(pattern.name, ref);
  else if (pattern.type === 'ObjectPattern') {
    for (const entry of pattern.properties) {
      if (entry.type === 'RestElement') bind(entry.argument, { ...ref, rest: 0 }, add, invocation);
      else for (const child of property(ref, propertyKey(entry))) bind(entry.value, child, add, invocation);
    }
  } else if (pattern.type === 'ArrayPattern') {
    for (const [index, item] of pattern.elements.entries()) {
      if (!item) continue;
      if (item.type === 'RestElement') bind(item.argument, { ...ref, rest: index }, add, invocation);
      else for (const child of property(ref, String(index))) bind(item, child, add, invocation);
    }
  }
}

/** Follow the container of each write. Replacing a copy's property and mutating a shared child have different owners. */
export function changedReferences(
  declarations: AliasBinding[],
  targets: MutationTarget[],
  calls: ReadonlyMap<CallExpression, HelperInvocation>,
  callTimes: ReadonlyMap<Node, number | null>,
  bindingKey: (name: string, scopes: readonly Node[]) => string | null,
): Set<string> {
  const names = new Set<string>();
  const bindings = new Map<string, AliasSource[]>();
  const add = (name: string, scopes: readonly Node[], source: AliasSource) => {
    const key = bindingKey(name, scopes);
    if (key === null) return;
    const previous = bindings.get(key);
    if (previous) previous.push(source);
    else bindings.set(key, [source]);
  };
  for (const { pattern, source, scopes, statement, end, replaces } of declarations) {
    bind(pattern, direct(source), (name, ref) => {
      add(name, scopes, { ref, scopes, statement, end: statement ? end : null, replaces });
    });
  }
  for (const invocation of calls.values()) {
    const { call, fn, scopes, statement, parameterScopes } = invocation;
    // A parameter list destructures the argument list. Rest parameters share its elements, not the list itself.
    const args = direct({ type: 'ArrayExpression', elements: call.arguments, start: call.start, end: call.end });
    const bindArgument = (name: string, ref: Reference, fromDefault = false) => {
      add(name, parameterScopes, {
        ref,
        scopes: fromDefault ? parameterScopes : scopes,
        statement: fromDefault ? null : statement,
        end: null,
        invocation,
        replaces: false,
      });
    };
    for (const [index, parameter] of fn.params.entries()) {
      if (parameter.type === 'RestElement') bind(parameter.argument, { ...args, rest: index }, bindArgument);
      else {
        for (const source of property(args, String(index))) bind(parameter, source, bindArgument, invocation);
      }
    }
  }
  const activeRoots = new Set<Node>();
  const returning: { invocation: HelperInvocation; active: Set<Node> }[] = [];
  const follow = (ref: Reference, suffix: Key[], site: Site): void => {
    if (ref.rest !== undefined && suffix.length === 0) return;
    const path = [...ref.path, ...suffix];
    if (ref.rest && suffix[0] !== null) path[ref.path.length] = String(Number(suffix[0]) + ref.rest);
    let value = ref.value;
    while (value.type === 'MemberExpression') {
      path.unshift(memberKey(value));
      value = unwrapChain(value.object);
    }
    if (value.type === 'Identifier') {
      const key = bindingKey(value.name, site.scopes);
      if (key === null) return;
      names.add(key);
      const sources = bindings.get(key);
      const active = returning.at(-1)?.active ?? activeRoots;
      if (!sources || active.has(value)) return;
      active.add(value);
      // Only an unconditional module-level assignment rules out earlier top-level sources.
      const owner = site.scopes.findLast((scope) => scope.type === 'FunctionDeclaration' || isFunctionNode(scope));
      const readAt = site.statement ? value.start : owner && callTimes.get(owner);
      let replacedAt = 0;
      if (typeof readAt === 'number') {
        for (const source of sources)
          if (source.replaces && source.end !== null && source.end <= readAt)
            replacedAt = Math.max(replacedAt, source.end);
      }
      for (const source of sources) {
        if (typeof readAt === 'number' && source.end !== null && (source.end < replacedAt || source.end > readAt))
          continue;
        const invocation = source.invocation;
        if (invocation) {
          const frame = returning.findLast((frame) => frame.invocation.fn === invocation.fn)?.invocation;
          if (frame && frame !== invocation) continue;
        }
        follow(source.ref, path, source);
      }
      active.delete(value);
    } else if (value.type === 'CallExpression') {
      const invocation = calls.get(value);
      if (!invocation || returning.some((frame) => frame.invocation === invocation)) return;
      const returns = returnValues(invocation.fn, false, 'ignore');
      if (!returns) return;
      returning.push({ invocation, active: new Set() });
      for (const result of returns)
        follow(direct(result.expression), path, {
          scopes: [...invocation.parameterScopes, ...result.around],
          statement: null,
        });
      returning.pop();
    } else if (value.type === 'ConditionalExpression' || value.type === 'LogicalExpression') {
      for (const source of selected(value)) follow(direct(source), path, site);
    } else if (value.type === 'SequenceExpression') {
      follow(direct(value.expressions[value.expressions.length - 1]), path, site);
    } else if (value.type === 'AssignmentExpression' && value.operator === '=') {
      follow(direct(value.right), path, site);
    } else if (path.length && (value.type === 'ObjectExpression' || value.type === 'ArrayExpression')) {
      for (const child of property(direct(value), path[0])) if (child) follow(child, path.slice(1), site);
    }
  };
  for (const target of targets) follow(direct(target.value), [], target);
  return names;
}
