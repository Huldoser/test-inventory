import type { Argument, BlockStatement, CallExpression, Expression, Node, Statement } from 'oxc-parser';
import { isFunctionNode, unwrap, type FunctionNode } from '../ast.ts';
import { atLeast, type FileContext } from './common.ts';

/** Constructing these values cannot call user code or throw during registration. */
export function inert(expression: Expression): boolean {
  const node = unwrap(expression);
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
const owner = (scopes: readonly Node[]) =>
  scopes.findLast((n) => n.type === 'FunctionDeclaration' || isFunctionNode(n));
const callback = (node: Node | undefined): node is FunctionNode =>
  node?.type === 'FunctionDeclaration' || isFunctionNode(node);
const timeout = (node: Node | undefined) =>
  node?.type === 'Literal' && typeof node.value === 'number' && node.value <= 2147483647;

/** A call, coercion or await the scan cannot account for keeps the catch reachable. */
export function registrationExit(block: BlockStatement, outer: readonly Node[], file: FileContext): Exit {
  // Helpers may recurse or call each other repeatedly. Exhausting this proof budget keeps the catch in the inventory.
  let remaining = 256;
  const active: { block: BlockStatement; at: number }[] = [];
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
      const beforeTry =
        outer.includes(scope) && owner(outer) === owner(constant.scopes) && constant.init.end < block.start;
      const beforeCall = constant.init.end <= (active.findLast((entry) => entry.block === scope)?.at ?? -1);
      if ((scope.type === 'Program' || scope.type === 'BlockStatement') && (beforeUse || beforeTry || beforeCall))
        return { node: unwrap(constant.init), scopes: constant.scopes };
    }
    return undefined;
  }
  function invoke(fn: FunctionNode, scopes: readonly Node[], children: Children): Exit {
    if (!fn.body || fn.async || fn.generator || !fn.params.every((p) => p.type === 'Identifier')) return 'unknown';
    const inside = [...scopes, fn];
    const outcome =
      fn.body.type === 'BlockStatement' ? statement(fn.body, inside, children) : expression(fn.body, inside, children);
    return outcome === 'return' ? 'next' : outcome;
  }
  function call(node: CallExpression, scopes: readonly Node[], children: Children): Exit {
    const callee = unwrap(node.callee);
    if (--remaining < 0 || callee.type !== 'Identifier' || assigned.has(callee.name)) return 'unknown';
    const name = callee.name;
    const binding = file.values.declarationOf(name, scopes);
    const args = node.arguments;
    if (binding) {
      const helper = argument(callee, scopes);
      if (!helper || !callback(helper.node) || !args.every((a) => a.type !== 'SpreadElement' && inert(a)))
        return 'unknown';
      if (helper.node.async && !helper.node.generator) {
        // Its synchronous prefix may register a child. Errors in its parameters or body reject the returned promise.
        children.registered ||= 'possible';
        return 'next';
      }
      return invoke(helper.node, helper.scopes, children);
    }
    const first = argument(args.at(0), scopes)?.node;
    const secondArg = argument(args.at(1), scopes);
    const second = secondArg?.node;
    if (['beforeEach', 'afterEach', 'beforeAll', 'afterAll'].includes(name))
      return callback(first) && !first.generator && (args.length === 1 || (args.length === 2 && timeout(second)))
        ? 'next'
        : 'unknown';
    if (first?.type !== 'Literal' || typeof first.value !== 'string') return 'unknown';
    if (['it', 'xit', 'fit'].includes(name)) {
      if (
        !(args.length === 1 && name !== 'fit') &&
        !(
          callback(second) &&
          !second.generator &&
          (args.length === 2 || (args.length === 3 && timeout(argument(args[2], scopes)?.node)))
        )
      )
        return 'unknown';
    } else if (
      ['describe', 'xdescribe', 'fdescribe'].includes(name) &&
      args.length === 2 &&
      secondArg &&
      callback(secondArg.node)
    ) {
      if (name === 'describe' && functionLength(secondArg.node) > 0) return 'throw';
      const nested: Children = { registered: false };
      const result = invoke(secondArg.node, secondArg.scopes, nested);
      if (result === 'unknown') return result;
      if (
        nested.registered !== true &&
        atLeast(file.version, 4, name === 'describe' ? 0 : 5) &&
        !(result === 'throw' && atLeast(file.version, 4, 5))
      )
        return nested.registered === 'possible' ? 'unknown' : 'throw';
    } else return 'unknown';
    children.registered = true;
    return 'next';
  }
  function expression(node: Expression, scopes: readonly Node[], children: Children): Exit {
    const value = unwrap(node);
    if (value.type === 'CallExpression') return call(value, scopes, children);
    if (value.type === 'Identifier' && argument(value, scopes)) return 'next';
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
        return 'throw';
      case 'IfStatement': {
        const guard = argument(node.test, scopes)?.node;
        if (guard?.type !== 'Literal') return 'unknown';
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
          const end = statement(node.finalizer, scopes, children);
          if (end !== 'next') return end;
        }
        return result;
      }
      default:
        return 'unknown';
    }
  }
  return statement(block, outer, { registered: false });
}
