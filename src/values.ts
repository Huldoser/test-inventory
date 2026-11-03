import type { Expression, Node, TSEnumDeclaration } from 'oxc-parser';
import { childNodes, isFunctionNode, propertyName, unwrap, type FunctionNode } from './ast.ts';

export type Value = string | number | boolean | null | undefined | Value[] | { [key: string]: Value };

/** A value worked out from the file, or the reason it could not be. `importedFrom` names the module it came from. */
export type Resolved = { ok: true; value: Value } | { ok: false; importedFrom: string | null };

/** What a name is bound to, and the node that declares it: a declarator, import specifier, function or parameter list. */
type Binding = { declaration: Node } & (
  | { kind: 'const'; init: Expression; scopes: Node[] }
  | { kind: 'enum'; node: TSEnumDeclaration; scopes: Node[] }
  /** `imported` is null for `import * as name`. */
  | { kind: 'import'; source: string; imported: string | null }
  | { kind: 'function' }
  | { kind: 'other' }
);

const UNRESOLVED: Resolved = { ok: false, importedFrom: null };

/** What another module exports under a name, `default` included, for an import of the file. */
export type ImportReader = (source: string, name: string) => Resolved;

/** A function read at one of its calls: what each of its simple parameters is given there. */
interface BoundCall {
  fn: Node;
  parameters: Map<string, () => Resolved>;
  /** Constants are worked out again for each call, since they may be built from the parameters. */
  cache: Map<Expression, Resolved>;
}

function isPrimitive(value: Value): value is string | number | boolean | null | undefined {
  return typeof value !== 'object' || value === null;
}

/** Whether a value can be used as a property name. */
export function isKey(value: Value): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

export function isScopeNode(node: Node): boolean {
  switch (node.type) {
    case 'Program':
    case 'BlockStatement':
    case 'StaticBlock':
    case 'TSModuleBlock':
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'CatchClause':
      return true;
    default:
      return false;
  }
}

export function bindingNames(pattern: Node | null, names: string[] = []): string[] {
  switch (pattern?.type) {
    case 'Identifier':
      names.push(pattern.name);
      break;
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        bindingNames(property.type === 'RestElement' ? property.argument : property.value, names);
      }
      break;
    case 'ArrayPattern':
      for (const element of pattern.elements) bindingNames(element, names);
      break;
    case 'AssignmentPattern':
      bindingNames(pattern.left, names);
      break;
    case 'RestElement':
      bindingNames(pattern.argument, names);
      break;
    case 'TSParameterProperty':
      bindingNames(pattern.parameter, names);
      break;
  }
  return names;
}

/** Works out values written in the same file: literals, constants, enums, and arrays and objects built from them. */
export class Values {
  private readonly bindingsByScope = new Map<Node, Map<string, Binding>>();
  private readonly cache = new Map<Expression, Resolved>();
  private readonly pending = new Set<Expression>();
  /** The functions being read at one of their calls, innermost last. */
  private readonly calls: BoundCall[] = [];
  private readonly imports: ImportReader | null;
  private readonly assigned = new WeakMap<Node, Set<string>>();
  private readonly changed = new WeakMap<Node, Set<string>>();

  /** Without `imports`, a value imported from another module is not worked out. */
  constructor(imports: ImportReader | null = null) {
    this.imports = imports;
  }

  /**
   * Runs `read` with a function's parameters bound to the arguments of one call, worked out where the call is, so that
   * titles and values built from them resolve, as in `test(\`${side} rejects a zero quantity\`)` inside
   * `validatesQuantity('buy')`. `args` stop at a spread argument, after which no position is known. A missing argument
   * takes the parameter's default value, worked out in `scopes`, the scopes around the function.
   */
  withArguments<T>(fn: FunctionNode, args: readonly Resolved[], scopes: readonly Node[], read: () => T): T {
    const parameters = new Map<string, () => Resolved>();
    for (const [index, parameter] of fn.params.entries()) {
      this.bind(parameter, args.at(index), parameters, [...scopes, fn]);
    }
    // A parameter the function assigns to may hold another value by the time it is read.
    for (const name of this.assignedIn(fn.body as Node)) parameters.delete(name);
    return this.withBound(fn, parameters, read);
  }

  /**
   * Runs `read` with the names a loop declares bound to one of the values it goes over, as in
   * `for (const [tier, bps] of Object.entries(FEES))`. `declarator` is the loop's variable declarator.
   */
  withLoopValue<T>(
    declarator: Node,
    pattern: Node,
    value: Resolved,
    body: Node,
    scopes: readonly Node[],
    read: () => T,
  ): T {
    const names = new Map<string, () => Resolved>();
    this.bind(pattern, value, names, scopes);
    for (const name of this.assignedIn(body)) names.delete(name);
    return this.withBound(declarator, names, read);
  }

  private assignedIn(body: Node): Set<string> {
    let names = this.assigned.get(body);
    if (!names) {
      names = assignedNames(body);
      this.assigned.set(body, names);
    }
    return names;
  }

  private withBound<T>(fn: Node, parameters: Map<string, () => Resolved>, read: () => T): T {
    this.calls.push({ fn, parameters, cache: new Map() });
    try {
      return read();
    } finally {
      this.calls.pop();
    }
  }

  /**
   * Binds the names of a parameter or a loop variable to the parts of `value` they take, as destructuring does. A
   * missing `value`, after a spread argument, leaves them unknown, unless a default gives them one.
   */
  private bind(
    pattern: Node,
    value: Resolved | undefined,
    names: Map<string, () => Resolved>,
    scopes: readonly Node[],
  ): void {
    switch (pattern.type) {
      case 'Identifier':
        if (value) names.set(pattern.name, () => value);
        return;
      case 'AssignmentPattern': {
        const useDefault = !value || (value.ok && value.value === undefined);
        if (!useDefault) return this.bind(pattern.left, value, names, scopes);
        const fallback = pattern.right;
        if (pattern.left.type === 'Identifier') {
          names.set(pattern.left.name, () => this.resolve(fallback, scopes));
          return;
        }
        return this.bind(pattern.left, this.resolve(fallback, scopes), names, scopes);
      }
      case 'ArrayPattern':
        for (const [index, element] of pattern.elements.entries()) {
          if (!element || !value) continue;
          const list = value.ok && Array.isArray(value.value) ? value.value : null;
          const part = (rest: boolean): Resolved =>
            list ? { ok: true, value: rest ? list.slice(index) : list[index] } : value.ok ? UNRESOLVED : value;
          if (element.type === 'RestElement') this.bind(element.argument, part(true), names, scopes);
          else this.bind(element, part(false), names, scopes);
        }
        return;
      case 'ObjectPattern': {
        if (!value) return;
        const object = value.ok && isPlainObject(value.value) ? value.value : null;
        const taken: string[] = [];
        for (const property of pattern.properties) {
          if (property.type === 'RestElement') {
            const rest = object && Object.fromEntries(Object.entries(object).filter(([key]) => !taken.includes(key)));
            this.bind(
              property.argument,
              rest ? { ok: true, value: rest } : value.ok ? UNRESOLVED : value,
              names,
              scopes,
            );
            continue;
          }
          const key = this.propertyKey(property.key, property.computed, scopes);
          const name = key.ok && isKey(key.value) ? String(key.value) : null;
          if (name !== null) taken.push(name);
          const part: Resolved =
            object && name !== null ? { ok: true, value: object[name] } : value.ok ? UNRESOLVED : value;
          this.bind(property.value, part, names, scopes);
        }
        return;
      }
    }
  }

  /** `scopes` lists the scope nodes around the expression, outermost first. */
  resolve(node: Expression, scopes: readonly Node[]): Resolved {
    const expression = unwrap(node);
    switch (expression.type) {
      case 'Literal':
        return 'regex' in expression || 'bigint' in expression ? UNRESOLVED : { ok: true, value: expression.value };
      case 'TemplateLiteral': {
        // Only tagged templates can lack a cooked value, so these strings are always present.
        let text = expression.quasis[0].value.cooked as string;
        for (const [index, part] of expression.expressions.entries()) {
          const resolved = this.resolve(part, scopes);
          if (!resolved.ok) return resolved;
          if (!isPrimitive(resolved.value)) return UNRESOLVED;
          text += String(resolved.value) + (expression.quasis[index + 1].value.cooked as string);
        }
        return { ok: true, value: text };
      }
      case 'BinaryExpression': {
        if (!BINARY.has(expression.operator)) return UNRESOLVED;
        const left = this.resolve(expression.left as Expression, scopes);
        if (!left.ok) return left;
        const right = this.resolve(expression.right, scopes);
        if (!right.ok) return right;
        if (!isPrimitive(left.value) || !isPrimitive(right.value)) return UNRESOLVED;
        return binary(expression.operator, left.value, right.value);
      }
      case 'LogicalExpression': {
        const left = this.resolve(expression.left, scopes);
        if (!left.ok) return left;
        const useLeft =
          expression.operator === '&&'
            ? !left.value
            : expression.operator === '||'
              ? Boolean(left.value)
              : left.value !== null && left.value !== undefined;
        return useLeft ? left : this.resolve(expression.right, scopes);
      }
      case 'ConditionalExpression': {
        const test = this.resolve(expression.test, scopes);
        if (!test.ok) return test;
        return this.resolve(test.value ? expression.consequent : expression.alternate, scopes);
      }
      case 'CallExpression':
        return this.call(expression, scopes);
      case 'UnaryExpression': {
        if (expression.operator !== '!' && expression.operator !== '-') return UNRESOLVED;
        const argument = this.resolve(expression.argument, scopes);
        if (!argument.ok) return argument;
        if (expression.operator === '!') return { ok: true, value: !argument.value };
        return typeof argument.value === 'number' ? { ok: true, value: -argument.value } : UNRESOLVED;
      }
      case 'ArrayExpression': {
        const items: Value[] = [];
        for (const element of expression.elements) {
          if (element === null) return UNRESOLVED;
          const resolved = this.resolve(element.type === 'SpreadElement' ? element.argument : element, scopes);
          if (!resolved.ok) return resolved;
          if (element.type !== 'SpreadElement') {
            items.push(resolved.value);
          } else if (Array.isArray(resolved.value)) {
            items.push(...resolved.value);
          } else {
            return UNRESOLVED;
          }
        }
        return { ok: true, value: items };
      }
      case 'ObjectExpression': {
        const object: Record<string, Value> = {};
        for (const property of expression.properties) {
          if (property.type === 'SpreadElement') {
            const spread = this.resolve(property.argument, scopes);
            if (!spread.ok) return spread;
            if (!isPlainObject(spread.value)) return UNRESOLVED;
            Object.assign(object, spread.value);
            continue;
          }
          if (property.kind !== 'init' || property.method) return UNRESOLVED;
          const key = this.propertyKey(property.key, property.computed, scopes);
          if (!key.ok) return key;
          if (!isKey(key.value)) return UNRESOLVED;
          const value = this.resolve(property.value, scopes);
          if (!value.ok) return value;
          object[String(key.value)] = value.value;
        }
        return { ok: true, value: object };
      }
      case 'Identifier':
        return this.resolveName(expression.name, scopes);
      case 'MemberExpression': {
        const namespace = this.namespaceMember(expression, scopes);
        if (namespace) return namespace;
        const object = this.resolve(expression.object, scopes);
        if (!object.ok) return object;
        const key = expression.computed
          ? this.resolve(expression.property, scopes)
          : { ok: true as const, value: propertyName(expression) };
        if (!key.ok) return key;
        const container = object.value;
        if (typeof container === 'string' && key.value === 'length') return { ok: true, value: container.length };
        if (typeof container !== 'object' || container === null || !isKey(key.value)) return UNRESOLVED;
        const name = String(key.value);
        return Object.hasOwn(container, name)
          ? { ok: true, value: (container as Record<string, Value>)[name] }
          : UNRESOLVED;
      }
      default:
        return UNRESOLVED;
    }
  }

  /**
   * The node that declares a name where it is used, such as an import specifier or a variable declarator; null when
   * the file does not declare it, as with globals.
   */
  declarationOf(name: string, scopes: readonly Node[]): Node | null {
    return this.lookup(name, scopes)?.binding.declaration ?? null;
  }

  /** The value a `const` name is declared with, and the scopes around that declaration; null for any other name. */
  constantOf(name: string, scopes: readonly Node[]): { init: Expression; scopes: readonly Node[] } | null {
    const binding = this.lookup(name, scopes)?.binding;
    return binding?.kind === 'const' ? { init: binding.init, scopes: binding.scopes } : null;
  }

  /** The module a name is imported from where it is used; null when it isn't an import. */
  importSource(name: string, scopes: readonly Node[]): string | null {
    const binding = this.lookup(name, scopes)?.binding;
    return binding?.kind === 'import' ? binding.source : null;
  }

  /** Whether a name refers to a function or class declared in the file. */
  isFunction(name: string, scopes: readonly Node[]): boolean {
    return this.lookup(name, scopes)?.binding.kind === 'function';
  }

  private propertyKey(key: Node, computed: boolean, scopes: readonly Node[]): Resolved {
    if (computed) return this.resolve(key as Expression, scopes);
    if (key.type === 'Identifier') return { ok: true, value: key.name };
    return this.resolve(key as Expression, scopes);
  }

  /**
   * The calls titles are often built with, all of them pure: `Object.keys()`, `Object.values()`, `Object.entries()`,
   * `JSON.stringify()` with one argument, `String()`, and a string's `toUpperCase()`, `toLowerCase()` and `trim()` and
   * an array's `join()`.
   */
  private call(expression: Extract<Expression, { type: 'CallExpression' }>, scopes: readonly Node[]): Resolved {
    const callee = unwrap(expression.callee);
    if (expression.optional || expression.arguments.some((item) => item.type === 'SpreadElement')) return UNRESOLVED;
    const args = expression.arguments as Expression[];
    if (
      callee.type === 'Identifier' &&
      callee.name === 'String' &&
      args.length === 1 &&
      this.isGlobal('String', scopes)
    ) {
      const value = this.resolve(args[0], scopes);
      return value.ok && isPrimitive(value.value)
        ? { ok: true, value: String(value.value) }
        : value.ok
          ? UNRESOLVED
          : value;
    }
    if (callee.type !== 'MemberExpression' || callee.computed) return UNRESOLVED;
    const method = propertyName(callee) as string;
    const target = unwrap(callee.object);
    if (target.type === 'Identifier' && (target.name === 'Object' || target.name === 'JSON')) {
      if (!this.isGlobal(target.name, scopes) || args.length !== 1) return UNRESOLVED;
      const value = this.resolve(args[0], scopes);
      if (!value.ok) return value;
      if (target.name === 'JSON')
        return method === 'stringify' ? { ok: true, value: JSON.stringify(value.value) } : UNRESOLVED;
      if (!isPlainObject(value.value) && !Array.isArray(value.value)) return UNRESOLVED;
      if (method === 'keys') return { ok: true, value: Object.keys(value.value) };
      if (method === 'values') return { ok: true, value: Object.values(value.value) };
      return method === 'entries' ? { ok: true, value: Object.entries(value.value) } : UNRESOLVED;
    }
    const object = this.resolve(callee.object, scopes);
    if (!object.ok) return object;
    const text = object.value;
    if (typeof text === 'string' && args.length === 0 && STRING_METHODS.has(method)) {
      return {
        ok: true,
        value: method === 'trim' ? text.trim() : method === 'toUpperCase' ? text.toUpperCase() : text.toLowerCase(),
      };
    }
    if (!Array.isArray(text) || method !== 'join' || args.length > 1 || !text.every(isPrimitive)) return UNRESOLVED;
    const separator = args.length === 0 ? { ok: true as const, value: ',' } : this.resolve(args[0], scopes);
    if (!separator.ok) return separator;
    return typeof separator.value === 'string' ? { ok: true, value: text.join(separator.value) } : UNRESOLVED;
  }

  /** Whether a name refers to a global, as no scope around the use declares it. */
  private isGlobal(name: string, scopes: readonly Node[]): boolean {
    return this.lookup(name, scopes) === null;
  }

  /** `data.name` where `data` is `import * as data`: what the module exports as `name`; null for any other member. */
  private namespaceMember(
    expression: Extract<Expression, { type: 'MemberExpression' }>,
    scopes: readonly Node[],
  ): Resolved | null {
    const object = unwrap(expression.object);
    if (object.type !== 'Identifier') return null;
    const binding = this.lookup(object.name, scopes)?.binding;
    if (binding?.kind !== 'import' || binding.imported !== null) return null;
    const key = expression.computed
      ? this.resolve(expression.property, scopes)
      : { ok: true as const, value: propertyName(expression) };
    if (!key.ok || !isKey(key.value)) return { ok: false, importedFrom: binding.source };
    return this.imported(binding.source, String(key.value));
  }

  private imported(source: string, name: string | null): Resolved {
    const resolved = name !== null && this.imports ? this.imports(source, name) : UNRESOLVED;
    return resolved.ok ? resolved : { ok: false, importedFrom: source };
  }

  /** What a name refers to where it is used; `scopes` lists the scope nodes around the use, outermost first. */
  resolveName(name: string, scopes: readonly Node[]): Resolved {
    const found = this.lookup(name, scopes);
    if (!found) return name === 'undefined' ? { ok: true, value: undefined } : UNRESOLVED;
    const { binding } = found;
    switch (binding.kind) {
      case 'const':
        if (this.changedAtLoad(binding.scopes[0]).has(name)) return UNRESOLVED;
        return this.resolveConstant(binding.init, binding.scopes);
      case 'enum':
        return { ok: true, value: this.enumMembers(binding.node, binding.scopes) };
      case 'import':
        return this.imported(binding.source, binding.imported);
      case 'function':
        return UNRESOLVED;
      case 'other':
        return this.resolveParameter(name, binding.declaration);
    }
  }

  /** A parameter of a function read at one of its calls: the argument given there. */
  private resolveParameter(name: string, fn: Node): Resolved {
    const call = this.calls.findLast((item) => item.fn === fn);
    return call?.parameters.get(name)?.() ?? UNRESOLVED;
  }

  /** Constants the module's top-level code changes, as in `WATCHED.push('MSFT')`, whose declared value isn't the one used. */
  private changedAtLoad(program: Node): Set<string> {
    let names = this.changed.get(program);
    if (!names) {
      names = changedNames(program);
      this.changed.set(program, names);
    }
    return names;
  }

  private resolveConstant(init: Expression, scopes: readonly Node[]): Resolved {
    const cache = this.calls.at(-1)?.cache ?? this.cache;
    const cached = cache.get(init);
    if (cached) return cached;
    if (this.pending.has(init)) return UNRESOLVED;
    this.pending.add(init);
    const resolved = this.resolve(init, scopes);
    this.pending.delete(init);
    cache.set(init, resolved);
    return resolved;
  }

  private enumMembers(node: TSEnumDeclaration, scopes: readonly Node[]): Record<string, Value> {
    const members: Record<string, Value> = {};
    let next: number | null = 0;
    for (const member of node.body.members) {
      const name: Resolved =
        member.id.type === 'Identifier' ? { ok: true, value: member.id.name } : this.resolve(member.id, scopes);
      const resolved: Resolved = member.initializer
        ? this.resolve(member.initializer, scopes)
        : { ok: true, value: next };
      if (name.ok && isKey(name.value) && resolved.ok && isKey(resolved.value)) {
        members[String(name.value)] = resolved.value;
        // TypeScript maps a numeric member's value back to its name too.
        if (typeof resolved.value === 'number') members[String(resolved.value)] = String(name.value);
        next = typeof resolved.value === 'number' ? resolved.value + 1 : null;
      } else {
        next = null;
      }
    }
    return members;
  }

  private lookup(name: string, scopes: readonly Node[]): { binding: Binding } | null {
    for (let index = scopes.length - 1; index >= 0; index--) {
      const binding = this.bindings(scopes[index], scopes.slice(0, index + 1)).get(name);
      if (binding) return { binding };
    }
    return null;
  }

  private bindings(scope: Node, scopes: Node[]): Map<string, Binding> {
    let bindings = this.bindingsByScope.get(scope);
    if (!bindings) {
      bindings = collectBindings(scope, scopes);
      this.bindingsByScope.set(scope, bindings);
    }
    return bindings;
  }
}

const BINARY = new Set(['+', '-', '*', '/', '%', '===', '!==', '<', '<=', '>', '>=']);

const ARITHMETIC = new Set(['-', '*', '/', '%']);

const STRING_METHODS = new Set(['toUpperCase', 'toLowerCase', 'trim']);

type Primitive = string | number | boolean | null | undefined;

/**
 * A binary operator on two primitives, as JavaScript works it out; arithmetic only on numbers, as in
 * `30 * 1000`, and comparisons only between values of one type.
 */
function binary(operator: string, left: Primitive, right: Primitive): Resolved {
  if (operator === '===') return { ok: true, value: left === right };
  if (operator === '!==') return { ok: true, value: left !== right };
  if (operator === '+') {
    if (typeof left === 'number' && typeof right === 'number') return { ok: true, value: left + right };
    return typeof left === 'string' || typeof right === 'string'
      ? { ok: true, value: String(left) + String(right) }
      : UNRESOLVED;
  }
  const numbers = typeof left === 'number' && typeof right === 'number';
  if (numbers && ARITHMETIC.has(operator)) {
    const value =
      operator === '-'
        ? left - right
        : operator === '*'
          ? left * right
          : operator === '/'
            ? left / right
            : left % right;
    // Transforms fold `-NaN` differently, so the runner may see either sign; no real table holds NaN.
    return Number.isNaN(value) ? UNRESOLVED : { ok: true, value };
  }
  const comparable = numbers || (typeof left === 'string' && typeof right === 'string');
  if (!comparable || ARITHMETIC.has(operator)) return UNRESOLVED;
  const [a, b] = [left, right] as [number, number];
  const value = operator === '<' ? a < b : operator === '<=' ? a <= b : operator === '>' ? a > b : a >= b;
  return { ok: true, value };
}

const MUTATING_METHODS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
]);

const OBJECT_MUTATORS = new Set(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf']);

/** The identifier a member chain such as `ROUTING.venues[0]` starts from; null for any other expression. */
function rootName(node: Node): string | null {
  let current = unwrap(node as Expression);
  while (current.type === 'MemberExpression') current = unwrap(current.object);
  return current.type === 'Identifier' ? current.name : null;
}

/** Names assigned to anywhere in `body`, its functions included: `x = ...`, `x++`, `[x] = ...`, `for (x of ...)`. */
function assignedNames(body: Node): Set<string> {
  const names = new Set<string>();
  const targets = (target: Node | null): void => {
    switch (target?.type) {
      case 'Identifier':
        names.add(target.name);
        break;
      case 'ArrayPattern':
        for (const element of target.elements) targets(element);
        break;
      case 'ObjectPattern':
        for (const property of target.properties) targets(property.type === 'RestElement' ? property : property.value);
        break;
      case 'AssignmentPattern':
        targets(target.left);
        break;
      case 'RestElement':
        targets(target.argument);
        break;
    }
  };
  const walk = (node: Node): void => {
    if (node.type === 'AssignmentExpression') targets(node.left);
    if (node.type === 'UpdateExpression') targets(node.argument);
    if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') targets(node.left);
    for (const child of childNodes(node)) walk(child);
  };
  walk(body);
  return names;
}

/**
 * Names whose value the module's top-level code changes while it loads: a member assigned or deleted, a mutating
 * method such as `push()`, or `Object.assign()`. Code in functions runs later, as a test or hook does, after the
 * runner has read titles and tables.
 */
function changedNames(program: Node): Set<string> {
  const names = new Set<string>();
  const add = (node: Node | undefined): void => {
    const name = node ? rootName(node) : null;
    if (name !== null) names.add(name);
  };
  const walk = (node: Node): void => {
    if (isFunctionNode(node)) return;
    switch (node.type) {
      case 'AssignmentExpression':
        if (node.left.type === 'MemberExpression') add(node.left);
        break;
      case 'UpdateExpression':
        if (node.argument.type === 'MemberExpression') add(node.argument);
        break;
      case 'UnaryExpression':
        if (node.operator === 'delete') add(node.argument);
        break;
      case 'CallExpression': {
        const callee = unwrap(node.callee);
        if (callee.type !== 'MemberExpression') break;
        const method = propertyName(callee) ?? '';
        if (MUTATING_METHODS.has(method)) add(callee.object);
        if (OBJECT_MUTATORS.has(method) && rootName(callee.object) === 'Object') add(node.arguments[0]);
        break;
      }
    }
    for (const child of childNodes(node)) walk(child);
  };
  walk(program);
  return names;
}

function isPlainObject(value: Value): value is Record<string, Value> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectBindings(scope: Node, scopes: Node[]): Map<string, Binding> {
  const bindings = new Map<string, Binding>();
  const other = (names: string[], declaration: Node) => {
    for (const name of names) bindings.set(name, { kind: 'other', declaration });
  };
  const declare = (statement: Node | null) => {
    switch (statement?.type) {
      case 'VariableDeclaration':
        // `declare const it: TestAPI` only types a global; the name still refers to it.
        if (statement.declare) break;
        for (const declarator of statement.declarations) {
          if (statement.kind === 'const' && declarator.id.type === 'Identifier' && declarator.init) {
            bindings.set(declarator.id.name, { kind: 'const', init: declarator.init, scopes, declaration: declarator });
          } else {
            other(bindingNames(declarator.id), declarator);
          }
        }
        break;
      case 'FunctionDeclaration':
      case 'ClassDeclaration':
        if (statement.id) bindings.set(statement.id.name, { kind: 'function', declaration: statement });
        break;
      case 'TSEnumDeclaration':
        bindings.set(statement.id.name, { kind: 'enum', node: statement, scopes, declaration: statement });
        break;
      case 'ImportDeclaration':
        for (const specifier of statement.specifiers) {
          bindings.set(specifier.local.name, {
            kind: 'import',
            source: statement.source.value,
            imported:
              specifier.type === 'ImportSpecifier'
                ? specifier.imported.type === 'Identifier'
                  ? specifier.imported.name
                  : specifier.imported.value
                : specifier.type === 'ImportDefaultSpecifier'
                  ? 'default'
                  : null,
            declaration: specifier,
          });
        }
        break;
      case 'ExportNamedDeclaration':
        declare(statement.declaration);
        break;
      case 'ExportDefaultDeclaration':
        declare(statement.declaration);
        break;
    }
  };
  switch (scope.type) {
    case 'Program':
    case 'BlockStatement':
    case 'StaticBlock':
    case 'TSModuleBlock':
      for (const statement of scope.body) declare(statement);
      break;
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      for (const parameter of scope.params) other(bindingNames(parameter), scope);
      break;
    case 'ForStatement':
      declare(scope.init);
      break;
    case 'ForInStatement':
    case 'ForOfStatement':
      declare(scope.left);
      break;
    case 'CatchClause':
      other(bindingNames(scope.param), scope);
      break;
  }
  return bindings;
}
