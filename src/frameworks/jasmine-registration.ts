import type { Argument, BlockStatement, CallExpression, Expression, Node, Statement } from 'oxc-parser';
import { childNodes, isFunctionNode, unwrap, type FunctionNode } from '../ast.ts';
import { literalArguments } from '../mutation-references.ts';
import { nonIterable, type ParameterStep, type Resolved, type Value } from '../values.ts';
import { atLeast, type FileContext } from './common.ts';

/** Constructing these values cannot call user code or throw during registration. */
function inert(expression: Expression): boolean {
  const node = unwrap(expression);
  if (node.type === 'ClassExpression') return !node.superClass && !node.decorators.length && !node.body.body.length;
  if (node.type === 'ArrayExpression')
    return node.elements.every((value) => !value || (value.type !== 'SpreadElement' && inert(value)));
  if (node.type === 'ObjectExpression')
    return node.properties.every((p) => p.type === 'Property' && !p.computed && inert(p.value));
  return node.type === 'Literal' || isFunctionNode(node);
}

function completesWithoutThrowing(expression: Expression): boolean {
  const node = unwrap(expression);
  if (node.type !== 'AwaitExpression') return inert(node);
  // Await reads "then" from objects, including regex literals. A primitive literal always fulfills.
  const operand = unwrap(node.argument);
  return operand.type === 'Literal' && !('regex' in operand);
}

/** Runtime function length excludes a TypeScript this parameter and ends at the first default or rest parameter. */
export function functionLength(fn: FunctionNode): number {
  const params = fn.params.filter((param) => param.type !== 'Identifier' || param.name !== 'this');
  const end = params.findIndex((param) => param.type === 'AssignmentPattern' || param.type === 'RestElement');
  return end === -1 ? params.length : end;
}

type Exit = 'next' | 'return' | 'throw' | 'unknown';
interface Children {
  registered: boolean | 'possible';
}
interface ArgumentValue {
  node: Expression | FunctionNode;
  scopes: readonly Node[];
}
type RuntimeFunction = FunctionNode & { body: NonNullable<FunctionNode['body']> };
const owner = (scopes: readonly Node[]) =>
  scopes.findLast((n) => n.type === 'FunctionDeclaration' || isFunctionNode(n));
export const isRuntimeFunction = (node: Node | null | undefined): node is RuntimeFunction =>
  node?.type === 'FunctionDeclaration' || isFunctionNode(node);
type RegistrationStatus = 'valid' | 'callback' | 'timeout' | 'unknown';

export interface JasmineArgument {
  node: Argument;
  scopes: readonly Node[];
  resolved?: { ok: true; value: Value };
}
type Position = JasmineArgument | null | undefined;

/** A hole supplies undefined. A spread of unknown width obscures this and all subsequent positions. */
function* spreadArguments(
  args: readonly (Argument | null)[],
  scopes: readonly Node[],
  file: FileContext,
  count: number,
  arrays = new Map<Node, (JasmineArgument | null)[]>(),
): Generator<JasmineArgument | null, undefined> {
  for (const item of literalArguments(args)) {
    if (item?.type !== 'SpreadElement') {
      yield item ? { node: unwrap(item), scopes } : null;
      continue;
    }
    const spread = unwrap(item.argument);
    const source = spread.type === 'Identifier' && file.values.constantOf(spread.name, scopes, true);
    const init = source && unwrap(source.init);
    if (init && init.type === 'ArrayExpression') {
      let positions = arrays.get(init);
      if (!positions) {
        // A circular initializer has unknown width. Cache just the positions the runner consumes.
        arrays.set(init, [{ node: item, scopes }]);
        positions = [];
        for (const arg of spreadArguments(init.elements, source.scopes, file, count, arrays)) {
          positions.push(arg);
          if (positions.length === count) break;
        }
        arrays.set(init, positions);
      }
      yield* positions;
      continue;
    }
    const result = file.values.resolve(spread, scopes);
    if (result.ok && (Array.isArray(result.value) || typeof result.value === 'string')) {
      for (const value of result.value) yield { node: spread, scopes, resolved: { ok: true, value } };
      continue;
    }
    yield { node: item, scopes };
    return;
  }
}

export function jasmineArguments(
  args: readonly Argument[],
  scopes: readonly Node[],
  file: FileContext,
  count: number,
): Position[] {
  const reader = spreadArguments(args, scopes, file, count);
  const positions: Position[] = [];
  let current: Position;
  for (let index = 0; index < count; index++) {
    if (current?.node.type !== 'SpreadElement') current = reader.next().value;
    positions.push(current);
  }
  return positions;
}

function callback(
  body: Position,
  file: FileContext,
): {
  status: 'valid' | 'callback' | 'unknown' | 'missing';
  fn: FunctionNode | null;
} {
  if (!body) return { status: 'missing', fn: null };
  const { node, scopes } = body;
  if (node.type === 'SpreadElement') return { status: 'unknown', fn: null };
  const resolved = body.resolved ?? file.values.resolve(node, scopes);
  if (resolved.ok) return { status: resolved.value === undefined ? 'missing' : 'callback', fn: null };
  const assigned = file.values.assignedIn(scopes[0], false);
  const fn = isFunctionNode(node)
    ? node
    : node.type === 'Identifier' && !assigned.has(node.name)
      ? file.values.functionOf(node.name, scopes)
      : null;
  if (fn?.generator) return { status: 'callback', fn: null };
  if (fn || node.type === 'ClassExpression') return { status: 'valid', fn };
  // Jasmine's spec and suite declarations return objects which cannot serve as callbacks.
  const callee = node.type === 'CallExpression' && unwrap(node.callee);
  const registration =
    callee &&
    callee.type === 'Identifier' &&
    ['it', 'fit', 'xit', 'describe', 'fdescribe', 'xdescribe'].includes(callee.name) &&
    !assigned.has(callee.name) &&
    !file.values.declarationOf(callee.name, scopes);
  const nonfunction =
    registration || ['Literal', 'ArrayExpression', 'ObjectExpression', 'TemplateLiteral'].includes(node.type);
  return { status: nonfunction ? 'callback' : 'unknown', fn: null };
}

export function jasmineRegistration(
  body: Position,
  limit: Position,
  file: FileContext,
  allowsPending: boolean,
): {
  status: RegistrationStatus;
  fn: FunctionNode | null;
  missing: boolean;
} {
  const read = callback(body, file);
  const missing = read.status === 'missing';
  const fn = read.fn;
  if (read.status === 'callback' || (missing && !allowsPending)) return { status: 'callback', fn, missing };
  if (limit && atLeast(file.version, 3, 10)) {
    if (limit.node.type === 'SpreadElement') return { status: 'unknown', fn, missing };
    const resolved = limit.resolved ?? file.values.resolve(limit.node, limit.scopes);
    if (!resolved.ok) return { status: 'unknown', fn, missing };
    const value = resolved.value;
    if (
      value !== null &&
      typeof value === 'object' &&
      !(Array.isArray(value) && value.every((item) => item === null || typeof item !== 'object'))
    )
      return { status: 'unknown', fn, missing };
    if (Number(value) > 2147483647) return { status: 'timeout', fn, missing };
  }
  return { status: read.status === 'unknown' ? 'unknown' : 'valid', fn, missing };
}

interface SuiteCall {
  call: CallExpression;
  fn: RuntimeFunction;
  definition: readonly Node[];
  plain: boolean;
}

/** Check whether a guarded block or a valid suite call completes registration or reaches its caller's catch. */
export function registrationExit(root: BlockStatement | SuiteCall, outer: readonly Node[], file: FileContext): Exit {
  const start = 'call' in root ? root.call.start : root.start;
  // Helpers may recurse or call each other repeatedly. Exhausting this proof budget keeps the catch in the inventory.
  let remaining = 256;
  const active: { block: BlockStatement; at: number }[] = [];
  const parameters: { fn: FunctionNode; initialized: Set<string> }[] = [];
  const assigned = file.values.assignedIn(outer[0], false);
  function argument(arg: Argument | undefined, scopes: readonly Node[]): ArgumentValue | undefined {
    if (!arg || arg.type === 'SpreadElement') return undefined;
    const node = unwrap(arg);
    if (node.type !== 'Identifier') return { node, scopes };
    const declaration = file.values.declarationOf(node.name, scopes);
    if (declaration?.type === 'FunctionDeclaration' && !assigned.has(node.name)) {
      const binding = file.values.functionWithScopes(node.name, scopes);
      if (binding) return { node: binding.fn, scopes: binding.scopes };
    }
    const constant = file.values.constantOf(node.name, scopes);
    if (constant && declaration?.type === 'VariableDeclarator' && declaration.id.type === 'Identifier') {
      // A helper can be called before a constant in its enclosing scope has been initialized.
      const scope = constant.scopes[constant.scopes.length - 1];
      const beforeUse = owner(scopes) === owner(constant.scopes) && constant.init.end < node.start;
      const beforeTry = outer.includes(scope) && owner(outer) === owner(constant.scopes) && constant.init.end < start;
      const beforeCall = constant.init.end <= (active.findLast((entry) => entry.block === scope)?.at ?? -1);
      if ((scope.type === 'Program' || scope.type === 'BlockStatement') && (beforeUse || beforeTry || beforeCall))
        return { node: unwrap(constant.init), scopes: constant.scopes };
    }
    return undefined;
  }
  function invoke(
    fn: RuntimeFunction,
    definition: readonly Node[],
    children: Children,
    args: readonly Resolved[] = [],
    complete = true,
  ): Exit {
    const body = fn.body;
    const steps = new Map<Node, ParameterStep>();
    const initialized = new Set<string>();
    const inside = [...definition, fn];
    function bind(node: Node): Exit {
      const step = steps.get(node);
      if (step === 'throw') return 'throw';
      if (step === null) return 'unknown';
      if (node.type === 'Identifier') {
        initialized.add(node.name);
        return 'next';
      }
      if (node.type === 'AssignmentPattern') {
        const outcome = step ? expression(node.right, inside, children) : 'next';
        return outcome === 'next' ? bind(node.left) : outcome;
      }
      if (node.type === 'Property') {
        if (node.computed) {
          const computed = node.key as Expression;
          const outcome = expression(computed, inside, children);
          if (outcome !== 'next') return outcome;
          const key = file.values.resolve(computed, inside);
          if (!key.ok || (key.value !== null && typeof key.value === 'object')) return 'unknown';
        }
        return bind(node.value);
      }
      const parts =
        node.type === 'ObjectPattern'
          ? node.properties
          : node.type === 'ArrayPattern'
            ? node.elements
            : childNodes(node);
      for (const part of parts) {
        if (!part) continue;
        const result = bind(part);
        if (result !== 'next') return result;
      }
      return 'next';
    }
    return file.values.withArguments(
      fn,
      args,
      definition,
      () => {
        parameters.push({ fn, initialized });
        let result: Exit = 'next';
        for (const param of fn.params) {
          result = bind(param);
          if (result !== 'next') break;
        }
        if (result === 'next' && !fn.generator) {
          result =
            body.type === 'BlockStatement' ? statement(body, inside, children) : expression(body, inside, children);
          if (result === 'return') result = 'next';
        }
        parameters.pop();
        return result;
      },
      complete,
      steps,
    );
  }
  function suite(fn: RuntimeFunction, definition: readonly Node[], plain: boolean): Exit {
    const children: Children = { registered: false };
    const result = invoke(fn, definition, children);
    if (result === 'unknown') return result;
    if (
      children.registered !== true &&
      atLeast(file.version, 4, plain ? 0 : 5) &&
      !(result === 'throw' && atLeast(file.version, 4, 5))
    )
      return children.registered === 'possible' ? 'unknown' : 'throw';
    return 'next';
  }
  function call(node: CallExpression, scopes: readonly Node[], children: Children): Exit {
    const callee = unwrap(node.callee);
    if (--remaining < 0 || callee.type !== 'Identifier' || assigned.has(callee.name)) return 'unknown';
    const name = callee.name;
    const binding = file.values.declarationOf(name, scopes);
    const args = node.arguments;
    if (binding) {
      const helper = argument(callee, scopes);
      if (!helper || !isRuntimeFunction(helper.node)) return 'unknown';
      const evaluated = elements(args, scopes, children);
      if (evaluated !== 'next') return evaluated;
      if (helper.node.async && !helper.node.generator) {
        // Its synchronous prefix may register a child. Errors in its parameters or body reject the returned promise.
        children.registered ||= 'possible';
        return 'next';
      }
      const actual = file.values.callArguments(node, scopes, true);
      return invoke(helper.node, helper.scopes, children, actual.args, actual.complete);
    }
    const spec = ['it', 'xit', 'fit'].includes(name);
    if (spec || ['beforeEach', 'afterEach', 'beforeAll', 'afterAll'].includes(name)) {
      const evaluated = elements(args, scopes, children);
      if (evaluated !== 'next') return evaluated;
      const positions = jasmineArguments(args, scopes, file, spec ? 3 : 2);
      const index = spec ? 1 : 0;
      const { status } = jasmineRegistration(positions[index], positions[index + 1], file, spec && name !== 'fit');
      if (status === 'unknown') return 'unknown';
      if (status !== 'valid') return 'throw';
      if (spec) children.registered = true;
      return 'next';
    }
    const first = argument(args.at(0), scopes)?.node;
    const secondArg = argument(args.at(1), scopes);
    if (first?.type !== 'Literal' || typeof first.value !== 'string') return 'unknown';
    if (
      ['describe', 'xdescribe', 'fdescribe'].includes(name) &&
      args.length === 2 &&
      secondArg &&
      isRuntimeFunction(secondArg.node)
    ) {
      if (name === 'describe' && functionLength(secondArg.node) > 0) return 'throw';
      if (secondArg.node.async || secondArg.node.generator) return 'throw';
      // Jasmine attaches the suite before running its callback and checking its children.
      children.registered = true;
      return suite(secondArg.node, secondArg.scopes, name === 'describe');
    }
    return 'unknown';
  }
  function elements(items: readonly (Argument | null)[], scopes: readonly Node[], children: Children): Exit {
    for (const item of items) {
      if (!item) continue;
      const result = expression(item.type === 'SpreadElement' ? item.argument : item, scopes, children);
      if (result !== 'next') return result;
      if (item.type === 'SpreadElement') {
        if (unwrap(item.argument).type === 'ArrayExpression') continue;
        const spread = file.values.resolve(item.argument, scopes);
        if (!spread.ok) {
          if (file.values.lengthOf(item.argument, scopes) === null) return 'unknown';
        } else if (nonIterable(spread.value)) return 'throw';
      }
    }
    return 'next';
  }
  function expression(node: Expression, scopes: readonly Node[], children: Children): Exit {
    const value = unwrap(node);
    if (value.type === 'ArrayExpression') return elements(value.elements, scopes, children);
    if (value.type === 'CallExpression') return call(value, scopes, children);
    if (value.type === 'UnaryExpression' && value.operator === 'void')
      return expression(value.argument, scopes, children);
    if (value.type === 'Identifier') {
      const declaration = file.values.declarationOf(value.name, scopes);
      const binding = parameters.findLast((entry) => entry.fn === declaration);
      if (binding) return binding.initialized.has(value.name) ? 'next' : 'throw';
      if ((!declaration && value.name === 'undefined') || argument(value, scopes)) return 'next';
    }
    return completesWithoutThrowing(value) ? 'next' : 'unknown';
  }
  function statement(node: Statement, scopes: readonly Node[], children: Children): Exit {
    if (--remaining < 0) return 'unknown';
    switch (node.type) {
      case 'BlockStatement': {
        const inside = [...scopes, node];
        const entry = { block: node, at: node.start };
        active.push(entry);
        let result: Exit = 'next';
        for (const child of node.body) {
          entry.at = child.start;
          result = statement(child, inside, children);
          if (result !== 'next') break;
        }
        active.pop();
        return result;
      }
      case 'FunctionDeclaration':
      case 'EmptyStatement':
        return 'next';
      case 'VariableDeclaration':
        if (node.kind.endsWith('using')) return 'unknown';
        for (const { id, init } of node.declarations) {
          if (id.type !== 'Identifier' || (init && !completesWithoutThrowing(init))) return 'unknown';
        }
        return 'next';
      case 'ExpressionStatement':
        return expression(node.expression, scopes, children);
      case 'ReturnStatement': {
        const result = node.argument ? expression(node.argument, scopes, children) : 'next';
        return result === 'next' ? 'return' : result;
      }
      case 'ThrowStatement':
        if (expression(node.argument, scopes, children) === 'unknown') children.registered ||= 'possible';
        return 'throw';
      case 'IfStatement': {
        const test = unwrap(node.test);
        const declaration = test.type === 'Identifier' && file.values.declarationOf(test.name, scopes);
        const bound =
          test.type === 'Identifier' &&
          parameters.some((entry) => entry.fn === declaration && entry.initialized.has(test.name));
        const literal = argument(test, scopes)?.node;
        const guard = bound
          ? file.values.resolve(test, scopes)
          : literal?.type === 'Literal' && { ok: true, value: literal.value };
        if (!guard || !guard.ok) return 'unknown';
        const arm = guard.value ? node.consequent : node.alternate;
        return arm ? statement(arm, scopes, children) : 'next';
      }
      case 'TryStatement': {
        let result = statement(node.block, scopes, children);
        if (result === 'throw' && node.handler) {
          if (node.handler.param && node.handler.param.type !== 'Identifier') return 'unknown';
          result = statement(node.handler.body, [...scopes, node.handler], children);
        }
        if (node.finalizer) {
          if (result === 'unknown') children.registered ||= 'possible';
          const end = statement(node.finalizer, scopes, children);
          if (end !== 'next') return end;
        }
        return result;
      }
      default:
        return 'unknown';
    }
  }
  return 'call' in root ? suite(root.fn, root.definition, root.plain) : statement(root, outer, { registered: false });
}
