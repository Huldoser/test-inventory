import type { Expression, Node } from 'oxc-parser';
import { isFunctionNode, returnValues, unwrapChain, type FunctionNode } from './ast.ts';
import type { HelperInvocation, ScopedFunction } from './mutation-references.ts';
import type { Values } from './values.ts';

export function analyzeReturns(fn: FunctionNode) {
  const body = fn.body;
  const all = body && returnValues(fn);
  return {
    candidates: all ?? (body && returnValues(fn, false, 'ignore')) ?? [],
    complete: !!all && (body.type !== 'BlockStatement' || body.body.at(-1)?.type === 'ReturnStatement'),
  };
}

/** Closures and bound arguments keep the closest factory whose bindings they use. */
export function capturedResult(target: ScopedFunction, frame: HelperInvocation): ScopedFunction {
  const factory = frame.caller.factories.get(frame.call) ?? frame;
  const depth = target.scopes.indexOf(frame.fn);
  if (depth >= 0 && (!target.factory || depth > target.scopes.indexOf(target.factory.fn)))
    return { ...target, factory };
  if (!target.bound) return target;
  return {
    ...target,
    bound: target.bound.map((capture) =>
      !capture.factory && capture.scopes.includes(frame.fn) ? { ...capture, factory } : capture,
    ),
  };
}

export function conditionArgument(
  test: Expression,
  scopes: readonly Node[],
  frame: HelperInvocation | undefined,
  values: Values,
): Expression | undefined {
  if (
    test.type !== 'Identifier' ||
    frame?.mode !== 'direct' ||
    frame.bound ||
    values.declarationOf(test.name, scopes) !== frame.fn
  )
    return;
  const index = frame.fn.params.findIndex((param) => param.type === 'Identifier' && param.name === test.name);
  const args = frame.call.arguments;
  if (index < 0 || args.slice(0, index).some((arg) => arg.type === 'SpreadElement')) return;
  const arg = args.at(index);
  if (!arg || arg.type === 'SpreadElement') return;
  const changed = values.assignedIn(frame.fn.body as Node);
  if (!changed.has(test.name) && !changed.has('arguments')) return arg;
}

/** Mark functions whose creation alone cannot execute the writes in their bodies. */
export function markReturnedLocals(
  expression: Expression,
  scopes: readonly Node[],
  owner: FunctionNode,
  values: Values,
  out: Set<Node>,
  seen = new Set<Node>(),
): void {
  const value = unwrapChain(expression);
  if (isFunctionNode(value)) out.add(value);
  else if (value.type === 'Identifier') {
    const constant = values.constantOf(value.name, scopes);
    if (constant) {
      if (!seen.has(constant.init)) {
        seen.add(constant.init);
        // An alias can point to a function declared outside the factory.
        if (constant.scopes.includes(owner))
          markReturnedLocals(constant.init, constant.scopes, owner, values, out, seen);
      }
    } else {
      const local = values.functionWithScopes(value.name, scopes);
      if (local?.scopes.includes(owner)) out.add(local.fn);
    }
  } else if (value.type === 'ConditionalExpression' || value.type === 'LogicalExpression') {
    const first = value.type === 'ConditionalExpression' ? value.consequent : value.left;
    const second = value.type === 'ConditionalExpression' ? value.alternate : value.right;
    markReturnedLocals(first, scopes, owner, values, out, seen);
    markReturnedLocals(second, scopes, owner, values, out, seen);
  } else if (value.type === 'SequenceExpression')
    markReturnedLocals(value.expressions[value.expressions.length - 1], scopes, owner, values, out, seen);
  else if (value.type === 'AssignmentExpression' && value.operator === '=')
    markReturnedLocals(value.right, scopes, owner, values, out, seen);
}
