import type { CallExpression, Expression, Node } from 'oxc-parser';
import { isFunctionNode, propertyName, unwrapChain } from './ast.ts';
import {
  helperParameters,
  referenceOperands,
  type CallbackChoice,
  type CallbackContext,
  type HelperInvocation,
  type InvocationMode,
  type ScopedFunction,
} from './mutation-references.ts';
import type { Values } from './values.ts';

export interface MutationCallSite {
  call: CallExpression;
  scopes: readonly Node[];
  statement: Node | null;
  runsLater: boolean;
}

export interface MethodWrite {
  name: 'call' | 'apply';
  object: Expression;
  assigned: Expression | null;
  scopes: readonly Node[];
  owner: Node;
  end: number;
  unconditional: boolean;
}

interface Target {
  helper: ScopedFunction;
  mode: InvocationMode;
  methodOwner?: Expression;
}

const UNKNOWN: CallbackChoice = { targets: [], definite: false };

function alternatives(choices: CallbackChoice[]): CallbackChoice {
  const targets = new Map(choices.flatMap((choice) => choice.targets.map((target) => [target.fn, target] as const)));
  return { targets: [...targets.values()], definite: choices.every((choice) => choice.definite) };
}

/** Calls with the same callback arguments share a walk of the helper body, including when it calls itself. */
export function mutationCalls(
  program: Node,
  callsByOwner: ReadonlyMap<Node, MutationCallSite[]>,
  methodWrites: readonly MethodWrite[],
  values: Values,
) {
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
  const targetsFor = (site: MutationCallSite, caller: CallbackContext, time: number | null): Target[] => {
    const { call, scopes } = site;
    const callee = unwrapChain(call.callee);
    if (callee.type !== 'MemberExpression')
      return callable(callee, scopes, caller).targets.map((helper) => ({ helper, mode: 'direct' }));
    const name = propertyName(callee);
    if (name !== 'call' && name !== 'apply') return [];
    const object = unwrapChain(callee.object);
    if (
      name === 'apply' &&
      object.type === 'Identifier' &&
      object.name === 'Reflect' &&
      !values.declarationOf('Reflect', scopes)
    ) {
      const fn = call.arguments.at(0);
      return fn && fn.type !== 'SpreadElement'
        ? callable(fn, scopes, caller).targets.map((helper) => ({ helper, mode: 'reflect' }))
        : [];
    }
    const targets: Target[] = [];
    for (const helper of callable(object, scopes, caller).targets) {
      const inherited: Target = { helper, mode: name };
      let possible = [inherited];
      for (const write of methodWrites) {
        if (write.name !== name || (write.owner === program && time !== null && write.end > time)) continue;
        const owners = callable(write.object, write.scopes, caller);
        if (!owners.targets.some((target) => target.fn === helper.fn)) continue;
        if (write.unconditional && time !== null && owners.definite && owners.targets.length === 1) possible = [];
        if (write.assigned)
          possible.push(
            ...callable(write.assigned, write.scopes, caller).targets.map((fn) => ({
              helper: fn,
              mode: 'own' as const,
              methodOwner: object,
            })),
          );
        else possible.push(inherited);
      }
      targets.push(...possible);
    }
    return targets;
  };
  activate(contextFor(program, new Map()), null);
  for (const caller of pending) {
    for (const callSite of callsByOwner.get(caller.owner) ?? []) {
      const { call, scopes, statement, runsLater } = callSite;
      const time = statement ? call.start : (times.get(caller) ?? null);
      const helpers = targetsFor(callSite, caller, time);
      if (!helpers.length && !runsLater) {
        for (const arg of call.arguments) {
          if (arg.type === 'SpreadElement') continue;
          for (const callback of callable(arg, scopes, caller).targets)
            activate(contextFor(callback.fn, new Map()), null);
        }
      }
      for (const { helper, mode, methodOwner } of helpers) {
        let atSite = calls.get(call);
        if (!atSite) {
          atSite = [];
          calls.set(call, atSite);
        }
        let invocation = atSite.find(
          (entry) => entry.caller === caller && entry.fn === helper.fn && entry.mode === mode,
        );
        if (!invocation) {
          const site = {
            call,
            scopes,
            statement,
            mode,
            methodOwner,
            fn: helper.fn,
            parameterScopes: [...helper.scopes, helper.fn],
          };
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
