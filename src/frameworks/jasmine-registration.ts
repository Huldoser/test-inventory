import type {
  Argument,
  ArrayExpression,
  BlockStatement,
  CallExpression,
  Expression,
  Node,
  Statement,
} from 'oxc-parser';
import { childNodes, isFunctionNode, unwrap, type FunctionNode } from '../ast.ts';
import { literalArguments } from '../mutation-references.ts';
import { isValueOperation, operationValue, type ParameterStep, type Resolved, type Value } from '../values.ts';
import { atLeast, type FileContext } from './common.ts';

function completesWithoutThrowing(node: Expression): boolean {
  if (node.type === 'ClassExpression') return !node.superClass && !node.decorators.length && !node.body.body.length;
  if (node.type === 'AwaitExpression') {
    // Await reads "then" from objects, including regex literals. A primitive literal always fulfills.
    const operand = unwrap(node.argument);
    return operand.type === 'Literal' && !('regex' in operand);
  }
  return node.type === 'Literal' || isFunctionNode(node);
}

/** Runtime function length excludes a TypeScript this parameter and ends at the first default or rest parameter. */
export function functionLength(fn: FunctionNode): number {
  const params = fn.params.filter((param) => param.type !== 'Identifier' || param.name !== 'this');
  const end = params.findIndex((param) => param.type === 'AssignmentPattern' || param.type === 'RestElement');
  return end === -1 ? params.length : end;
}

type Flow = 'next' | 'throw' | 'unknown';
type Completion = Flow | { returned: Resolved };
const omitted: Resolved = { ok: true, value: undefined };
const objectResult: Resolved = { ok: false, importedFrom: null, defined: true, truthy: true };
const promiseResult: Resolved = { ...objectResult, nonIterable: true };

/** Format descriptions whose conversion uses only standard methods, including each element in a nested array. */
function descriptionText(value: Value): string | undefined {
  if (value === null || typeof value !== 'object') return String(value ?? '');
  if (!Array.isArray(value)) return value.toString === Object.prototype.toString ? '[object Object]' : undefined;
  const parts: string[] = [];
  for (const element of value) {
    const text = descriptionText(element);
    if (text === undefined) return undefined;
    parts.push(text);
  }
  return parts.join(',');
}

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

export function jasmineCallback(
  body: Position,
  file: FileContext,
): {
  status: 'valid' | 'callback' | 'unknown' | 'missing';
  binding: { fn: FunctionNode; scopes: readonly Node[] } | null;
} {
  if (!body) return { status: 'missing', binding: null };
  const { node, scopes } = body;
  if (node.type === 'SpreadElement') return { status: 'unknown', binding: null };
  const resolved = body.resolved ?? file.values.resolve(node, scopes);
  if (resolved.ok) return { status: resolved.value === undefined ? 'missing' : 'callback', binding: null };
  const assigned = file.values.assignedIn(scopes[0], false);
  const binding = isFunctionNode(node)
    ? { fn: node, scopes }
    : node.type === 'Identifier' && !assigned.has(node.name)
      ? file.values.functionWithScopes(node.name, scopes)
      : null;
  if (binding || node.type === 'ClassExpression') return { status: 'valid', binding };
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
  return { status: nonfunction ? 'callback' : 'unknown', binding: null };
}

export function jasmineRegistration(
  read: ReturnType<typeof jasmineCallback>,
  limit: Position,
  file: FileContext,
  allowsPending: boolean,
): {
  status: RegistrationStatus;
  fn: FunctionNode | null;
  missing: boolean;
} {
  const missing = read.status === 'missing';
  const fn = read.binding?.fn ?? null;
  if (fn?.generator) return { status: 'callback', fn: null, missing };
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

/** Evaluate the registration path and keep helper return values in their invocation's bindings. */
function registrationFlow(start: number, outer: readonly Node[], file: FileContext) {
  const results = new Map<Expression, Resolved>();
  function valueOf(expr: Expression, scopes: readonly Node[]): Resolved {
    const node = unwrap(expr);
    const result = results.get(node) ?? file.values.resolve(node, scopes);
    if (
      !result.ok &&
      (node.type === 'ObjectExpression' ||
        node.type === 'ArrayExpression' ||
        node.type === 'ClassExpression' ||
        isFunctionNode(node) ||
        (node.type === 'Literal' && 'regex' in node))
    ) {
      return objectResult;
    }
    return result;
  }
  // Helpers may recurse or call each other repeatedly. Exhausting this proof budget keeps the catch in the inventory.
  let remaining = 256;
  const active: { block: BlockStatement; at: number }[] = [];
  const parameters: { fn: FunctionNode; initialized: Set<string> }[] = [];
  const assigned = file.values.assignedIn(outer[0], false);
  function argument(arg: Expression, scopes: readonly Node[]): ArgumentValue | undefined {
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
      // An inline enclosing function could only be created after earlier statements in its block ran.
      const inner = outer
        .slice(outer.indexOf(scope) + 1)
        .find((n) => n.type === 'FunctionDeclaration' || isFunctionNode(n));
      const beforeClosure = outer.includes(scope) && isFunctionNode(inner) && constant.init.end < inner.start;
      const beforeCall = constant.init.end <= (active.findLast((entry) => entry.block === scope)?.at ?? -1);
      if (
        (scope.type === 'Program' || scope.type === 'BlockStatement') &&
        (beforeUse || beforeTry || beforeClosure || beforeCall)
      )
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
    site?: CallExpression,
  ): Flow {
    const body = fn.body;
    const steps = new Map<Node, ParameterStep>();
    const initialized = new Set<string>();
    const inside = [...definition, fn];
    function bind(node: Node): Flow {
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
        let result: Flow = 'next';
        for (const param of fn.params) {
          result = bind(param);
          if (result !== 'next') break;
        }
        if (result === 'next' && !fn.generator) {
          const end =
            body.type === 'BlockStatement' ? statement(body, inside, children) : expression(body, inside, children);
          result = typeof end === 'object' ? 'next' : end;
          if (site && result === 'next') {
            const value =
              typeof end === 'object' ? end.returned : body.type === 'BlockStatement' ? omitted : valueOf(body, inside);
            results.set(site, value);
          }
        }
        parameters.pop();
        return result;
      },
      complete,
      steps,
    );
  }
  function suite(fn: RuntimeFunction, definition: readonly Node[], plain: boolean): Flow {
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
  function call(node: CallExpression, scopes: readonly Node[], children: Children): Flow {
    const callee = unwrap(node.callee);
    if (--remaining < 0) return 'unknown';
    if (
      callee.type === 'MemberExpression' ||
      (callee.type === 'Identifier' &&
        callee.name === 'String' &&
        !assigned.has('String') &&
        !file.values.declarationOf('String', scopes))
    ) {
      return evaluate(node, scopes, children, (read) => file.values.builtinCall(node, scopes, read));
    }
    const inline = isFunctionNode(callee);
    if (!inline && (callee.type !== 'Identifier' || assigned.has(callee.name))) return 'unknown';
    const args = node.arguments;
    if (inline || file.values.declarationOf(callee.name, scopes)) {
      const helper = inline ? { node: callee, scopes } : argument(callee, scopes);
      if (!helper || !isRuntimeFunction(helper.node)) return 'unknown';
      const evaluated = elements(args, scopes, children);
      if (evaluated !== 'next') return evaluated;
      if (helper.node.async && !helper.node.generator) {
        // Its synchronous prefix may register a child. Errors in its parameters or body reject the returned promise.
        children.registered ||= 'possible';
        results.set(node, promiseResult);
        return 'next';
      }
      const actual = file.values.callArguments(node, scopes, true);
      const result = invoke(helper.node, helper.scopes, children, actual.args, actual.complete, node);
      if (helper.node.generator && result === 'next') results.set(node, objectResult);
      return result;
    }
    const name = callee.name;
    const spec = ['it', 'xit', 'fit'].includes(name);
    if (spec || ['beforeEach', 'afterEach', 'beforeAll', 'afterAll'].includes(name)) {
      const evaluated = elements(args, scopes, children);
      if (evaluated !== 'next') return evaluated;
      const positions = jasmineArguments(args, scopes, file, spec ? 3 : 2);
      const index = spec ? 1 : 0;
      const read = jasmineCallback(positions[index], file);
      const { status } = jasmineRegistration(read, positions[index + 1], file, spec && name !== 'fit');
      if (status === 'unknown') return 'unknown';
      if (status !== 'valid') return 'throw';
      if (spec) children.registered = true;
      results.set(node, spec ? objectResult : omitted);
      return 'next';
    }
    if (!['describe', 'xdescribe', 'fdescribe'].includes(name)) return 'unknown';
    const evaluated = elements(args, scopes, children);
    if (evaluated !== 'next') return evaluated;
    const [title, body] = jasmineArguments(args, scopes, file, 2);
    const { status, binding: callback } = jasmineCallback(body, file);
    if (status === 'missing' || status === 'callback') return 'throw';
    if (!callback || !isRuntimeFunction(callback.fn)) return 'unknown';
    const fn = callback.fn;
    const plain = name === 'describe';
    if (fn.async || fn.generator || (plain && functionLength(fn) > 0)) return 'throw';
    // An unresolved description may run user code when Jasmine formats it.
    // Resolving the callback position has already established the width of preceding spreads.
    if (title) {
      const value = title.resolved ?? valueOf(title.node as Expression, title.scopes);
      if (!value.ok || descriptionText(value.value) === undefined) return 'unknown';
    }
    // Jasmine attaches the suite before running its callback and checking its children.
    children.registered = true;
    const result = suite(fn, callback.scopes, plain);
    if (result === 'next') results.set(node, objectResult);
    return result;
  }
  function elements(list: readonly Argument[] | ArrayExpression, scopes: readonly Node[], children: Children): Flow {
    const array = 'elements' in list;
    let parts: Value[] | undefined = array ? [] : undefined;
    for (const item of array ? list.elements : list) {
      if (!item) {
        parts?.push(undefined);
        continue;
      }
      const operand = item.type === 'SpreadElement' ? item.argument : item;
      const result = expression(operand, scopes, children);
      if (result !== 'next') return result;
      if (item.type === 'SpreadElement') {
        const spread = valueOf(operand, scopes);
        if (!spread.ok) {
          if (spread.nonIterable) return 'throw';
          if (unwrap(operand).type !== 'ArrayExpression' && file.values.lengthOf(operand, scopes) === null)
            return 'unknown';
          parts = undefined;
        } else {
          if (!Array.isArray(spread.value) && typeof spread.value !== 'string') return 'throw';
          if (parts) for (const element of spread.value) parts.push(element);
        }
      } else if (parts) {
        const element = valueOf(operand, scopes);
        if (element.ok) parts.push(element.value);
        else parts = undefined;
      }
    }
    if (array) results.set(list, parts ? { ok: true, value: parts } : objectResult);
    return 'next';
  }
  function evaluate(
    node: Expression,
    scopes: readonly Node[],
    children: Children,
    compute: (read: (operand: Expression) => Resolved) => Resolved,
  ): Flow {
    let failure: Flow = 'unknown';
    const computed = compute((operand) => {
      const outcome = expression(operand, scopes, children);
      if (outcome === 'next') return valueOf(operand, scopes);
      failure = outcome;
      return { ok: false, importedFrom: null };
    });
    results.set(node, computed);
    return computed.ok || computed.truthy ? 'next' : failure;
  }
  function expression(node: Expression, scopes: readonly Node[], children: Children): Flow {
    const value = unwrap(node);
    if (value.type === 'ArrayExpression') return elements(value, scopes, children);
    if (value.type === 'ObjectExpression') {
      for (const property of value.properties) {
        if (property.type === 'SpreadElement') {
          const outcome = expression(property.argument, scopes, children);
          if (outcome !== 'next') return outcome;
          // Copying a property may invoke a getter on a source whose contents are unknown.
          if (!valueOf(property.argument, scopes).ok) return 'unknown';
        } else {
          if (property.computed) {
            const key = property.key as Expression;
            const outcome = expression(key, scopes, children);
            if (outcome !== 'next') return outcome;
            const resolved = valueOf(key, scopes);
            if (!resolved.ok || (resolved.value !== null && typeof resolved.value === 'object')) return 'unknown';
          }
          const outcome = expression(property.value, scopes, children);
          if (outcome !== 'next') return outcome;
        }
      }
      return 'next';
    }
    if (value.type === 'CallExpression') return call(value, scopes, children);
    if (value.type === 'UnaryExpression' && value.operator === 'void')
      return expression(value.argument, scopes, children);
    if (isValueOperation(value)) return evaluate(value, scopes, children, (read) => operationValue(value, read));
    if (value.type === 'Identifier') {
      const declaration = file.values.declarationOf(value.name, scopes);
      const binding = parameters.findLast((entry) => entry.fn === declaration);
      if (binding) return binding.initialized.has(value.name) ? 'next' : 'throw';
      if ((!declaration && value.name === 'undefined') || argument(value, scopes)) return 'next';
    }
    return completesWithoutThrowing(value) ? 'next' : 'unknown';
  }
  function statement(node: Statement, scopes: readonly Node[], children: Children): Completion {
    if (--remaining < 0) return 'unknown';
    switch (node.type) {
      case 'BlockStatement': {
        const inside = [...scopes, node];
        const entry = { block: node, at: node.start };
        active.push(entry);
        let result: Completion = 'next';
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
          if (id.type !== 'Identifier') return 'unknown';
          if (init) {
            const outcome = expression(init, scopes, children);
            if (outcome !== 'next') return outcome;
          }
        }
        return 'next';
      case 'ExpressionStatement':
        return expression(node.expression, scopes, children);
      case 'ReturnStatement': {
        const result = node.argument ? expression(node.argument, scopes, children) : 'next';
        return result === 'next' ? { returned: node.argument ? valueOf(node.argument, scopes) : omitted } : result;
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
  return { expression, statement, suite, valueOf };
}

export function registrationExit(
  root: BlockStatement | SuiteCall,
  outer: readonly Node[],
  file: FileContext,
): Flow | 'return' {
  const flow = registrationFlow('call' in root ? root.call.start : root.start, outer, file);
  const end =
    'call' in root
      ? flow.suite(root.fn, root.definition, root.plain)
      : flow.statement(root, outer, { registered: false });
  return typeof end === 'object' ? 'return' : end;
}

/** Read a value at registration time, including the result of a synchronous local helper. */
export function jasmineValue(expression: Expression, scopes: readonly Node[], file: FileContext): Resolved {
  const node = unwrap(expression);
  const resolved = file.values.resolve(node, scopes);
  if (!resolved.ok && (node.type === 'ArrayExpression' || node.type === 'CallExpression' || isValueOperation(node))) {
    const flow = registrationFlow(node.start, scopes, file);
    if (flow.expression(node, scopes, { registered: false }) === 'next') return flow.valueOf(node, scopes);
  }
  return resolved;
}

/** Specs replace falsy descriptions with an empty string. Suite paths keep false and zero. */
export function jasmineTitleValue(title: JasmineArgument, file: FileContext, spec: boolean): Resolved | undefined {
  const node = title.node;
  if (node.type === 'SpreadElement') return undefined;
  const resolved = title.resolved ?? jasmineValue(node, title.scopes, file);
  const literal = node.type === 'UnaryExpression' && node.operator === '-' ? unwrap(node.argument) : node;
  if (literal.type === 'Literal' && typeof literal.value === 'bigint') {
    const value = node === literal ? literal.value : -literal.value;
    return { ok: true, value: spec && !value ? '' : String(value) };
  }
  if (!resolved.ok) return resolved;
  const text = spec && !resolved.value ? '' : descriptionText(resolved.value);
  return text === undefined ? resolved : { ok: true, value: text };
}
