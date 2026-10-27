import type { Expression, Node, TSEnumDeclaration } from 'oxc-parser';
import { propertyName, unwrap, type FunctionNode } from './ast.ts';

export type Value = string | number | boolean | null | undefined | Value[] | { [key: string]: Value };

/** A value worked out from the file, or the reason it could not be. `importedFrom` names the module it came from. */
export type Resolved = { ok: true; value: Value } | { ok: false; importedFrom: string | null };

/** What a name is bound to, and the node that declares it: a declarator, import specifier, function or parameter list. */
type Binding = { declaration: Node } & (
  | { kind: 'const'; init: Expression; scopes: Node[] }
  | { kind: 'enum'; node: TSEnumDeclaration; scopes: Node[] }
  | { kind: 'import'; source: string }
  | { kind: 'function' }
  | { kind: 'other' }
);

const UNRESOLVED: Resolved = { ok: false, importedFrom: null };

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

  /**
   * Runs `read` with a function's parameters bound to the arguments of one call, worked out where the call is, so that
   * titles and values built from them resolve, as in `test(\`${side} rejects a zero quantity\`)` inside
   * `validatesQuantity('buy')`. `args` stop at a spread argument, after which no position is known. A missing argument
   * takes the parameter's default value, worked out in `scopes`, the scopes around the function.
   */
  withArguments<T>(fn: FunctionNode, args: readonly Resolved[], scopes: readonly Node[], read: () => T): T {
    const parameters = new Map<string, () => Resolved>();
    for (const [index, parameter] of fn.params.entries()) {
      const target = parameter.type === 'AssignmentPattern' ? parameter.left : parameter;
      if (target.type !== 'Identifier') continue;
      const argument = args.at(index);
      if (argument) parameters.set(target.name, () => argument);
      else if (parameter.type === 'AssignmentPattern') {
        parameters.set(target.name, () => this.resolve(parameter.right, [...scopes, fn]));
      }
    }
    this.calls.push({ fn, parameters, cache: new Map() });
    try {
      return read();
    } finally {
      this.calls.pop();
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
        if (expression.operator !== '+') return UNRESOLVED;
        const left = this.resolve(expression.left, scopes);
        if (!left.ok) return left;
        const right = this.resolve(expression.right, scopes);
        if (!right.ok) return right;
        if (!isPrimitive(left.value) || !isPrimitive(right.value)) return UNRESOLVED;
        if (typeof left.value === 'number' && typeof right.value === 'number') {
          return { ok: true, value: left.value + right.value };
        }
        return typeof left.value === 'string' || typeof right.value === 'string'
          ? { ok: true, value: String(left.value) + String(right.value) }
          : UNRESOLVED;
      }
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
        const object = this.resolve(expression.object, scopes);
        if (!object.ok) return object;
        const key = expression.computed
          ? this.resolve(expression.property, scopes)
          : { ok: true as const, value: propertyName(expression) };
        if (!key.ok) return key;
        const container = object.value;
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

  private resolveName(name: string, scopes: readonly Node[]): Resolved {
    const found = this.lookup(name, scopes);
    if (!found) return name === 'undefined' ? { ok: true, value: undefined } : UNRESOLVED;
    const { binding } = found;
    switch (binding.kind) {
      case 'const':
        return this.resolveConstant(binding.init, binding.scopes);
      case 'enum':
        return { ok: true, value: this.enumMembers(binding.node, binding.scopes) };
      case 'import':
        return { ok: false, importedFrom: binding.source };
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
