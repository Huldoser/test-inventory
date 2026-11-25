import type { CallExpression, Expression, MemberExpression, Node } from 'oxc-parser';
import { isFunctionNode, propertyName, unwrapChain, type FunctionNode } from './ast.ts';
import {
  DEFINED,
  enclosingFactory,
  helperParameters,
  literalArguments,
  memberKey,
  property,
  type patternReferences,
  referenceOperands,
  type CallbackChoice,
  type CallbackContext,
  type HelperInvocation,
  type InvocationMode,
  type ParameterSource,
  type ScopedFunction,
} from './mutation-references.ts';
import { analyzeReturns, capturedResult, conditionArgument, markReturnedLocals } from './mutation-returns.ts';
import type { Values } from './values.ts';

export interface MutationCallSite {
  call: CallExpression;
  scopes: readonly Node[];
  statement: Node | null;
  runsLater: boolean;
  bindOwner?: Expression;
  accessor?: 'get' | 'set';
}

export interface MethodWrite {
  name: string | null;
  object: Expression;
  assigned: Expression | null;
  scopes: readonly Node[];
  owner: Node;
  end: number;
  unconditional: boolean;
}

interface MemberStep {
  read?: { site: MutationCallSite; context: CallbackContext };
  key: string | null;
  accessor?: 'get' | 'set';
  time: number | null;
}

interface Target {
  helper: ScopedFunction;
  mode: InvocationMode | 'bind';
  methodOwner?: Expression;
}

const UNKNOWN: CallbackChoice = { targets: [], definite: false };

function functionKey(target: ScopedFunction): string {
  if (!target.bound && !target.factory) return String(target.fn.start);
  return JSON.stringify([
    target.fn.start,
    target.factory?.id,
    ...(target.bound ?? []).map((capture) => [capture.call.start, capture.caller.id, capture.factory?.id]),
  ]);
}

function alternatives(choices: CallbackChoice[]): CallbackChoice {
  const targets = new Map(
    choices.flatMap((choice) => choice.targets.map((target) => [functionKey(target), target] as const)),
  );
  return { targets: [...targets.values()], definite: choices.every((choice) => choice.definite) };
}

function localFunction(target: ScopedFunction, context: CallbackContext): CallbackChoice {
  let factory = context.factory;
  while (factory && !target.scopes.includes(factory.fn)) factory = factory.context.factory;
  return { targets: [factory ? { ...target, factory } : target], definite: true };
}

/** Calls with the same callback arguments share a walk of the helper body, including when it calls itself. */
export function mutationCalls(
  program: Node,
  callsByOwner: ReadonlyMap<Node, MutationCallSite[]>,
  methodWrites: readonly MethodWrite[],
  values: Values,
  patterns: ReadonlyMap<Node, ReturnType<typeof patternReferences>>,
) {
  const calls = new Map<CallExpression, HelperInvocation[]>();
  const contexts = new Map<Node, Map<string, CallbackContext>>();
  const times = new Map<CallbackContext, number | null>();
  const pending: CallbackContext[] = [];
  const sites = new Map<CallExpression, { site: MutationCallSite; owner: Node }>();
  const getterSites = new Map<MemberExpression, MutationCallSite>();
  for (const [owner, entries] of callsByOwner)
    for (const site of entries) {
      sites.set(site.call, { site, owner });
      if (site.accessor === 'get') getterSites.set(site.call.callee as MemberExpression, site);
    }
  const constantValue = (expression: Expression, scopes: readonly Node[]) => {
    let value = unwrapChain(expression);
    const seen = new Set<Node>();
    while (value.type === 'Identifier' && !seen.has(value)) {
      seen.add(value);
      const alias = values.constantOf(value.name, scopes);
      if (!alias) break;
      value = unwrapChain(alias.init);
      scopes = alias.scopes;
    }
    return { value, scopes };
  };
  const objectWrites = new Map<Expression, MethodWrite[]>();
  for (const write of methodWrites) {
    const { value } = constantValue(write.object, write.scopes);
    if (value.type !== 'ObjectExpression' && value.type !== 'ArrayExpression') continue;
    const writes = objectWrites.get(value);
    if (writes) writes.push(write);
    else objectWrites.set(value, [write]);
  }
  const writesAt = (container: Expression, key: string | null, time: number | null) =>
    (objectWrites.get(container) ?? []).filter(
      (write) =>
        (key === null || write.name === null || write.name === key) &&
        (write.owner !== program || time === null || write.end <= time),
    );

  // A spread reads its source immediately. An object contained in the copied slot is still shared.
  const spreadTime = (value: Expression, scopes: readonly Node[], invocationTime: number | null) =>
    scopes.some((scope) => scope.type === 'FunctionDeclaration' || isFunctionNode(scope))
      ? invocationTime
      : value.start;

  const reflectSources = (
    source: ParameterSource,
    readTimes: readonly (number | null)[],
    invocationTime: number | null,
    seen = new Set<Node>(),
  ): ParameterSource[] => {
    const { ref } = source;
    if (!ref.path.length || ref.capture) return [source];
    const { value, scopes } = constantValue(ref.value, source.scopes);
    if (value.type !== 'ArrayExpression' || seen.has(value)) return [source];
    seen.add(value);
    const [key, ...suffix] = ref.path;
    const [time, ...later] = readTimes;
    const choices: { source: ParameterSource; times: (number | null)[] }[] = [];
    for (const child of property({ value, path: [] }, key))
      if (child)
        choices.push({
          source: { ...source, scopes, ref: { ...ref, value: child.value, path: [...child.path, ...suffix] } },
          times: [...child.path.map(() => spreadTime(child.value, scopes, invocationTime)), ...later],
        });
    for (const write of writesAt(value, key, time)) {
      if (write.unconditional && time !== null && key !== null && key === write.name) choices.length = 0;
      if (write.assigned)
        choices.push({
          source: { ...source, scopes: write.scopes, ref: { ...ref, value: write.assigned, path: suffix } },
          times: later,
        });
    }
    return choices.flatMap((choice) => reflectSources(choice.source, choice.times, invocationTime, new Set(seen)));
  };
  const returns = new Map<FunctionNode, ReturnType<typeof analyzeReturns>>();
  const returnedBy = (fn: FunctionNode) => {
    let result = returns.get(fn);
    if (!result) {
      result = analyzeReturns(fn);
      returns.set(fn, result);
    }
    return result;
  };
  const returnedFns = new Set<Node>();
  let nextContext = 0;
  let nextInvocation = 0;
  const contextFor = (
    owner: Node,
    functions: Map<string, CallbackChoice>,
    factory?: HelperInvocation,
  ): CallbackContext => {
    let groups = contexts.get(owner);
    if (!groups) {
      groups = new Map<string, CallbackContext>();
      contexts.set(owner, groups);
    }
    const signature = JSON.stringify([
      factory?.id,
      ...[...functions].map(([name, choice]) => [name, choice.definite, choice.targets.map(functionKey)]),
    ]);
    let context = groups.get(signature);
    if (!context) {
      const factories = new Map<CallExpression, HelperInvocation>();
      const remember = (frame: HelperInvocation) => {
        for (const [call, ancestor] of frame.caller.factories) factories.set(call, ancestor);
        if (!factories.has(frame.call)) factories.set(frame.call, frame);
      };
      if (factory) {
        remember(factory);
        returnedFns.add(owner);
      }
      const ancestors = new Map<CallExpression, CallbackContext>();
      for (const choice of functions.values())
        for (const fn of choice.targets) {
          if (fn.factory) remember(fn.factory);
          for (const capture of fn.bound ?? []) {
            for (const [call, ancestor] of capture.caller.ancestors) ancestors.set(call, ancestor);
            if (!ancestors.has(capture.call)) ancestors.set(capture.call, capture.caller);
          }
        }
      context = { owner, functions, id: nextContext++, ancestors, factory, factories };
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
    frame?: HelperInvocation,
    path: readonly MemberStep[] = [],
  ): CallbackChoice => {
    let value = unwrapChain(expression);
    while (value.type === 'Identifier') {
      const constant = values.constantOf(value.name, scopes);
      if (!constant) {
        const declared = values.declarationOf(value.name, scopes);
        const pattern = declared && patterns.get(declared);
        const options = pattern?.entries.get(value.name);
        if (pattern && options && !seen.has(value)) {
          seen.add(value);
          const choices: CallbackChoice[] = [];
          for (const { ref, fromDefault } of options) {
            if (fromDefault && choices.length && choices.every((choice) => choice.definite)) continue;
            const selection = ref.path.map((key) => ({ key, time: declared.start }));
            choices.push(
              ref.rest === undefined
                ? callable(ref.value, pattern.scopes, context, new Set(seen), frame, [...selection, ...path])
                : UNKNOWN,
            );
          }
          return alternatives(choices);
        }
        if (path.length) return UNKNOWN;
        const local = values.functionWithScopes(value.name, scopes);
        if (local) return localFunction(local, context);
        const environment =
          declared === context.owner ? context : declared && enclosingFactory(context, declared)?.context;
        if (environment) return environment.functions.get(value.name) ?? UNKNOWN;
        return UNKNOWN;
      }
      if (seen.has(value)) return UNKNOWN;
      seen.add(value);
      scopes = constant.scopes;
      value = unwrapChain(constant.init);
    }
    if (value.type === 'MemberExpression' && !seen.has(value)) {
      seen.add(value);
      const time = context.owner === program ? value.start : (times.get(context) ?? null);
      const site = getterSites.get(value);
      const step = { key: memberKey(value), time, read: site && { site, context } };
      return callable(value.object, scopes, context, seen, frame, [step, ...path]);
    }
    if (path.length && (value.type === 'ObjectExpression' || value.type === 'ArrayExpression')) {
      const [step, ...rest] = path;
      const choices: CallbackChoice[] = [];
      let accessorOnly = true;
      for (const ref of property({ value, path: [] }, step.key)) {
        if (!ref?.accessor) accessorOnly = false;
        if (ref?.accessor && !step.accessor) {
          choices.push(step.read ? produced(step.read.site, step.read.context, seen, rest) : UNKNOWN);
          continue;
        }
        const selected = ref && (ref.path.length || ref.accessor === step.accessor ? ref.value : ref.counterpart);
        if (ref && selected) {
          const projection = ref.path.map((key) => ({
            ...step,
            key,
            time: spreadTime(ref.value, scopes, frame?.statement ? frame.call.start : step.time),
          }));
          choices.push(callable(selected, scopes, context, new Set(seen), frame, [...projection, ...rest]));
        } else choices.push(UNKNOWN);
      }
      for (const write of writesAt(value, step.key, step.time)) {
        if (accessorOnly && write.assigned) continue;
        if (!write.assigned) accessorOnly = false;
        if (write.unconditional && step.time !== null && step.key !== null && step.key === write.name)
          choices.length = 0;
        choices.push(
          write.assigned && !step.accessor
            ? callable(write.assigned, write.scopes, context, new Set(seen), frame, rest)
            : UNKNOWN,
        );
      }
      return alternatives(choices);
    }
    if (value.type === 'CallExpression' && !seen.has(value)) {
      const entry = sites.get(value);
      if (!entry) return UNKNOWN;
      const { site, owner } = entry;
      const evaluatedIn = owner === program ? root : (enclosingFactory(context, owner)?.context ?? context);
      seen.add(value);
      if (site.bindOwner && !path.length) {
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
        const inherited = { targets, definite };
        if (definite) return inherited;
        const own = produced(site, evaluatedIn, seen);
        return targets.length ? alternatives([inherited, own]) : own;
      }
      return produced(site, evaluatedIn, seen, path);
    }
    if (!path.length && isFunctionNode(value)) return localFunction({ fn: value, scopes }, context);
    if (value.type === 'ConditionalExpression' || value.type === 'LogicalExpression') {
      const test = unwrapChain(value.type === 'ConditionalExpression' ? value.test : value.left);
      const branches = referenceOperands(value, conditionArgument(test, scopes, frame, values));
      return alternatives(branches.map((expr) => callable(expr, scopes, context, new Set(seen), frame, path)));
    }
    if (value.type === 'SequenceExpression')
      return callable(value.expressions[value.expressions.length - 1], scopes, context, seen, frame, path);
    if (value.type === 'AssignmentExpression' && value.operator === '=')
      return callable(value.right, scopes, context, seen, frame, path);
    return UNKNOWN;
  };
  const produced = (
    site: MutationCallSite,
    context: CallbackContext,
    seen: Set<Node>,
    path: readonly MemberStep[] = [],
  ): CallbackChoice => {
    const choices: CallbackChoice[] = [];
    for (const frame of visit(site, context)) {
      const { candidates, complete } = returnedBy(frame.fn);
      if (!complete) choices.push(UNKNOWN);
      for (const result of candidates) {
        const choice = callable(
          result.expression,
          [...frame.parameterScopes, ...result.around],
          frame.context,
          new Set(seen),
          frame,
          path,
        );
        choices.push({
          targets: choice.targets.map((target) => capturedResult(target, frame)),
          definite: choice.definite,
        });
      }
    }
    return choices.length ? alternatives(choices) : UNKNOWN;
  };
  const methodChoices = (
    helper: ScopedFunction,
    name: 'call' | 'apply' | 'bind',
    caller: CallbackContext,
    time: number | null,
    seen = new Set<Node>(),
  ) => {
    let possible: (ScopedFunction | null)[] = [null];
    for (const write of methodWrites) {
      if (
        (write.name !== null && write.name !== name) ||
        (write.owner === program && time !== null && write.end > time)
      )
        continue;
      const owners = callable(write.object, write.scopes, caller, new Set(seen));
      if (!owners.targets.some((owner) => functionKey(owner) === functionKey(helper))) continue;
      if (write.name === name && write.unconditional && time !== null && owners.definite && owners.targets.length === 1)
        possible = [];
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
    const object = unwrapChain(callee.object);
    if (site.accessor) {
      const step = { key: memberKey(callee), accessor: site.accessor, time };
      return callable(object, scopes, caller, new Set(), undefined, [step]).targets.map((helper) => ({
        helper,
        mode: 'own',
        methodOwner: object,
      }));
    }
    if (
      name === 'apply' &&
      object.type === 'Identifier' &&
      object.name === 'Reflect' &&
      !values.declarationOf('Reflect', scopes)
    ) {
      const args: Expression = {
        type: 'ArrayExpression',
        elements: [...literalArguments(call.arguments)],
        start: call.start,
        end: call.end,
      };
      return callable(args, scopes, caller, new Set(), undefined, [{ key: '0', time }]).targets.map((helper) => ({
        helper,
        mode: 'reflect',
      }));
    }
    const targets: Target[] = callable(callee, scopes, caller).targets.map((helper) => ({
      helper,
      mode: 'own',
      methodOwner: object,
    }));
    if (name !== 'call' && name !== 'apply' && name !== 'bind') return targets;
    for (const helper of callable(site.bindOwner ?? object, scopes, caller).targets) {
      for (const own of methodChoices(helper, name, caller, time)) {
        if (own) targets.push({ helper: own, mode: 'own', methodOwner: object });
        else targets.push({ helper, mode: name });
      }
    }
    return targets;
  };
  const resolving = new Set<CallExpression>();
  const visit = (callSite: MutationCallSite, caller: CallbackContext): HelperInvocation[] => {
    if (resolving.has(callSite.call)) return [];
    resolving.add(callSite.call);
    const found: HelperInvocation[] = [];
    const { call, scopes, statement, runsLater } = callSite;
    const time = statement ? call.start : (times.get(caller) ?? null);
    const helpers = targetsFor(callSite, caller, time);
    if (!helpers.length && !runsLater) {
      for (const arg of call.arguments) {
        if (arg.type === 'SpreadElement') continue;
        for (const callback of callable(arg, scopes, caller).targets)
          activate(contextFor(callback.fn, new Map(), callback.factory), null);
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
        const supplied = helperParameters(site, (expr, capture) => {
          const at = capture?.scopes ?? scopes;
          return (
            DEFINED.has(constantValue(expr, at).value.type) || callable(expr, at, capture?.caller ?? caller).definite
          );
        });
        const parameters =
          mode === 'reflect'
            ? supplied.flatMap((source) =>
                reflectSources(
                  source,
                  source.ref.path.map(() => time),
                  time,
                ),
              )
            : supplied;
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
        invocation = {
          ...site,
          id: nextInvocation++,
          caller,
          parameters,
          context: contextFor(helper.fn, functions, helper.factory),
        };
        atSite.push(invocation);
      }
      found.push(invocation);
      activate(invocation.context, helper.fn.async || helper.fn.generator ? null : time);
    }
    resolving.delete(callSite.call);
    return found;
  };
  activate(root, null);
  for (const caller of pending) for (const site of callsByOwner.get(caller.owner) ?? []) visit(site, caller);

  // Returning a local function alone does not run its body.
  for (const invocations of calls.values())
    for (const invocation of invocations) {
      for (const { expression, around } of returnedBy(invocation.fn).candidates)
        markReturnedLocals(expression, [...invocation.parameterScopes, ...around], invocation.fn, values, returnedFns);
    }
  const returnedContexts = new Map<Node, CallbackContext[]>([...returnedFns].map((fn) => [fn, []]));
  const callTimes = new Map<Node, number | null>();
  for (const [context, time] of times) {
    returnedContexts.get(context.owner)?.push(context);
    const previous = callTimes.get(context.owner);
    callTimes.set(context.owner, previous === undefined || previous === time ? time : null);
  }
  return { calls, callTimes, returnedContexts };
}
