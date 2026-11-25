import type { CallExpression, Expression, Node } from 'oxc-parser';
import { isFunctionNode, unwrapChain } from './ast.ts';
import {
  helperParameters,
  type CallbackContext,
  type HelperInvocation,
  type ScopedFunction,
} from './mutation-references.ts';
import type { Values } from './values.ts';

export interface MutationCallSite {
  call: CallExpression;
  scopes: readonly Node[];
  statement: Node | null;
  runsLater: boolean;
}

/** Calls with the same callback arguments share a walk of the helper body, including when it calls itself. */
export function mutationCalls(program: Node, callsByOwner: ReadonlyMap<Node, MutationCallSite[]>, values: Values) {
  const calls = new Map<CallExpression, HelperInvocation[]>();
  const contexts = new Map<Node, Map<string, CallbackContext>>();
  const times = new Map<CallbackContext, number | null>();
  const pending: CallbackContext[] = [];
  const contextFor = (owner: Node, functions: Map<string, ScopedFunction[]>): CallbackContext => {
    let groups = contexts.get(owner);
    if (!groups) {
      groups = new Map<string, CallbackContext>();
      contexts.set(owner, groups);
    }
    const signature = JSON.stringify(
      [...functions].map(([name, targets]) => [name, targets.map((target) => target.fn.start)]),
    );
    let context = groups.get(signature);
    if (!context) {
      context = { owner, functions };
      groups.set(signature, context);
    }
    return context;
  };
  const activate = (context: CallbackContext, time: number | null) => {
    const previous = times.get(context);
    if (previous === null || previous === time) return;
    times.set(context, previous === undefined ? time : null);
    pending.push(context);
  };
  const callable = (expression: Expression, scopes: readonly Node[], context: CallbackContext): ScopedFunction[] => {
    const value = unwrapChain(expression);
    if (isFunctionNode(value)) return [{ fn: value, scopes }];
    if (value.type !== 'Identifier') return [];
    const local = values.functionWithScopes(value.name, scopes);
    if (local) return [local];
    if (values.declarationOf(value.name, scopes) !== context.owner) return [];
    return context.functions.get(value.name) ?? [];
  };
  activate(contextFor(program, new Map()), null);
  for (const caller of pending) {
    for (const { call, scopes, statement, runsLater } of callsByOwner.get(caller.owner) ?? []) {
      const helpers = callable(call.callee, scopes, caller);
      if (!helpers.length && !runsLater) {
        for (const arg of call.arguments) {
          if (arg.type === 'SpreadElement') continue;
          for (const callback of callable(arg, scopes, caller)) activate(contextFor(callback.fn, new Map()), null);
        }
      }
      for (const helper of helpers) {
        let atSite = calls.get(call);
        if (!atSite) {
          atSite = [];
          calls.set(call, atSite);
        }
        let invocation = atSite.find((entry) => entry.caller === caller && entry.fn === helper.fn);
        if (!invocation) {
          const site = { call, scopes, statement, fn: helper.fn, parameterScopes: [...helper.scopes, helper.fn] };
          const parameters = helperParameters(site, (expr) => callable(expr, scopes, caller).length > 0);
          const functions = new Map<string, ScopedFunction[]>();
          for (const param of parameters) {
            if (param.ref.path.length || param.ref.rest !== undefined) continue;
            const targets = callable(param.ref.value, param.scopes, caller);
            if (!targets.length) continue;
            const previous = functions.get(param.name);
            if (previous) {
              for (const target of targets) if (!previous.some((old) => old.fn === target.fn)) previous.push(target);
            } else functions.set(param.name, [...targets]);
          }
          invocation = { ...site, caller, parameters, context: contextFor(helper.fn, functions) };
          atSite.push(invocation);
        }
        const time = statement ? call.start : (times.get(caller) ?? null);
        activate(invocation.context, helper.fn.async || helper.fn.generator ? null : time);
      }
    }
  }
  const callTimes = new Map<Node, number | null>();
  for (const [context, time] of times) {
    const previous = callTimes.get(context.owner);
    callTimes.set(context.owner, previous === undefined || previous === time ? time : null);
  }
  return { calls, callTimes };
}
