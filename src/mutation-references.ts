import type {
  ArrayExpression,
  AssignmentTarget,
  AssignmentTargetMaybeDefault,
  BindingPattern,
  CallExpression,
  Expression,
  Node,
} from 'oxc-parser';
import type { mutationCalls } from './mutation-calls.ts';
import { isFunctionNode, propertyKey, propertyName, returnValues, unwrapChain, type FunctionNode } from './ast.ts';

type Key = string | null;
interface Site {
  scopes: readonly Node[];
  /** The top-level declaration or expression being evaluated, when the relative order is known. */
  statement: Node | null;
}
export interface MutationTarget extends Site {
  owner: Node;
  value: Expression;
}
export interface AliasBinding extends Site {
  pattern: BindingPattern | AssignmentTarget;
  source: Expression;
  end: number;
  replaces: boolean;
}
export type InvocationMode = 'direct' | 'call' | 'apply' | 'reflect' | 'own';
export interface HelperSite extends Site {
  mode: InvocationMode;
  methodOwner?: Expression;
  bound?: CapturedCall[];
  call: CallExpression;
  fn: FunctionNode;
  parameterScopes: readonly Node[];
}
export interface CapturedCall extends Site {
  factory?: HelperInvocation;
  repeated?: boolean;
  call: CallExpression;
  caller: CallbackContext;
}
export interface ScopedFunction {
  factory?: HelperInvocation;
  bound?: CapturedCall[];
  fn: FunctionNode;
  scopes: readonly Node[];
}
export interface CallbackChoice {
  targets: ScopedFunction[];
  /** Every possible value is a known function, so a parameter default cannot be used. */
  definite: boolean;
}
export interface CallbackContext {
  factory?: HelperInvocation;
  factories: Map<CallExpression, HelperInvocation>;
  owner: Node;
  functions: Map<string, CallbackChoice>;
  id: number;
  ancestors: Map<CallExpression, CallbackContext>;
}
export interface ParameterSource extends Site {
  name: string;
  ref: Reference;
  fromDefault: boolean;
}
export interface HelperInvocation extends HelperSite {
  /** Every possible callee at this site is known in the calling context. */
  complete: boolean;
  id: number;
  key: string;
  caller: CallbackContext;
  context: CallbackContext;
  parameters: ParameterSource[];
}
/** The invocation whose local bindings a nested function captured. */
export function enclosingFactory(context: CallbackContext | undefined, owner: Node): HelperInvocation | undefined {
  for (let frame = context?.factory; frame; frame = frame.context.factory) if (frame.fn === owner) return frame;
  return undefined;
}

interface AliasSource extends Site {
  ref: Reference;
  end: number | null;
  replaces: boolean;
  invocation?: HelperInvocation;
  context?: CallbackContext;
}
export interface Reference {
  value: Expression;
  path: Key[];
  capture?: CapturedCall;
  accessor?: 'get' | 'set';
  counterpart?: Expression;
  parts?: ArgumentPart[];
  /** A rest binding is a shallow copy. Array rest starts at this index in the original array. */
  rest?: number;
}

interface ArgumentPart {
  list: Reference;
  offset: number;
  size: number | null;
}

const direct = (value: Expression): Reference => ({ value: unwrapChain(value), path: [] });
export const DEFINED = new Set<Node['type']>([
  'Literal',
  'ArrayExpression',
  'ObjectExpression',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ClassExpression',
  'TemplateLiteral',
]);

export function memberKey(member: Extract<Expression, { type: 'MemberExpression' }>): Key {
  const key = member.property;
  return key.type === 'Literal' && typeof key.value === 'number' ? String(key.value) : propertyName(member);
}

/** Which operand supplies a reference when the condition can be decided without reading mutable bindings. */
export function referenceOperands(
  value: Extract<Expression, { type: 'ConditionalExpression' | 'LogicalExpression' }>,
  evaluatedTest?: Expression,
): Expression[] {
  const conditional = value.type === 'ConditionalExpression';
  const test = unwrapChain(evaluatedTest ?? (conditional ? value.test : value.left));
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
export function* property(ref: Reference, key: Key): Generator<Reference | null, void> {
  for (const source of propertySources(ref, key)) {
    yield source && ref.capture ? { ...source, capture: ref.capture } : source;
  }
}

function* propertySources(ref: Reference, key: Key): Generator<Reference | null, void> {
  const value = ref.value;
  if (ref.parts) {
    let position = key === null ? null : Number(key);
    for (const { list, offset, size } of ref.parts) {
      const repeats = list.capture?.repeated && size !== null && size > 0;
      if (position === null || size === null || position < size || repeats) {
        const at = position !== null && repeats ? position % size : position;
        yield* property(list, at === null ? null : String(at + offset));
        if (position !== null && size !== null && position < size) return;
      }
      position = repeats || position === null || size === null ? null : position - size;
    }
    yield null;
    return;
  }
  if (ref.path.length || (value.type !== 'ObjectExpression' && value.type !== 'ArrayExpression')) {
    yield { value, path: [...ref.path, key] };
    return;
  }
  if (value.type === 'ObjectExpression') {
    for (let index = value.properties.length - 1; index >= 0; index--) {
      const entry = value.properties[index];
      if (entry.type === 'SpreadElement') {
        let mayMiss = false;
        for (const source of property(direct(entry.argument), key)) {
          if (!source || source.path.length) mayMiss = true;
          if (source) yield source;
        }
        if (!mayMiss) return;
        continue;
      }
      const name = propertyKey(entry);
      if (key !== null && name !== null && key !== name) continue;
      const child = direct(entry.value);
      if (entry.kind !== 'init') {
        child.accessor = entry.kind;
        // Defining the other half of an accessor retains its previous getter or setter.
        if (key !== null && key === name)
          for (let prior = index - 1; prior >= 0; prior--) {
            const earlier = value.properties[prior];
            if (earlier.type === 'SpreadElement') break;
            const previousKey = propertyKey(earlier);
            if (previousKey !== key && previousKey !== null) continue;
            if (earlier.kind === 'init') break;
            if (earlier.kind !== entry.kind) {
              child.counterpart = earlier.value;
              break;
            }
          }
      }
      yield child;
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
function suppliedMember(ref: Reference, invocation: HelperSite): boolean {
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
  defined?: (ref: Reference) => boolean,
): void {
  if (pattern.type === 'AssignmentPattern') {
    if (ref) bind(pattern.left, ref, add, defined);
    if (!ref || ((ref.path.length || !DEFINED.has(ref.value.type)) && !defined?.(ref)))
      bind(
        pattern.left,
        direct(pattern.right),
        (name, value) => {
          add(name, value, true);
        },
        defined,
      );
  } else if (!ref) return;
  else if (pattern.type === 'Identifier') add(pattern.name, ref);
  else if (pattern.type === 'ObjectPattern') {
    for (const entry of pattern.properties) {
      if (entry.type === 'RestElement') bind(entry.argument, { ...ref, rest: 0 }, add, defined);
      else for (const child of property(ref, propertyKey(entry))) bind(entry.value, child, add, defined);
    }
  } else if (pattern.type === 'ArrayPattern') {
    for (const [index, item] of pattern.elements.entries()) {
      if (!item) continue;
      if (item.type === 'RestElement') bind(item.argument, { ...ref, rest: index }, add, defined);
      else for (const child of property(ref, String(index))) bind(item, child, add, defined);
    }
  }
}

/** References extracted once when a module evaluates a constant destructuring declaration. */
export function patternReferences(pattern: BindingPattern, source: Expression, scopes: readonly Node[]) {
  const entries = new Map<string, { ref: Reference; fromDefault?: boolean }[]>();
  bind(pattern, direct(source), (name, ref, fromDefault) => {
    const options = entries.get(name);
    const option = { ref, fromDefault };
    if (options) options.push(option);
    else entries.set(name, [option]);
  });
  return { entries, scopes };
}

/** Reflect.apply takes its target and receiver from the same expanded list as its argument array. */
export function* literalArguments(
  elements: ArrayExpression['elements'],
): Generator<ArrayExpression['elements'][number], void> {
  for (const element of elements) {
    const spread = element?.type === 'SpreadElement' && unwrapChain(element.argument);
    if (spread && spread.type === 'ArrayExpression') yield* literalArguments(spread.elements);
    else yield element;
  }
}

function argumentPart(list: Reference, offset: number): ArgumentPart {
  const array = list.value;
  if (list.path.length || array.type !== 'ArrayExpression') return { list, offset, size: null };
  const elements = [...literalArguments(array.elements)];
  if (elements.slice(0, offset).some((item) => item?.type === 'SpreadElement')) return { list, offset, size: null };
  const rest = elements.slice(offset);
  return {
    list: { ...list, value: { ...array, elements: rest } },
    offset: 0,
    size: rest.some((item) => item?.type === 'SpreadElement') ? null : rest.length,
  };
}

/** Bind positional, rest and default references once for both callback discovery and write tracking. */
export function helperParameters(
  site: HelperSite,
  isDefined: (expression: Expression, capture?: CapturedCall) => boolean,
): ParameterSource[] {
  const { call, fn, scopes, statement, parameterScopes } = site;
  const elements = site.mode === 'reflect' ? [...literalArguments(call.arguments)] : call.arguments;
  const args = direct({ type: 'ArrayExpression', elements, start: call.start, end: call.end });
  const parameters: ParameterSource[] = [];
  const add = (name: string, ref: Reference, fromDefault = false) => {
    parameters.push({
      name,
      ref,
      fromDefault,
      scopes: fromDefault ? parameterScopes : scopes,
      statement: fromDefault ? null : statement,
    });
  };
  const defined = (ref: Reference) =>
    (!ref.path.length && isDefined(ref.value, ref.capture)) || suppliedMember(ref, site);
  const bound = (site.bound ?? []).map((capture) => ({
    ...direct({
      type: 'ArrayExpression',
      elements: [...literalArguments(capture.call.arguments)],
      start: capture.call.start,
      end: capture.call.end,
    }),
    capture,
  }));
  const receiverIndex = site.mode === 'reflect' ? 1 : 0;
  if (fn.type !== 'ArrowFunctionExpression') {
    if (bound.length) {
      for (const receiver of property(bound[0], '0')) if (receiver) add('this', receiver);
    } else if (site.methodOwner) add('this', direct(site.methodOwner));
    else if (site.mode !== 'direct') {
      for (const receiver of property(args, String(receiverIndex))) if (receiver) add('this', receiver);
    }
  }
  const lists = site.mode === 'apply' || site.mode === 'reflect' ? property(args, String(receiverIndex + 1)) : [args];
  const offset = site.mode === 'call' ? 1 : 0;
  for (const supplied of lists) {
    const list = bound.length
      ? {
          ...args,
          parts: [...bound.map((ref) => argumentPart(ref, 1)), ...(supplied ? [argumentPart(supplied, offset)] : [])],
        }
      : supplied;
    const start = bound.length ? 0 : offset;
    for (const [index, parameter] of fn.params.entries()) {
      if (parameter.type === 'RestElement') {
        if (list) bind(parameter.argument, { ...list, rest: index + start }, add);
      } else if (list) {
        for (const source of property(list, String(index + start))) bind(parameter, source, add, defined);
      } else bind(parameter, null, add, defined);
    }
  }
  return parameters;
}

/** Follow the container of each write. Replacing a copy's property and mutating a shared child have different owners. */
export function changedReferences(
  declarations: AliasBinding[],
  targets: MutationTarget[],
  { calls, callTimes, returnedContexts, memberSources }: ReturnType<typeof mutationCalls>,
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
  for (const invocations of calls.values()) {
    for (const invocation of invocations) {
      for (const parameter of invocation.parameters) {
        add(parameter.name, invocation.parameterScopes, {
          ...parameter,
          end: null,
          replaces: false,
          invocation,
          context: parameter.fromDefault ? invocation.context : invocation.caller,
        });
      }
    }
  }
  const activeRoots = new Set<Node>();
  const returning: { invocation: HelperInvocation; time: number | null; active: Set<Node> }[] = [];
  const follow = (
    ref: Reference,
    suffix: { key: Key; time: number | null }[],
    site: Site,
    context?: CallbackContext,
    factory?: HelperInvocation,
  ): void => {
    if (ref.capture) {
      site = ref.capture;
      context = ref.capture.caller;
      factory = ref.capture.factory;
    }
    if (ref.rest !== undefined && suffix.length === 0) return;
    const owner = site.scopes.findLast((scope) => scope.type === 'FunctionDeclaration' || isFunctionNode(scope));
    const frame = returning.findLast((entry) => entry.invocation.fn === owner);
    const time = site.statement ? ref.value.start : frame ? frame.time : owner ? (callTimes.get(owner) ?? null) : null;
    const path = [...ref.path.map((key) => ({ key, time })), ...suffix];
    if (ref.rest && suffix[0].key !== null)
      path[ref.path.length] = { ...suffix[0], key: String(Number(suffix[0].key) + ref.rest) };
    let value = ref.value;
    while (value.type === 'MemberExpression') {
      path.unshift({ key: memberKey(value), time });
      value = unwrapChain(value.object);
    }
    if (value.type === 'Identifier' || value.type === 'ThisExpression') {
      const key = bindingKey(value.type === 'ThisExpression' ? 'this' : value.name, site.scopes);
      if (key === null) return;
      names.add(key);
      const sources = bindings.get(key);
      const active = returning.at(-1)?.active ?? activeRoots;
      if (!sources || active.has(value)) return;
      active.add(value);
      // Only an unconditional module-level assignment rules out earlier top-level sources.
      const readAt = time;
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
          if (
            context?.owner === invocation.fn &&
            context !== invocation.context &&
            !(ref.capture?.repeated && invocation.context.ancestors.has(ref.capture.call))
          )
            continue;
          const captured = factory?.fn === invocation.fn ? factory : enclosingFactory(context, invocation.fn);
          if (captured && captured !== invocation) continue;
          const frame = returning.findLast((frame) => frame.invocation.fn === invocation.fn)?.invocation;
          if (frame && frame !== invocation) continue;
        }
        follow(source.ref, path, source, source.context ?? context, invocation === factory ? undefined : factory);
      }
      active.delete(value);
    } else if (value.type === 'CallExpression') {
      for (const invocation of calls.get(value) ?? []) {
        if (context?.owner === invocation.caller.owner && context !== invocation.caller) continue;
        if (returning.some((frame) => frame.invocation === invocation)) continue;
        const returns = returnValues(invocation.fn, false, 'ignore');
        if (!returns) continue;
        returning.push({ invocation, time, active: new Set() });
        for (const result of returns)
          follow(
            direct(result.expression),
            path,
            { scopes: [...invocation.parameterScopes, ...result.around], statement: null },
            invocation.context,
            factory,
          );
        returning.pop();
      }
    } else if (value.type === 'ConditionalExpression' || value.type === 'LogicalExpression') {
      for (const source of referenceOperands(value)) follow(direct(source), path, site, context, factory);
    } else if (value.type === 'SequenceExpression') {
      follow(direct(value.expressions[value.expressions.length - 1]), path, site, context, factory);
    } else if (value.type === 'AssignmentExpression' && value.operator === '=') {
      follow(direct(value.right), path, site, context, factory);
    } else if (path.length && (value.type === 'ObjectExpression' || value.type === 'ArrayExpression')) {
      const [{ key, time }, ...rest] = path;
      const sources =
        value.type === 'ArrayExpression' && !ref.parts
          ? memberSources(value, site.scopes, key, time)
          : Array.from(property({ value, path: [], parts: ref.parts }, key), (child) => ({
              ref: child,
              scopes: site.scopes,
            }));
      for (const child of sources)
        if (child.ref) follow(child.ref, rest, { ...site, scopes: child.scopes }, context, factory);
    }
  };
  for (const target of targets) {
    const contexts = returnedContexts.get(target.owner);
    if (contexts) for (const context of contexts) follow(direct(target.value), [], target, context);
    else follow(direct(target.value), [], target);
  }
  return names;
}
