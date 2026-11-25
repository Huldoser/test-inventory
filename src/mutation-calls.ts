import type { CallExpression, Expression, Node } from 'oxc-parser';
import { isFunctionNode, unwrapChain } from './ast.ts';
import {
  helperParameters,
  referenceOperands,
  type CallbackChoice,
  type CallbackContext,
  type HelperInvocation,
} from './mutation-references.ts';
import type { Values } from './values.ts';

export interface MutationCallSite {
  call: CallExpression;
  scopes: readonly Node[];
  statement: Node | null;
  runsLater: boolean;
}

const UNKNOWN: CallbackChoice = { targets: [], definite: false };

function alternatives(choices: CallbackChoice[]): CallbackChoice {
  const targets = new Map(choices.flatMap((choice) => choice.targets.map((target) => [target.fn, target] as const)));
  return { targets: [...targets.values()], definite: choices.every((choice) => choice.definite) };
}

/** Calls with the same callback arguments share a walk of the helper body, including when it calls itself. */
export function mutationCalls(program: Node, callsByOwner: ReadonlyMap<Node, MutationCallSite[]>, values: Values) {
  const calls = new Map<CallExpression, HelperInvocation[]>();
  const contexts = new Map<Node, Map<string, CallbackContext>>();
  const times = new Map<CallbackContext, number | null>();
  const pending: CallbackContext[] = [];
  const contextFor = (owner: Node, functions: Map<string, CallbackChoice>): CallbackContext => {
    let groups = contexts.get(owner);
    if (!groups) {
      groups = new Map<string, CallbackContext>();
      contexts.set(owner, groups);
    }
    const signature = JSON.stringify(
      [...functions].map(([name, choice]) => [name, choice.definite, choice.targets.map((target) => target.fn.start)]),
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
  const callable = (
    expression: Expression,
    scopes: readonly Node[],
    context: CallbackContext,
    seen = new Set<Node>(),
  ): CallbackChoice => {
    let value = unwrapChain(expression);
    while (value.type === 'Identifier') {
      const constant = values.constantOf(value.name, scopes);
      if (!constant) {
        const local = values.functionWithScopes(value.name, scopes);
        if (local) return { targets: [local], definite: true };
        if (values.declarationOf(value.name, scopes) === context.owner)
          return context.functions.get(value.name) ?? UNKNOWN;
        return UNKNOWN;
      }
      if (seen.has(constant.init)) return UNKNOWN;
      seen.add(constant.init);
      scopes = constant.scopes;
      value = unwrapChain(constant.init);
    }
    if (isFunctionNode(value)) return { targets: [{ fn: value, scopes }], definite: true };
    if (value.type === 'ConditionalExpression' || value.type === 'LogicalExpression') {
      return alternatives(referenceOperands(value).map((expr) => callable(expr, scopes, context, new Set(seen))));
    }
    if (value.type === 'SequenceExpression')
      return callable(value.expressions[value.expressions.length - 1], scopes, context, seen);
    if (value.type === 'AssignmentExpression' && value.operator === '=')
      return callable(value.right, scopes, context, seen);
    return UNKNOWN;
  };
  activate(contextFor(program, new Map()), null);
  for (const caller of pending) {
    for (const { call, scopes, statement, runsLater } of callsByOwner.get(caller.owner) ?? []) {
      const helpers = callable(call.callee, scopes, caller).targets;
      if (!helpers.length && !runsLater) {
        for (const arg of call.arguments) {
          if (arg.type === 'SpreadElement') continue;
          for (const callback of callable(arg, scopes, caller).targets)
            activate(contextFor(callback.fn, new Map()), null);
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
          const parameters = helperParameters(site, (expr) => callable(expr, scopes, caller).definite);
          const choices = new Map<string, CallbackChoice[]>();
          for (const param of parameters) {
            const choice =
              param.ref.path.length || param.ref.rest !== undefined
                ? UNKNOWN
                : callable(param.ref.value, param.scopes, caller);
            // A property selected by destructuring may also be absent, even when one candidate is a function.
            const direct = param.fromDefault || call.arguments.includes(param.ref.value);
            const possible = { targets: choice.targets, definite: direct && choice.definite };
            const previous = choices.get(param.name);
            if (previous) previous.push(possible);
            else choices.set(param.name, [possible]);
          }
          const functions = new Map<string, CallbackChoice>();
          for (const [name, options] of choices) {
            const choice = alternatives(options);
            if (choice.targets.length) functions.set(name, choice);
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
