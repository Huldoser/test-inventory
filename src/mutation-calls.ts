import type { CallExpression, Expression, Node } from 'oxc-parser';
import { isFunctionNode, propertyName, unwrapChain } from './ast.ts';
import {
  helperParameters,
  literalArguments,
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
  bindOwner?: Expression;
}

export interface MethodWrite {
  name: 'call' | 'apply' | 'bind';
  object: Expression;
  assigned: Expression | null;
  scopes: readonly Node[];
  owner: Node;
  end: number;
  unconditional: boolean;
}

interface Target {
  helper: ScopedFunction;
  mode: InvocationMode | 'bind';
  methodOwner?: Expression;
}

const UNKNOWN: CallbackChoice = { targets: [], definite: false };

function functionKey(target: ScopedFunction): string {
  if (!target.bound) return String(target.fn.start);
  return JSON.stringify([target.fn.start, ...target.bound.map((capture) => [capture.call.start, capture.caller.id])]);
}

function alternatives(choices: CallbackChoice[]): CallbackChoice {
  const targets = new Map(
    choices.flatMap((choice) => choice.targets.map((target) => [functionKey(target), target] as const)),
  );
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
  const bindSites = new Map<CallExpression, MutationCallSite>();
  for (const sites of callsByOwner.values())
    for (const site of sites) if (site.bindOwner) bindSites.set(site.call, site);
  let nextContext = 0;
  const contextFor = (owner: Node, functions: Map<string, CallbackChoice>): CallbackContext => {
    let groups = contexts.get(owner);
    if (!groups) {
      groups = new Map<string, CallbackContext>();
      contexts.set(owner, groups);
    }
    const signature = JSON.stringify(
      [...functions].map(([name, choice]) => [name, choice.definite, choice.targets.map(functionKey)]),
    );
    let context = groups.get(signature);
    if (!context) {
      const ancestors = new Map<CallExpression, CallbackContext>();
      for (const choice of functions.values())
        for (const fn of choice.targets)
          for (const capture of fn.bound ?? []) {
            for (const [call, ancestor] of capture.caller.ancestors) ancestors.set(call, ancestor);
            if (!ancestors.has(capture.call)) ancestors.set(capture.call, capture.caller);
          }
      context = { owner, functions, id: nextContext++, ancestors };
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
  const root = contextFor(program, new Map());
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
      if (seen.has(value)) return UNKNOWN;
      seen.add(value);
      scopes = constant.scopes;
      value = unwrapChain(constant.init);
    }
    if (value.type === 'CallExpression' && !seen.has(value)) {
      const site = bindSites.get(value);
      if (site?.bindOwner) {
        seen.add(value);
        // Re-entering the same bind site while forwarding a callback must reach a finite set of contexts.
        const caller = site.statement ? root : (context.ancestors.get(value) ?? context);
        const capture = { call: value, scopes: site.scopes, statement: site.statement, caller };
        const original = callable(site.bindOwner, site.scopes, site.statement ? root : context, seen);
        const targets: ScopedFunction[] = [];
        let definite = original.definite;
        for (const helper of original.targets) {
          const options = methodChoices(
            helper,
            'bind',
            caller,
            site.statement ? value.start : (times.get(caller) ?? null),
            seen,
          );
          if (options.includes(null)) {
            const bound = helper.bound ?? [];
            const previous = bound.findLast((entry) => entry.call === value);
            if (previous?.repeated) targets.push(helper);
            else {
              const next = previous ? { ...capture, caller: context, repeated: true } : capture;
              targets.push({ ...helper, bound: [...bound, next] });
            }
          }
          if (options.length !== 1 || options[0] !== null) definite = false;
        }
        return { targets, definite };
      }
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
  const methodChoices = (
    helper: ScopedFunction,
    name: MethodWrite['name'],
    caller: CallbackContext,
    time: number | null,
    seen = new Set<Node>(),
  ) => {
    let possible: (ScopedFunction | null)[] = [null];
    for (const write of methodWrites) {
      if (write.name !== name || (write.owner === program && time !== null && write.end > time)) continue;
      const owners = callable(write.object, write.scopes, caller, new Set(seen));
      if (!owners.targets.some((owner) => functionKey(owner) === functionKey(helper))) continue;
      if (write.unconditional && time !== null && owners.definite && owners.targets.length === 1) possible = [];
      if (write.assigned) possible.push(...callable(write.assigned, write.scopes, caller, new Set(seen)).targets);
      else possible.push(null);
    }
    return possible;
  };
  const targetsFor = (site: MutationCallSite, caller: CallbackContext, time: number | null): Target[] => {
    const { call, scopes } = site;
    const callee = unwrapChain(call.callee);
    if (callee.type !== 'MemberExpression')
      return callable(callee, scopes, caller).targets.map((helper) => ({ helper, mode: 'direct' }));
    const name = propertyName(callee);
    if (name !== 'call' && name !== 'apply' && name !== 'bind') return [];
    const object = unwrapChain(callee.object);
    if (
      name === 'apply' &&
      object.type === 'Identifier' &&
      object.name === 'Reflect' &&
      !values.declarationOf('Reflect', scopes)
    ) {
      const fn = literalArguments(call.arguments).next().value;
      return fn && fn.type !== 'SpreadElement'
        ? callable(fn, scopes, caller).targets.map((helper) => ({ helper, mode: 'reflect' }))
        : [];
    }
    const targets: Target[] = [];
    for (const helper of callable(site.bindOwner ?? object, scopes, caller).targets) {
      for (const own of methodChoices(helper, name, caller, time)) {
        if (own) targets.push({ helper: own, mode: 'own', methodOwner: object });
        else targets.push({ helper, mode: name });
      }
    }
    return targets;
  };
  activate(root, null);
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
        if (mode === 'bind') continue;
        let atSite = calls.get(call);
        if (!atSite) {
          atSite = [];
          calls.set(call, atSite);
        }
        const key = functionKey(helper);
        let invocation = atSite.find((entry) => entry.caller === caller && entry.key === key && entry.mode === mode);
        if (!invocation) {
          const site = {
            call,
            scopes,
            statement,
            mode,
            methodOwner,
            bound: helper.bound,
            key,
            fn: helper.fn,
            parameterScopes: [...helper.scopes, helper.fn],
          };
          const parameters = helperParameters(
            site,
            (expr, capture) => callable(expr, capture?.scopes ?? scopes, capture?.caller ?? caller).definite,
          );
          const choices = new Map<string, CallbackChoice[]>();
          for (const param of parameters) {
            const choice =
              param.ref.path.length || param.ref.rest !== undefined
                ? UNKNOWN
                : callable(
                    param.ref.value,
                    param.ref.capture?.scopes ?? param.scopes,
                    param.ref.capture?.caller ?? caller,
                  );
            // A property selected by destructuring may also be absent, even when one candidate is a function.
            const direct = param.fromDefault || (param.ref.capture?.call ?? call).arguments.includes(param.ref.value);
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
