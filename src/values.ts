import type { CallExpression, ClassBody, Expression, Node, TSEnumDeclaration, VariableDeclarator } from 'oxc-parser';
import {
  childNodes,
  isFunctionNode,
  propertyKey,
  propertyName,
  unwrap,
  unwrapChain,
  type FunctionNode,
} from './ast.ts';
import {
  changedReferences,
  memberKey,
  patternReferences,
  type AliasBinding,
  type MutationTarget,
} from './mutation-references.ts';
import { mutationCalls, type MethodWrite, type MutationCallSite } from './mutation-calls.ts';

export type Value = string | number | boolean | null | undefined | Value[] | { [key: string]: Value };

/** A resolved value or a failed lookup. `arrayLength` can record the size of an imported array with unknown items. */
export type Resolved = { ok: true; value: Value } | { ok: false; importedFrom: string | null; arrayLength?: number };

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

interface DataProperty {
  name: string;
  computed: boolean;
  value: Expression | null;
  scopes: readonly Node[];
  staticField?: boolean;
}

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
    case 'SwitchStatement':
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
  private readonly rebound = new WeakMap<Node, Set<string>>();
  private readonly changed = new WeakMap<Node, Set<string>>();

  /** Without `imports`, a value imported from another module is not worked out. */
  constructor(imports: ImportReader | null = null) {
    this.imports = imports;
  }

  /**
   * Runs `read` with a function's parameters bound to the arguments of one call, worked out where the call is, so that
   * titles and values built from them resolve, as in `test(\`${side} rejects a zero quantity\`)` inside
   * `validatesQuantity('buy')`. `args` stop at a spread argument, after which no position is known, and `complete` is
   * false then. A missing argument takes the parameter's default value, worked out in `scopes`, the scopes around the
   * function. A rest parameter, as `...cycles`, holds the arguments left. When collecting parameter side effects,
   * `defaults` records whether each initializer runs. A null entry means the supplied value is unknown.
   */
  withArguments<T>(
    fn: FunctionNode,
    args: readonly Resolved[],
    scopes: readonly Node[],
    read: () => T,
    complete = true,
    defaults?: Map<Node, boolean | null>,
  ): T {
    const parameters = new Map<string, () => Resolved>();
    for (const [index, parameter] of fn.params.entries()) {
      if (parameter.type === 'RestElement') {
        const rest = args.slice(index);
        const unknown = complete ? rest.find((item) => !item.ok) : UNRESOLVED;
        const value = unknown ?? { ok: true, value: rest.map((item) => (item as { value: Value }).value) };
        this.bind(parameter.argument, value, parameters, [...scopes, fn], defaults);
      } else {
        const value = args.at(index) ?? (!complete && defaults ? UNRESOLVED : undefined);
        this.bind(parameter, value, parameters, [...scopes, fn], defaults);
      }
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

  assignedIn(body: Node, includeMemberWrites = true): ReadonlySet<string> {
    const cache = includeMemberWrites ? this.assigned : this.rebound;
    let names = cache.get(body);
    if (!names) {
      names = assignedNames(body, includeMemberWrites);
      cache.set(body, names);
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
    defaults?: Map<Node, boolean | null>,
  ): void {
    switch (pattern.type) {
      case 'Identifier':
        if (value) names.set(pattern.name, () => value);
        return;
      case 'AssignmentPattern': {
        const useDefault = !value || (value.ok && value.value === undefined);
        defaults?.set(pattern, value && !value.ok ? null : useDefault);
        if (!useDefault) {
          this.bind(pattern.left, value, names, scopes, defaults);
          return;
        }
        const fallback = pattern.right;
        if (pattern.left.type === 'Identifier') {
          names.set(pattern.left.name, () => this.resolve(fallback, scopes));
          return;
        }
        this.bind(pattern.left, this.resolve(fallback, scopes), names, scopes, defaults);
        return;
      }
      case 'ArrayPattern':
        for (const [index, element] of pattern.elements.entries()) {
          if (!element || !value) continue;
          const list = value.ok && Array.isArray(value.value) ? value.value : null;
          const part = (rest: boolean): Resolved =>
            list ? { ok: true, value: rest ? list.slice(index) : list[index] } : value.ok ? UNRESOLVED : value;
          if (element.type === 'RestElement') this.bind(element.argument, part(true), names, scopes, defaults);
          else this.bind(element, part(false), names, scopes, defaults);
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
              defaults,
            );
            continue;
          }
          const key = this.propertyKey(property.key, property.computed, scopes);
          const name = key.ok && isKey(key.value) ? String(key.value) : null;
          if (name !== null) taken.push(name);
          const part: Resolved =
            object && name !== null ? { ok: true, value: object[name] } : value.ok ? UNRESOLVED : value;
          this.bind(property.value, part, names, scopes, defaults);
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
        if (propertyName(expression) === 'name') {
          const name = this.functionName(expression.object, scopes);
          if (name) return name;
        }
        const own = this.dataProperty(expression, scopes);
        if (own) return own.value ? this.resolveConstant(own.value, own.scopes) : { ok: true, value: undefined };
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

  /**
   * The local function a name refers to, including one reached through a constant alias.
   * A parameter is not its function, though the function declares it.
   */
  functionOf(name: string, scopes: readonly Node[]): FunctionNode | null {
    return this.functionWithScopes(name, scopes)?.fn ?? null;
  }

  /** `functionOf()`, with the scopes around the function's declaration, in which its body is read. */
  functionWithScopes(name: string, scopes: readonly Node[]): { fn: FunctionNode; scopes: readonly Node[] } | null {
    const seen = new Set<Node>();
    let found = this.lookup(name, scopes);
    while (found) {
      const { binding } = found;
      const declaration = binding.declaration;
      if (binding.kind === 'function' && declaration.type === 'FunctionDeclaration')
        return { fn: declaration, scopes: found.scopes };
      if (declaration.type !== 'VariableDeclarator' || !declaration.init) return null;
      const init = unwrap(declaration.init);
      if (isFunctionNode(init)) return { fn: init, scopes: found.scopes };
      if (binding.kind !== 'const' || init.type !== 'Identifier' || seen.has(declaration)) return null;
      seen.add(declaration);
      found = this.lookup(init.name, binding.scopes);
    }
    return null;
  }

  /** The value a `const` name is declared with, and the scopes around that declaration; null for any other name. */
  constantOf(name: string, scopes: readonly Node[]): { init: Expression; scopes: readonly Node[] } | null {
    const binding = this.lookup(name, scopes)?.binding;
    return binding?.kind === 'const' ? { init: binding.init, scopes: binding.scopes } : null;
  }

  /** The name a module exports that a name imported from it stands for, `default` for a default import; null otherwise. */
  importedName(name: string, scopes: readonly Node[]): string | null {
    const binding = this.lookup(name, scopes)?.binding;
    return binding?.kind === 'import' ? binding.imported : null;
  }

  /** The module a name is imported from where it is used; null when it isn't an import. */
  importSource(name: string, scopes: readonly Node[]): string | null {
    const binding = this.lookup(name, scopes)?.binding;
    return binding?.kind === 'import' ? binding.source : null;
  }

  /**
   * Whether a name refers to a parameter or loop variable bound to a value where it is used: an argument of the helper
   * call being walked, or a value of the case or pass of an expansion.
   */
  isBound(name: string, scopes: readonly Node[]): boolean {
    const binding = this.lookup(name, scopes)?.binding;
    if (binding?.kind !== 'other') return false;
    return this.calls.findLast((item) => item.fn === binding.declaration)?.parameters.has(name) ?? false;
  }

  /** A local function's name. Bun reads the declared name and receives undefined for an unnamed function. */
  functionName(
    expression: Expression,
    scopes: readonly Node[],
    bun?: { inferStaticFieldNames: boolean },
  ): Resolved | null {
    let node: Node = unwrap(expression);
    let inferred = '';
    let modified = false;
    const seen = new Set<Node>();
    while (node.type === 'Identifier' || node.type === 'MemberExpression') {
      if (node.type === 'MemberExpression') {
        const own = this.dataProperty(node, scopes);
        if (!own?.value || seen.has(own.value)) return null;
        seen.add(own.value);
        inferred = bun && (own.computed || (own.staticField && !bun.inferStaticFieldNames)) ? '' : own.name;
        node = unwrap(own.value);
        scopes = own.scopes;
        continue;
      }
      const found = this.lookup(node.name, scopes);
      if (!found || seen.has(found.binding.declaration)) return null;
      seen.add(found.binding.declaration);
      modified ||= this.changedAtLoad(found.scopes[0], found.binding, node.name);
      inferred = node.name;
      scopes = found.scopes;
      const binding = found.binding;
      if (binding.kind === 'function') node = binding.declaration;
      else if (binding.kind === 'const') node = unwrap(binding.init);
      else return null;
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      if (modified) return UNRESOLVED;
      const declared = { ok: true as const, value: node.id?.name ?? inferred };
      if (bun) return declared;
      const member = this.classProperty(node.body, 'name', false, scopes);
      if (member === null) return declared;
      if (member === 'unknown') return UNRESOLVED;
      return member.value ? this.resolveConstant(member.value, scopes) : { ok: true, value: undefined };
    }
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      const name = node.type === 'ArrowFunctionExpression' ? inferred : (node.id?.name ?? inferred);
      return modified ? UNRESOLVED : { ok: true, value: bun && name === '' ? undefined : name };
    }
    return null;
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
    if (binding?.kind !== 'import') return null;
    // `const fees = require('./fees')` holds the module's exports, as `import * as fees` does.
    const required = binding.imported === 'default' && binding.declaration.type === 'VariableDeclarator';
    if (binding.imported !== null && !required) return null;
    if (required && this.changedAtLoad(scopes[0], binding, object.name))
      return { ok: false, importedFrom: binding.source };
    const key = expression.computed
      ? this.resolve(expression.property, scopes)
      : { ok: true as const, value: propertyName(expression) };
    if (!key.ok || !isKey(key.value)) return { ok: false, importedFrom: binding.source };
    return this.imported(binding.source, String(key.value));
  }

  /** A local data property, in the scope where its value was defined. */
  private dataProperty(
    expression: Extract<Expression, { type: 'MemberExpression' }>,
    scopes: readonly Node[],
  ): DataProperty | null {
    const key = expression.computed
      ? this.resolve(expression.property, scopes)
      : { ok: true as const, value: propertyName(expression) };
    if (!key.ok || !isKey(key.value)) return null;
    const name = String(key.value);
    let object: Node = unwrap(expression.object);
    let inferredName = '';
    let prototype = false;
    let inherited = false;
    const seen = new Set<Node>();
    for (;;) {
      if (object.type === 'Identifier') {
        const found = this.lookup(object.name, scopes);
        if (
          !found ||
          this.changedAtLoad(found.scopes[0], found.binding, object.name) ||
          seen.has(found.binding.declaration)
        )
          return null;
        seen.add(found.binding.declaration);
        inferredName = object.name;
        const binding = found.binding;
        if (binding.kind === 'const') object = unwrap(binding.init);
        else if (binding.declaration.type === 'ClassDeclaration') object = binding.declaration;
        else return null;
        scopes = found.scopes;
        continue;
      }
      if (object.type === 'MemberExpression') {
        if (inherited || prototype || propertyName(object) !== 'prototype') return null;
        prototype = true;
        object = unwrap(object.object);
        continue;
      }
      if (object.type !== 'ClassDeclaration' && object.type !== 'ClassExpression') break;
      if (object.decorators.length) return null;
      const member = this.classProperty(object.body, name, prototype, scopes);
      if (member === 'unknown') return null;
      if (member) return member;
      // Each class installs its own prototype.constructor before it installs any computed methods.
      if (prototype && name === 'constructor')
        return { name: object.id?.name ?? inferredName, computed: false, value: object, scopes };
      if (!object.superClass) return null;
      inherited = true;
      object = unwrap(object.superClass);
      inferredName = '';
    }
    if (object.type !== 'ObjectExpression' || prototype || inherited) return null;
    for (let index = object.properties.length - 1; index >= 0; index--) {
      const property = object.properties[index];
      if (property.type === 'SpreadElement') return null;
      const candidate = this.propertyKey(property.key, property.computed, scopes);
      if (!candidate.ok || !isKey(candidate.value)) return null;
      if (String(candidate.value) === name)
        return property.kind === 'init' ? { name, computed: property.computed, value: property.value, scopes } : null;
    }
    return null;
  }

  /** Methods are installed first. Static fields and blocks can then replace them, in source order. */
  private classProperty(
    body: ClassBody,
    name: string,
    prototype: boolean,
    scopes: readonly Node[],
  ): DataProperty | 'unknown' | null {
    let method: DataProperty | 'unknown' | null = null;
    let field: DataProperty | 'unknown' | null = null;
    for (const member of body.body) {
      if (member.type === 'StaticBlock') {
        field = 'unknown';
        continue;
      }
      if (!('key' in member) || member.static === prototype || member.key.type === 'PrivateIdentifier') continue;
      const key = this.propertyKey(member.key, member.computed, scopes);
      if (key.ok && isKey(key.value) && String(key.value) !== name) continue;
      const known = key.ok && isKey(key.value) && !member.decorators.length;
      if (member.type === 'MethodDefinition') {
        if (member.kind === 'constructor') continue;
        method =
          known && member.kind === 'method'
            ? { name, computed: member.computed, value: member.value, scopes }
            : 'unknown';
      } else if (!prototype && member.type === 'PropertyDefinition' && !member.declare) {
        field = known ? { name, computed: member.computed, value: member.value, scopes, staticField: true } : 'unknown';
      } else if (member.type === 'AccessorProperty') method = 'unknown';
    }
    return field ?? method;
  }

  private imported(source: string, name: string | null): Resolved {
    const resolved = name !== null && this.imports ? this.imports(source, name) : UNRESOLVED;
    return resolved.ok ? resolved : { ...resolved, importedFrom: source };
  }

  /**
   * How many items a list has when not all its values are known, as `[NaN, Infinity]`: a list written out, its spreads
   * included, held in a constant the module doesn't change, or the keys, values or entries of an object written out;
   * null otherwise. `seen` stops at a constant defined through itself.
   */
  lengthOf(node: Expression, scopes: readonly Node[], seen = new Set<string>()): number | null {
    const expression = unwrap(node);
    if (expression.type === 'Identifier') return this.lengthOfName(expression.name, scopes, seen);
    const resolved = this.resolve(node, scopes);
    if (resolved.ok) return Array.isArray(resolved.value) ? resolved.value.length : null;
    if (expression.type === 'MemberExpression') {
      const member = this.namespaceMember(expression, scopes);
      return member?.ok === false ? (member.arrayLength ?? null) : null;
    }
    if (expression.type === 'CallExpression' && isObjectListing(expression)) {
      const target = expression.arguments[0] as Expression;
      return this.keyCount(target, scopes, seen);
    }
    if (expression.type !== 'ArrayExpression') return null;
    let length = 0;
    for (const element of expression.elements) {
      const inner = element?.type === 'SpreadElement' ? this.lengthOf(element.argument, scopes, seen) : 1;
      if (inner === null) return null;
      length += inner;
    }
    return length;
  }

  /** How many items a named array holds, including a project import whose values are unknown. */
  lengthOfName(name: string, scopes: readonly Node[], seen = new Set<string>()): number | null {
    const resolved = this.resolveName(name, scopes);
    if (resolved.ok) return Array.isArray(resolved.value) ? resolved.value.length : null;
    const binding = this.lookup(name, scopes)?.binding;
    if (binding?.kind === 'import') return resolved.arrayLength ?? null;
    if (binding?.kind !== 'const' || seen.has(name) || this.changedAtLoad(binding.scopes[0], binding, name))
      return null;
    return this.lengthOf(binding.init, binding.scopes, new Set([...seen, name]));
  }

  /** How many keys an object written out has, held in a constant the module doesn't change; null otherwise. */
  private keyCount(node: Expression, scopes: readonly Node[], seen: Set<string>): number | null {
    const expression = unwrap(node);
    if (expression.type === 'Identifier') {
      const binding = this.lookup(expression.name, scopes)?.binding;
      if (binding?.kind !== 'const' || seen.has(expression.name)) return null;
      if (this.changedAtLoad(binding.scopes[0], binding, expression.name)) return null;
      return this.keyCount(binding.init, binding.scopes, new Set([...seen, expression.name]));
    }
    if (expression.type !== 'ObjectExpression') return null;
    const keys = new Set<string>();
    for (const property of expression.properties) {
      const key = property.type === 'Property' ? propertyKey(property) : null;
      if (key === null) return null;
      keys.add(key);
    }
    return keys.size;
  }

  /** What a name refers to where it is used; `scopes` lists the scope nodes around the use, outermost first. */
  resolveName(name: string, scopes: readonly Node[]): Resolved {
    const found = this.lookup(name, scopes);
    if (!found) return name === 'undefined' ? { ok: true, value: undefined } : UNRESOLVED;
    const { binding } = found;
    switch (binding.kind) {
      case 'const':
        if (this.changedAtLoad(binding.scopes[0], binding, name)) return UNRESOLVED;
        return this.resolveConstant(binding.init, binding.scopes);
      case 'enum':
        return { ok: true, value: this.enumMembers(binding.node, binding.scopes) };
      case 'import':
        if (this.changedAtLoad(scopes[0], binding, name)) return { ok: false, importedFrom: binding.source };
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

  /** Names the module changes while it loads, as in `WATCHED.push('MSFT')`, whose declared value isn't the one used. */
  private changedAtLoad(program: Node, binding: Binding, name: string): boolean {
    let names = this.changed.get(program);
    if (!names) {
      names = changedNames(program, this);
      this.changed.set(program, names);
    }
    return names.has(mutationKey(binding.declaration, name));
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

  /** A name's binding, and the scopes from the outermost to the one that declares it. */
  private lookup(name: string, scopes: readonly Node[]): { binding: Binding; scopes: readonly Node[] } | null {
    for (let index = scopes.length - 1; index >= 0; index--) {
      const declaredIn = scopes.slice(0, index + 1);
      const binding = this.bindings(scopes[index], declaredIn).get(name);
      if (binding) return { binding, scopes: declaredIn };
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
  let current = unwrapChain(node as Expression);
  while (current.type === 'MemberExpression') current = unwrapChain(current.object);
  return current.type === 'Identifier' ? current.name : null;
}

/**
 * Names assigned to or changed anywhere in `body`, its functions included: `x = ...`, `x++`, `[x] = ...`,
 * `for (x of ...)`, `x.push(...)`.
 */
export function assignedNames(body: Node, includeMemberWrites = true): Set<string> {
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
    // A parameter whose value the function changes, as in `list.push(...)`, no longer holds the argument's value.
    if (includeMemberWrites) {
      const object = mutatedObject(node);
      const changed = object && rootName(object);
      if (changed !== null) names.add(changed);
    }
    for (const child of childNodes(node)) walk(child);
  };
  walk(body);
  return names;
}

/** Calls whose callbacks run after the runner has collected the tests: tests, hooks and steps. */
const RUNS_LATER = new Set([
  'test',
  'it',
  'bench',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'aroundEach',
  'aroundAll',
]);

/** Calls whose callbacks run while the runner collects the tests, also when they hang off `test`. */
const RUNS_NOW = new Set(['describe', 'suite', 'context']);

/** The names of a call's callee, as in `test.describe.serial`: the identifier it starts from and each property. */
function calleeNames(callee: Node): string[] {
  const names: string[] = [];
  let current = unwrap(callee as Expression);
  while (current.type === 'MemberExpression' || current.type === 'CallExpression') {
    if (current.type === 'CallExpression') {
      current = unwrap(current.callee);
      continue;
    }
    names.push(propertyName(current) ?? '');
    current = unwrap(current.object);
  }
  if (current.type === 'Identifier') names.push(current.name);
  return names;
}

/** The object a write or a mutating call acts on. */
function mutatedObject(node: Node): Expression | null {
  switch (node.type) {
    case 'AssignmentExpression':
      return node.left.type === 'MemberExpression' ? node.left.object : null;
    case 'UpdateExpression':
      return node.argument.type === 'MemberExpression' ? node.argument.object : null;
    case 'UnaryExpression': {
      const target = unwrapChain(node.argument);
      return node.operator === 'delete' && target.type === 'MemberExpression' ? target.object : null;
    }
    case 'CallExpression': {
      const callee = unwrapChain(node.callee);
      if (callee.type !== 'MemberExpression') return null;
      const method = propertyName(callee) ?? '';
      if (MUTATING_METHODS.has(method)) return callee.object;
      const target = node.arguments.at(0);
      return OBJECT_MUTATORS.has(method) &&
        rootName(callee.object) === 'Object' &&
        target &&
        target.type !== 'SpreadElement'
        ? target
        : null;
    }
    default:
      return null;
  }
}

/** The immediately preceding initializer or assignment can identify a mutable function alias. */
function previousAliasValue(object: Expression, previous: Node | null): Expression {
  if (object.type !== 'Identifier') return object;
  if (previous?.type === 'VariableDeclaration') previous = previous.declarations[previous.declarations.length - 1];
  if (previous?.type === 'VariableDeclarator') {
    if (previous.id.type === 'Identifier' && previous.id.name === object.name && previous.init) return previous.init;
    previous = previous.init;
  } else if (previous?.type === 'ExpressionStatement') previous = previous.expression;
  return previous?.type === 'AssignmentExpression' &&
    previous.operator === '=' &&
    previous.left.type === 'Identifier' &&
    previous.left.name === object.name
    ? previous.right
    : object;
}

/**
 * Names whose value the module changes while it loads, as describe callbacks and helpers run then: a member assigned
 * or deleted, a mutating method such as `push()`, or `Object.assign()`, also through an alias such as
 * `const all = SIDES`. The callbacks of tests, hooks and steps run after the runner has read titles and tables, so
 * what they change doesn't count.
 */
function changedNames(program: Node, values: Values): Set<string> {
  const targets: MutationTarget[] = [];
  const declarations: AliasBinding[] = [];
  const callsByOwner = new Map<Node, MutationCallSite[]>();
  const methodWrites: MethodWrite[] = [];
  const suspensions: number[] = [];
  const accessors = { get: new Set<string | null>(), set: new Set<string | null>() };
  const accesses: {
    assigned?: Expression;
    member: Extract<Expression, { type: 'MemberExpression' }>;
    site: Omit<MutationCallSite, 'call'>;
    owner: Node;
  }[] = [];
  const writeOnly = new Set<Node>();
  const patterns = new Map<Node, ReturnType<typeof patternReferences>>();
  const addSite = (owner: Node, site: MutationCallSite) => {
    const sites = callsByOwner.get(owner);
    if (sites) sites.push(site);
    else callsByOwner.set(owner, [site]);
  };
  const walk = (
    node: Node,
    ancestors: readonly Node[],
    statement: Node | null,
    owner: Node,
    before: Node | null = null,
  ): void => {
    const scopes = isScopeNode(node) ? [...ancestors, node] : ancestors;
    if (node.type === 'FunctionDeclaration' || isFunctionNode(node)) {
      owner = node;
      statement = null;
    } else if (node.type === 'ClassBody') statement = null;
    if (owner === program) {
      if (node.type === 'ForOfStatement' && node.await) suspensions.push(node.right.end);
      if (node.type === 'AwaitExpression') suspensions.push(node.end);
      if (node.type === 'VariableDeclaration' && node.kind === 'await using')
        suspensions.push(scopes[scopes.length - 1].end);
    }
    const target = mutatedObject(node);
    if (target) {
      targets.push({ value: target, scopes, statement, owner });
      const member =
        node.type === 'AssignmentExpression' && node.operator === '='
          ? node.left
          : node.type === 'UnaryExpression'
            ? unwrapChain(node.argument)
            : null;
      if (member?.type === 'MemberExpression') {
        writeOnly.add(member);
        if (node.type === 'AssignmentExpression')
          accesses.push({ member, assigned: node.right, site: { scopes, statement, runsLater: true }, owner });
        const name = memberKey(member);
        const unconditional = statement?.type === 'ExpressionStatement' && statement.expression === node;
        methodWrites.push({
          expression: node,
          name,
          object: unconditional ? previousAliasValue(member.object, before) : member.object,
          assigned: node.type === 'AssignmentExpression' ? node.right : null,
          scopes,
          owner,
          end: node.end,
          unconditional,
        });
      }
    }
    if (node.type === 'Property' && node.kind !== 'init') accessors[node.kind].add(propertyKey(node));
    if (node.type === 'MemberExpression' && !writeOnly.has(node))
      accesses.push({ member: node, site: { scopes, statement, runsLater: false }, owner });
    if (node.type === 'VariableDeclaration' && node.kind === 'const')
      for (const declaration of node.declarations)
        if (declaration.init && (declaration.id.type === 'ObjectPattern' || declaration.id.type === 'ArrayPattern'))
          patterns.set(declaration, patternReferences(declaration.id, declaration.init, scopes));
    if (node.type === 'VariableDeclarator' && node.init)
      declarations.push({ pattern: node.id, source: node.init, scopes, statement, end: node.end, replaces: false });
    if (node.type === 'AssignmentExpression' && node.operator === '=')
      declarations.push({
        pattern: node.left,
        source: node.right,
        scopes,
        statement,
        end: node.end,
        replaces: statement?.type === 'ExpressionStatement' && statement.expression === node,
      });
    if (node.type === 'IfStatement' && node.test.type === 'Literal' && typeof node.test.value === 'boolean') {
      const branch = node.test.value ? node.consequent : node.alternate;
      if (branch) walk(branch, scopes, statement, owner);
      return;
    }
    if (node.type === 'CallExpression') {
      const callee = calleeNames(node.callee);
      const runsLater = callee.some((name) => RUNS_LATER.has(name)) && !callee.some((name) => RUNS_NOW.has(name));
      const member = unwrapChain(node.callee);
      const bindOwner =
        member.type === 'MemberExpression' && propertyName(member) === 'bind'
          ? previousAliasValue(member.object, before)
          : undefined;
      const method = member.type === 'MemberExpression' ? propertyName(member) : null;
      const arrayMethod = method && MUTATING_METHODS.has(method) ? method : undefined;
      addSite(owner, { call: node, scopes, statement, runsLater, bindOwner, arrayMethod });
      walk(node.callee, scopes, statement, owner);
      for (const argument of node.arguments)
        if (!runsLater || !isFunctionNode(argument)) walk(argument, scopes, statement, owner);
      return;
    }
    const sequence =
      node === program ||
      node.type === 'BlockStatement' ||
      node.type === 'VariableDeclaration' ||
      node.type === 'SequenceExpression';
    let previous = before;
    for (const child of childNodes(node)) {
      const top = node === program && (child.type === 'VariableDeclaration' || child.type === 'ExpressionStatement');
      const prior = sequence
        ? previous
        : node.type === 'ExpressionStatement' || node.type === 'VariableDeclarator'
          ? before
          : null;
      walk(child, scopes, top ? child : statement, owner, prior);
      previous = child;
    }
  };
  walk(program, [], null, program);
  if (!targets.length) return new Set();
  if (accessors.get.size || accessors.set.size)
    for (const { member, owner, site, assigned } of accesses) {
      const accessor = assigned ? 'set' : 'get';
      const keys = accessors[accessor];
      const key = memberKey(member);
      if (!keys.size || (key !== null && !keys.has(key) && !keys.has(null))) continue;
      const call: CallExpression = {
        type: 'CallExpression',
        callee: member,
        arguments: assigned ? [assigned] : [],
        optional: false,
        start: member.start,
        end: member.end,
      };
      addSite(owner, { ...site, call, accessor });
    }
  const graph = mutationCalls(
    program,
    callsByOwner,
    methodWrites,
    suspensions.sort((a, b) => a - b),
    values,
    patterns,
  );
  return changedReferences(declarations, targets, graph, (identifier, scopes) => {
    const declaration =
      identifier === 'this'
        ? (scopes.findLast((scope) => scope.type === 'FunctionDeclaration' || scope.type === 'FunctionExpression') ??
          null)
        : values.declarationOf(identifier, scopes);
    return declaration && mutationKey(declaration, identifier);
  });
}

/** A declaration can bind several names in a parameter list or destructuring pattern. */
function mutationKey(declaration: Node, name: string): string {
  return `${declaration.start}:${name}`;
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
          const required = declarator.init ? localRequire(declarator.init) : null;
          if (required !== null && declarator.id.type === 'Identifier') {
            // `const symbols = require('./symbols')` stands for what the module exports, as a default import does.
            bindings.set(declarator.id.name, {
              kind: 'import',
              source: required,
              imported: 'default',
              declaration: declarator,
            });
          } else if (required !== null && declarator.id.type === 'ObjectPattern') {
            for (const property of declarator.id.properties) {
              const key = property.type === 'Property' ? propertyKey(property) : null;
              if (key !== null && property.type === 'Property' && property.value.type === 'Identifier') {
                bindings.set(property.value.name, {
                  kind: 'import',
                  source: required,
                  imported: key,
                  declaration: declarator,
                });
              } else {
                other(bindingNames(property.type === 'Property' ? property.value : property), declarator);
              }
            }
          } else if (statement.kind === 'const' && declarator.id.type === 'Identifier' && declarator.init) {
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
  // A `var` in a nested block belongs to the whole function or module, as in `case 'x': var context = ...`.
  const hoist = (body: Node) => {
    for (const declarator of nestedVars(body)) {
      for (const name of bindingNames(declarator.id))
        if (!bindings.has(name)) bindings.set(name, { kind: 'other', declaration: declarator });
    }
  };
  switch (scope.type) {
    case 'Program':
      for (const statement of scope.body) declare(statement);
      hoist(scope);
      break;
    case 'BlockStatement':
    case 'StaticBlock':
    case 'TSModuleBlock':
      for (const statement of scope.body) declare(statement);
      break;
    case 'SwitchStatement':
      for (const item of scope.cases) for (const statement of item.consequent) declare(statement);
      break;
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      for (const parameter of scope.params) other(bindingNames(parameter), scope);
      // Only a TypeScript overload has no body, and no walk goes into one.
      hoist(scope.body as Node);
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

/** The `var` declarators in the blocks below a scope, outside the functions, classes and namespaces in it. */
function nestedVars(scope: Node): VariableDeclarator[] {
  const found: VariableDeclarator[] = [];
  // Only statements hold declarations, so expressions, however deep, are not walked.
  const visit = (node: Node) => {
    if (node.type === 'VariableDeclaration') {
      if (node.kind === 'var') found.push(...node.declarations);
      return;
    }
    if (!/Statement$|^(SwitchCase|CatchClause|ExportNamedDeclaration)$/.test(node.type)) return;
    for (const child of childNodes(node)) visit(child);
  };
  for (const child of childNodes(scope)) if (child.type !== 'VariableDeclaration') visit(child);
  return found;
}

/** `Object.keys(x)`, `Object.values(x)` or `Object.entries(x)`, which list as many items as `x` has keys. */
function isObjectListing(call: CallExpression): boolean {
  const callee = unwrap(call.callee);
  return (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'Object' &&
    ['keys', 'values', 'entries'].includes(propertyName(callee) as string) &&
    call.arguments.length === 1 &&
    call.arguments[0].type !== 'SpreadElement'
  );
}

/** The local file `require('./symbols')` loads, as an import of it; null for a package or any other expression. */
function localRequire(expression: Expression): string | null {
  const node = unwrap(expression);
  if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || node.callee.name !== 'require')
    return null;
  const argument = node.arguments.at(0);
  const isLocal = argument?.type === 'Literal' && typeof argument.value === 'string' && /^\.\.?\//.test(argument.value);
  return isLocal ? argument.value : null;
}
