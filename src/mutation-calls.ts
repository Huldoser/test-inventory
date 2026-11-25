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
import {
  arrayArguments,
  arrayPropertyReader,
  type ArrayChange,
  type ArrayMethod,
  type PropertySource,
} from './mutation-arrays.ts';
import type { Values } from './values.ts';

export interface MutationCallSite {
  call: CallExpression;
  scopes: readonly Node[];
  statement: Node | null;
  runsLater: boolean;
  bindOwner?: Expression;
  arrayMethod?: string;
  accessor?: 'get' | 'set';
}

export interface MethodWrite {
  expression: Node;
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
  suspensions: readonly number[],
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

  const arrayChanges = new Map<Expression, ArrayChange[]>();
  const helperEdits: ArrayChange[] = methodWrites.filter((write) => write.owner !== program);
  for (const { site, owner } of sites.values()) {
    if (!site.arrayMethod) continue;
    const member = unwrapChain(site.call.callee) as MemberExpression;
    const { value } = constantValue(member.object, site.scopes);
    const edit: ArrayMethod = {
      expression: site.call,
      object: member.object,
      args: arrayArguments(site.call, site.scopes),
      name: site.arrayMethod,
      scopes: site.scopes,
      owner,
      end: site.call.end,
      unconditional: site.statement?.type === 'ExpressionStatement' && site.statement.expression === site.call,
    };
    if (value.type !== 'ArrayExpression') {
      if (owner !== program) helperEdits.push(edit);
      continue;
    }
    const changes = arrayChanges.get(value) ?? [...(objectWrites.get(value) ?? [])];
    changes.push(edit);
    arrayChanges.set(value, changes);
  }
  for (const changes of arrayChanges.values()) changes.sort((a, b) => a.end - b.end);
  const arrayReaders = new Map<Expression, ReturnType<typeof arrayPropertyReader>>();
  const spreadLength = (source: Expression, scopes: readonly Node[]) => {
    const { value } = constantValue(source, scopes);
    if (value.type !== 'ArrayExpression' || arrayChanges.has(value) || objectWrites.has(value)) return null;
    const elements = [...literalArguments(value.elements)];
    return elements.some((element) => element?.type === 'SpreadElement') ? null : elements.length;
  };
  const memberSources = (
    value: Expression,
    scopes: readonly Node[],
    key: string | null,
    time: number | null,
  ): PropertySource[] => {
    const changes = arrayChanges.get(value);
    if (changes && value.type === 'ArrayExpression') {
      let read = arrayReaders.get(value);
      if (!read) {
        read = arrayPropertyReader(value, scopes, program, changes, spreadLength);
        arrayReaders.set(value, read);
      }
      const edited = read(key, time);
      if (edited) return edited;
    }
    const sources = Array.from(property({ value, path: [] }, key), (ref) => ({ ref, scopes }));
    let accessorOnly = sources.every(({ ref }) => ref?.accessor);
    for (const write of writesAt(value, key, time)) {
      if (accessorOnly && write.assigned) continue;
      if (!write.assigned) accessorOnly = false;
      if (write.unconditional && time !== null && key !== null && key === write.name) sources.length = 0;
      sources.push({ scopes: write.scopes, ref: write.assigned && { value: write.assigned, path: [] } });
    }
    return sources;
  };
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
    if (ref.capture) return [source];
    let { value, scopes } = constantValue(ref.value, source.scopes);
    let path = ref.path;
    if (value.type === 'MemberExpression') {
      const object = constantValue(value.object, scopes);
      if (arrayChanges.has(object.value)) {
        path = [memberKey(value), ...path];
        readTimes = [spreadTime(value, scopes, invocationTime), ...readTimes];
        ({ value, scopes } = object);
      }
    }
    if (!path.length || value.type !== 'ArrayExpression' || seen.has(value)) return [source];
    seen.add(value);
    const [key, ...suffix] = path;
    const [time, ...later] = readTimes;
    const choices: { source: ParameterSource; times: (number | null)[] }[] = [];
    for (const { ref: child, scopes: at } of memberSources(value, scopes, key, time))
      if (child)
        choices.push({
          source: { ...source, scopes: at, ref: { ...ref, value: child.value, path: [...child.path, ...suffix] } },
          times: [...child.path.map(() => spreadTime(child.value, at, invocationTime)), ...later],
        });
    return choices.flatMap((choice) => reflectSources(choice.source, choice.times, invocationTime, new Set(seen)));
  };
  const bodyOperations = new Map<Node, (ArrayChange | MutationCallSite)[]>();
  for (const [owner, entries] of callsByOwner) if (owner !== program) bodyOperations.set(owner, [...entries]);
  for (const edit of helperEdits) {
    const entries = bodyOperations.get(edit.owner);
    if (entries) entries.push(edit);
    else bodyOperations.set(edit.owner, [edit]);
  }
  const endOf = (operation: ArrayChange | MutationCallSite) =>
    'call' in operation ? operation.call.end : operation.end;
  for (const entries of bodyOperations.values()) entries.sort((a, b) => endOf(a) - endOf(b));
  const schedules = new Map<Node, { straight: Set<Node>; awaitedAt: number }>();
  const writeSchedule = (body: Node) => {
    let schedule = schedules.get(body);
    if (schedule) return schedule;
    let awaitedAt = Infinity;
    const straight = new Set<Node>();
    if (body.type === 'BlockStatement') {
      let unconditional = true;
      for (const statement of body.body) {
        if (statement.type === 'ExpressionStatement') {
          if (unconditional) straight.add(statement.expression);
          if (statement.expression.type === 'AwaitExpression') awaitedAt = Math.min(awaitedAt, statement.end);
        } else if (statement.type === 'VariableDeclaration') {
          if (statement.declarations.some((decl) => decl.init?.type === 'AwaitExpression'))
            awaitedAt = Math.min(awaitedAt, statement.end);
        } else unconditional = false;
      }
    } else straight.add(body);
    schedule = { straight, awaitedAt };
    schedules.set(body, schedule);
    return schedule;
  };
  type ArgumentLookup = (
    expression: Expression,
    at: readonly Node[],
  ) => {
    parameter: boolean;
    choices: { value: Expression; scopes: readonly Node[] }[];
  };
  interface ArrayEdit {
    array: Expression;
    change: ArrayChange;
  }
  const invocationSources = (frame: HelperInvocation, parent?: ArgumentLookup): ArgumentLookup => {
    return (expression, at) => {
      const source = constantValue(expression, at);
      const name = source.value.type === 'Identifier' ? source.value.name : 'this';
      const declared =
        source.value.type === 'ThisExpression'
          ? source.scopes.findLast(
              (scope) => scope.type === 'FunctionDeclaration' || scope.type === 'FunctionExpression',
            )
          : source.value.type === 'Identifier' && values.declarationOf(name, source.scopes);
      const binding = declared && (declared === frame.fn ? frame : enclosingFactory(frame.context, declared));
      if (!binding) return { parameter: false, choices: [{ value: expression, scopes: at }] };
      const ownerBody = binding.fn.body as Node;
      if (values.assignedIn(ownerBody, false).has(name) || values.assignedIn(ownerBody).has('arguments'))
        return { parameter: true, choices: [] };
      const choices = binding.parameters
        .filter((param) => param.name === name && param.ref.rest === undefined)
        .flatMap((param) =>
          reflectSources(
            param,
            param.ref.path.map(() => binding.call.start),
            binding.call.start,
          ),
        )
        .filter((param) => !param.ref.path.length)
        .flatMap((param) => {
          const scopes = param.ref.capture?.scopes ?? param.scopes;
          return parent ? parent(param.ref.value, scopes).choices : [{ value: param.ref.value, scopes }];
        });
      return { parameter: true, choices };
    };
  };
  const invocationEdits = (
    frame: HelperInvocation,
    end: number,
    definite: boolean,
    active: Set<Node>,
    parent?: ArgumentLookup,
  ): ArrayEdit[] => {
    const operations = bodyOperations.get(frame.fn);
    if (!operations || active.has(frame.fn) || frame.fn.generator) return [];
    active.add(frame.fn);
    const result = new Set<ArrayEdit>();
    const children = new Map<string, ArrayEdit[]>();
    const sources = invocationSources(frame, parent);
    const { straight, awaitedAt } = writeSchedule(frame.fn.body as Node);
    for (const operation of operations) {
      const expression = 'call' in operation ? operation.call : operation.expression;
      const when = expression.start >= awaitedAt ? (suspensions.find((at) => at >= end) ?? Infinity) : end;
      const certain = definite && !frame.fn.async && straight.has(expression);
      if ('call' in operation) {
        const invocations = visit(operation, frame.context);
        for (const child of invocations) {
          const unique = certain && child.complete && invocations.length === 1;
          // Identical forwarding calls can form a branching graph. Keep each possible source once when an edit repeats.
          const key = JSON.stringify([
            child.context.id,
            when,
            unique,
            child.parameters.map((param) => [
              param.name,
              param.ref.path,
              param.ref.rest,
              param.ref.capture?.call.start,
              sources(param.ref.value, param.ref.capture?.scopes ?? param.scopes).choices.map(
                (choice) => choice.value.start,
              ),
            ]),
          ]);
          let edits = children.get(key);
          if (!edits) {
            edits = invocationEdits(child, when, unique, active, sources);
            children.set(key, edits);
          }
          for (const edit of edits) {
            if (result.delete(edit)) edit.change.unconditional = false;
            result.add(edit);
          }
        }
        continue;
      }
      const write = operation;
      const containers = sources(write.object, write.scopes);
      if (!containers.parameter) continue;
      const unconditional = certain && containers.choices.length === 1;
      const timing = { owner: program, end: when, unconditional };
      const edits: ArrayChange[] = [];
      if ('args' in write) {
        const args = arrayArguments(write.expression, write.scopes, (expr) => sources(expr, write.scopes).choices);
        edits.push({ ...write, ...timing, args });
      } else {
        const replacements = write.assigned
          ? sources(write.assigned, write.scopes).choices
          : [{ value: null, scopes: write.scopes }];
        for (const replacement of replacements)
          edits.push({
            ...write,
            ...timing,
            unconditional: unconditional && replacements.length === 1,
            assigned: replacement.value,
            scopes: replacement.scopes,
          });
      }
      for (const container of containers.choices) {
        const { value: array } = constantValue(container.value, container.scopes);
        if (array.type !== 'ArrayExpression') continue;
        for (const change of edits) result.add({ array, change });
      }
    }
    active.delete(frame.fn);
    return [...result];
  };
  const recordArgumentWrites = (invocation: HelperInvocation, unique: boolean) => {
    const definite =
      unique &&
      invocation.statement?.type === 'ExpressionStatement' &&
      invocation.statement.expression === invocation.call;
    for (const { array, change } of invocationEdits(invocation, invocation.call.end, definite, new Set())) {
      const assignments = objectWrites.get(array) ?? [];
      const changes = arrayChanges.get(array) ?? ('args' in change ? [...assignments] : undefined);
      if (changes) {
        changes.push(change);
        arrayChanges.set(
          array,
          changes.sort((a, b) => a.end - b.end),
        );
      }
      if (!('args' in change)) {
        assignments.push(change);
        objectWrites.set(
          array,
          assignments.sort((a, b) => a.end - b.end),
        );
      }
      arrayReaders.clear();
    }
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
      for (const { ref, scopes: at } of memberSources(value, scopes, step.key, step.time)) {
        if (ref?.accessor && !step.accessor) {
          choices.push(step.read ? produced(step.read.site, step.read.context, seen, rest) : UNKNOWN);
          continue;
        }
        const selected = ref && (ref.path.length || ref.accessor === step.accessor ? ref.value : ref.counterpart);
        if (ref && selected) {
          const projection = ref.path.map((key) => ({
            ...step,
            key,
            time: spreadTime(ref.value, at, frame?.statement ? frame.call.start : step.time),
          }));
          choices.push(callable(selected, at, context, new Set(seen), frame, [...projection, ...rest]));
        } else choices.push(UNKNOWN);
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
          const { methods: options, complete } = methodChoices(
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
          if (!complete || options.length !== 1 || options[0] !== null) definite = false;
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
      if (!complete || !frame.complete) choices.push(UNKNOWN);
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
    let complete = true;
    let possible: (ScopedFunction | null)[] = [null];
    for (const write of methodWrites) {
      if (
        (write.name !== null && write.name !== name) ||
        (write.owner === program && time !== null && write.end > time)
      )
        continue;
      const owners = callable(write.object, write.scopes, caller, new Set(seen));
      if (!owners.targets.some((owner) => functionKey(owner) === functionKey(helper))) continue;
      if (
        write.name === name &&
        write.unconditional &&
        time !== null &&
        owners.definite &&
        owners.targets.length === 1
      ) {
        possible = [];
        complete = true;
      }
      if (write.assigned) {
        const replacement = callable(write.assigned, write.scopes, caller, new Set(seen));
        possible.push(...replacement.targets);
        complete &&= replacement.definite;
      } else possible.push(null);
    }
    return { methods: possible, complete };
  };
  const targetsFor = (site: MutationCallSite, caller: CallbackContext, time: number | null) => {
    const { call, scopes } = site;
    const callee = unwrapChain(call.callee);
    const select = (choice: CallbackChoice, mode: InvocationMode, methodOwner?: Expression) => ({
      targets: choice.targets.map((helper): Target => ({ helper, mode, methodOwner })),
      complete: choice.definite,
    });
    if (callee.type !== 'MemberExpression') return select(callable(callee, scopes, caller), 'direct');
    const name = propertyName(callee);
    const object = unwrapChain(callee.object);
    if (site.accessor) {
      const step = { key: memberKey(callee), accessor: site.accessor, time };
      return select(callable(object, scopes, caller, new Set(), undefined, [step]), 'own', object);
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
      return select(callable(args, scopes, caller, new Set(), undefined, [{ key: '0', time }]), 'reflect');
    }
    const own = select(callable(callee, scopes, caller), 'own', object);
    if (name !== 'call' && name !== 'apply' && name !== 'bind') return own;
    const receivers = callable(site.bindOwner ?? object, scopes, caller);
    let inheritedComplete = receivers.definite;
    for (const helper of receivers.targets) {
      const { methods, complete } = methodChoices(helper, name, caller, time);
      inheritedComplete &&= complete;
      for (const method of methods) {
        if (method) own.targets.push({ helper: method, mode: 'own', methodOwner: object });
        else own.targets.push({ helper, mode: name });
      }
    }
    return { targets: own.targets, complete: own.complete || inheritedComplete };
  };
  const resolving = new Set<CallExpression>();
  const visit = (callSite: MutationCallSite, caller: CallbackContext): HelperInvocation[] => {
    if (resolving.has(callSite.call)) return [];
    resolving.add(callSite.call);
    const found: HelperInvocation[] = [];
    const { call, scopes, statement, runsLater } = callSite;
    const time = statement ? call.start : (times.get(caller) ?? null);
    const { targets: helpers, complete } = targetsFor(callSite, caller, time);
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
      const fresh = !invocation;
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
          complete,
          caller,
          parameters,
          context: contextFor(helper.fn, functions, helper.factory),
        };
        atSite.push(invocation);
      }
      found.push(invocation);
      activate(invocation.context, helper.fn.async || helper.fn.generator ? null : time);
      if (fresh && caller === root && helperEdits.length)
        recordArgumentWrites(invocation, complete && helpers.length === 1);
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
  return { calls, callTimes, returnedContexts, memberSources };
}
