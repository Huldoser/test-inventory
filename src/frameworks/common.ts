import type {
  Argument,
  CallExpression,
  Expression,
  Node,
  StringLiteral,
  TemplateLiteral,
  VariableDeclarator,
} from 'oxc-parser';
import { isFunctionNode, isStringLiteral, propertyKey, propertyName, unwrap, type FunctionNode } from '../ast.ts';
import type { ApiCall, CallContext, Condition, Problem, Returns, Span, Title } from '../model.ts';
import { snippet, type SourceText } from '../source.ts';
import type { DiagnosticCode } from '../types.ts';
import { isKey, type Resolved, type Value, type Values } from '../values.ts';

/** One step of a call chain such as `test.describe.only` or `test.skipIf(isCI)`. */
export interface Link {
  name: string;
  /** Arguments when this step is called, as in `skipIf(isCI)`. */
  args: Argument[] | null;
  /** The table when this step is a tagged template, as in ``each`...` ``. */
  template: TemplateLiteral | null;
}

export interface Chain {
  /** The expression the chain starts from, usually an identifier such as `test`. */
  base: Expression;
  links: Link[];
}

/** Everything a framework needs to read the values in one file. */
export interface FileContext {
  source: SourceText;
  values: Values;
  /** Framework version as `[major, minor]`; null when unknown, which means the newest rules apply. */
  version: [number, number] | null;
}

export function readChain(callee: Expression): Chain | null {
  const node = unwrap(callee);
  switch (node.type) {
    case 'SequenceExpression': {
      // `(0, test)(...)`, as bundlers and some code write a call without `this`.
      const last = node.expressions[node.expressions.length - 1];
      const plain = node.expressions.slice(0, -1).every((expression) => expression.type === 'Literal');
      return plain ? readChain(last) : { base: node, links: [] };
    }
    case 'MemberExpression': {
      const chain = readChain(node.object);
      const name = propertyName(node);
      if (!chain || name === null) return null;
      chain.links.push({ name, args: null, template: null });
      return chain;
    }
    case 'CallExpression': {
      const chain = readChain(node.callee);
      if (!chain) return null;
      const last = chain.links.at(-1);
      if (!last || last.args || last.template) return { base: node, links: [] };
      last.args = node.arguments;
      return chain;
    }
    case 'TaggedTemplateExpression': {
      const chain = readChain(node.tag);
      const last = chain?.links.at(-1);
      if (!chain || !last || last.args || last.template) return null;
      last.template = node.quasi;
      return chain;
    }
    default:
      return { base: node, links: [] };
  }
}

export function atLeast(version: [number, number] | null, major: number, minor: number): boolean {
  return version === null || version[0] > major || (version[0] === major && version[1] >= minor);
}

export function problem(
  code: DiagnosticCode,
  node: Span | null,
  message: string,
  source: string | null = null,
): Problem {
  return { code, node, message, source };
}

export function text(file: FileContext, node: Node): string {
  return file.source.slice(node.start, node.end);
}

/** Whether an argument is written as a title: a string or a template. */
export function isTitleLiteral(node: Argument | undefined): node is StringLiteral | TemplateLiteral {
  return node !== undefined && (isStringLiteral(node) || node.type === 'TemplateLiteral');
}

/** Whether a name reads like a test function: `test`, `it`, `describe`, `suite` or a name ending in `Test`. */
export function isTestName(name: string): boolean {
  return /^(?:test|it|describe|suite)$|Test$/.test(name);
}

/** A variable declared with a value, as in `const it = await createTester()`. */
export type CreatedDeclarator = VariableDeclarator & { init: Expression };

/**
 * Whether a local variable may hold a test object: it is created by a call, perhaps awaited, or taken from another
 * value. A function, literal, array or object written in place is not a test object.
 */
export function mayHoldTestObject(declarator: VariableDeclarator): declarator is CreatedDeclarator {
  if (declarator.init === null) return false;
  const init = unwrap(declarator.init);
  const value = init.type === 'AwaitExpression' ? unwrap(init.argument) : init;
  return (
    value.type === 'CallExpression' ||
    value.type === 'MemberExpression' ||
    value.type === 'Identifier' ||
    value.type === 'ConditionalExpression' ||
    value.type === 'LogicalExpression'
  );
}

/**
 * A warning for a local variable that reads like a test object, such as `const it = await createTester()`, and is
 * called like one. The call that creates it can't be followed, so its calls are read as tests on trust.
 */
export function localTestObject(file: FileContext, name: string, declarator: CreatedDeclarator): Problem {
  const created = snippet(text(file, declarator.init));
  return problem(
    'local-test-object',
    declarator,
    `'${name}' is created by ${created}, which is not followed; calls shaped like tests are read as tests.`,
    created,
  );
}

/**
 * A warning for a call shaped like a test on what a function named like a test object returns, as in
 * `conditionalTest({ min: 22 })('title', fn)`, when the function can't be found. What it returns is read on trust.
 */
export function returnedTestObject(file: FileContext, call: CallExpression): Problem {
  const created = snippet(text(file, call));
  return problem(
    'local-test-object',
    call,
    `What ${created} returns is not followed; calls on it shaped like tests are read as tests.`,
    created,
  );
}

/**
 * The test or describe function a function returns, in the adapter's terms: what all its values have in common, as
 * `shared` combines two; null when it may return something else.
 */
export function returnedFunction<T>(returns: Returns, shared: (a: T | null, b: T | null) => T | null): T | null {
  const { values } = returns;
  // A function that returns what it returns itself, through others or not, ends the lookup.
  if (!values || reading.has(returns)) return null;
  if (!read.has(returns)) {
    reading.add(returns);
    const found = values.map(
      ({ expression, scopes }) => returns.adapter.testFunction(expression, scopes, returns.returnsOf) as T,
    );
    reading.delete(returns);
    read.set(returns, found.slice(1).reduce<T | null>(shared, found[0]));
  }
  return read.get(returns) as T | null;
}

/** The functions whose values are being read, each one returning what the next returns. */
const reading = new Set<Returns>();
/** What each function returns, read once however many calls and functions use it. */
const read = new WeakMap<Returns, unknown>();

/** A title written as a string, a template, or text joined to one, as in `'cycles through ' + venue`. */
function isTitleShaped(node: Argument | undefined): boolean {
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    return isTitleShaped(node.left) || isTitleShaped(node.right);
  }
  return isTitleLiteral(node);
}

/**
 * Whether a call on a name imported from a local file is shaped like a test declaration, `name('title', fn)`, and
 * so worth following to see if the name is a custom test object.
 */
export function looksLikeDeclaration(args: readonly Argument[]): boolean {
  const last = args.at(-1);
  // The body is the last argument, a function or a function passed by name, or a function before a timeout, as in
  // Vitest's `test('title', fn, 30_000)`.
  const body =
    isFunctionNode(last) ||
    last?.type === 'Identifier' ||
    last?.type === 'MemberExpression' ||
    (args.length === 3 && isFunctionNode(args[1]));
  return isTitleShaped(args.at(0)) && args.length >= 2 && args.length <= 3 && body;
}

/**
 * A call the runner refuses. Shaped like a declaration outside any test or hook, it is also declared, without what
 * makes it fail, so that its tests, and those of a describe, are listed as not loaded rather than missing.
 */
export function refused(call: CallExpression, refusal: Problem, context: CallContext, declare: () => ApiCall): ApiCall {
  const declared = context.inBody || !looksLikeDeclaration(call.arguments) ? null : declare();
  // A declaration refused for a second reason as well, as for its options, is reported for the first.
  const found = declared?.kind === 'invalid' ? declared.declaration : declared;
  const declaration = found?.kind === 'test' || found?.kind === 'describe' ? found : undefined;
  return { kind: 'invalid', problem: refusal, declaration };
}

/**
 * Whether a call shaped like a test, through an import that can't be followed, is worth an error: the name reads like
 * a test function, or a member such as `.describe` follows it. Helpers such as `join('root', file)` and
 * `waitForSpan('checkout', (span) => ...)` have the shape too, but are not tests.
 */
export function mayDeclareTests(name: string, links: Link[]): boolean {
  return isTestName(name) || links.length > 0;
}

/** A function declared in the file and passed by name, as in `test('fills an order', checkFill)`; null otherwise. */
export function namedFunction(
  file: FileContext,
  scopes: readonly Node[],
  node: Argument | undefined,
): FunctionNode | null {
  if (node?.type !== 'Identifier') return null;
  const declaration = file.values.declarationOf(node.name, scopes);
  if (declaration?.type === 'FunctionDeclaration') return declaration;
  const init = declaration?.type === 'VariableDeclarator' && declaration.init ? unwrap(declaration.init) : null;
  return isFunctionNode(init) ? init : null;
}

export function findFunction(args: readonly Argument[], from = 0): FunctionNode | null {
  for (const arg of args.slice(from)) {
    if (isFunctionNode(arg)) return arg;
  }
  return null;
}

/** A hook's function: written in the call, or declared in the file and passed by name, as in `beforeEach(signIn)`. */
export function hookFunction(
  file: FileContext,
  scopes: readonly Node[],
  args: readonly Argument[],
): FunctionNode | null {
  return findFunction(args) ?? args.map((arg) => namedFunction(file, scopes, arg)).find((fn) => fn !== null) ?? null;
}

/** Reads a title. A title that cannot be worked out keeps its source text and gets a `dynamic-title` warning. */
export function readTitle(
  file: FileContext,
  scopes: readonly Node[],
  node: Argument,
  options: { stripTags: boolean; functionNames: boolean },
): { title: Title; problem: Problem | null } {
  const expression = node.type === 'SpreadElement' ? null : node;
  const resolved = expression ? file.values.resolve(expression, scopes) : null;
  let value: string | null = resolved?.ok && typeof resolved.value === 'string' ? resolved.value : null;
  // Vitest turns a title that is a number, boolean or null into a string.
  const other = resolved?.ok ? resolved.value : undefined;
  if (
    value === null &&
    options.functionNames &&
    (other === null || typeof other === 'number' || typeof other === 'boolean')
  ) {
    value = String(other);
  }
  if (value === null && options.functionNames && expression?.type === 'Identifier') {
    value = file.values.isFunction(expression.name, scopes) ? expression.name : null;
  }
  if (value !== null) {
    const withoutTags = options.stripTags ? value.replace(/@\S+/g, ' ').replace(/\s+/g, ' ').trim() : value;
    return { title: { text: value, withoutTags, isDynamic: false }, problem: null };
  }
  const source = text(file, node);
  const from = resolved && !resolved.ok ? resolved.importedFrom : null;
  return {
    title: { text: source, withoutTags: source, isDynamic: true },
    problem: problem(
      'dynamic-title',
      node,
      `Title ${snippet(source)}${origin(from)} could not be worked out; the record uses its source text.`,
      snippet(source),
    ),
  };
}

/** Reads the condition of a call such as `test.skip(condition)`, where a missing condition always applies. */
export function readCondition(file: FileContext, scopes: readonly Node[], node: Argument | undefined): Condition {
  if (node === undefined) return { applies: 'always', text: null };
  if (isFunctionNode(node)) {
    // For `({ browserName }) => browserName === 'webkit'` the condition is the arrow's expression.
    const body = node.type === 'ArrowFunctionExpression' && node.body.type !== 'BlockStatement' ? node.body : node;
    return { applies: 'sometimes', text: snippet(text(file, body)) };
  }
  const resolved = node.type === 'SpreadElement' ? null : file.values.resolve(node, scopes);
  if (resolved?.ok) return { applies: resolved.value ? 'always' : 'never', text: null };
  return { applies: 'sometimes', text: snippet(text(file, node)) };
}

/**
 * Reads a reason, such as the description of `test.skip(condition, description)`, the way a title is read: its value
 * when it can be worked out, otherwise its source text with a `dynamic-reason` warning.
 */
export function readReason(
  file: FileContext,
  scopes: readonly Node[],
  node: Argument | undefined,
): { reason: string | null; isDynamic: boolean; problem: Problem | null } {
  if (node === undefined) return { reason: null, isDynamic: false, problem: null };
  const resolved = node.type === 'SpreadElement' ? null : file.values.resolve(node, scopes);
  if (resolved?.ok && typeof resolved.value === 'string')
    return { reason: resolved.value, isDynamic: false, problem: null };
  const source = snippet(text(file, node));
  const from = resolved && !resolved.ok ? resolved.importedFrom : null;
  return {
    reason: source,
    isDynamic: true,
    problem: problem(
      'dynamic-reason',
      node,
      `Reason ${source}${origin(from)} could not be worked out; the record uses its source text.`,
      source,
    ),
  };
}

/** One property of an options object: its source node and its value, if that could be worked out. */
export interface OptionValue {
  node: Expression;
  resolved: Resolved;
}

/** An options object read property by property, with the parts that could not be worked out. */
export interface Options {
  values: Map<string, OptionValue>;
  /** An object, spread or computed key whose properties are unknown. */
  unresolved: { node: Node; importedFrom: string | null }[];
}

/** Reads an options object property by property, so one unknown value doesn't hide the others. */
export function readOptions(file: FileContext, scopes: readonly Node[], node: Argument): Options {
  const options: Options = { values: new Map(), unresolved: [] };
  if (node.type === 'SpreadElement') {
    options.unresolved.push({ node, importedFrom: null });
    return options;
  }
  const expression = unwrap(node);
  if (expression.type !== 'ObjectExpression') {
    const resolved = file.values.resolve(expression, scopes);
    if (!resolved.ok || !isRecord(resolved.value)) {
      options.unresolved.push({ node, importedFrom: resolved.ok ? null : resolved.importedFrom });
      return options;
    }
    for (const [key, value] of Object.entries(resolved.value)) {
      options.values.set(key, { node, resolved: { ok: true, value } });
    }
    return options;
  }
  for (const property of expression.properties) {
    if (property.type === 'SpreadElement') {
      const spread = readOptions(file, scopes, property.argument);
      for (const [key, value] of spread.values) options.values.set(key, value);
      options.unresolved.push(...spread.unresolved);
      continue;
    }
    // A key that isn't computed is a name or a string or number literal.
    const key: Resolved = property.computed
      ? file.values.resolve(property.key as Expression, scopes)
      : {
          ok: true,
          value: property.key.type === 'Identifier' ? property.key.name : (property.key as StringLiteral).value,
        };
    if (key.ok && isKey(key.value)) {
      const value = { node: property.value, resolved: file.values.resolve(property.value, scopes) };
      options.values.set(String(key.value), value);
    } else {
      options.unresolved.push({ node: property, importedFrom: key.ok ? null : key.importedFrom });
    }
  }
  return options;
}

/** Warnings for the parts of an options object that could not be worked out, with what is missing as a result. */
export function unresolvedOptions(file: FileContext, options: Options, result: string): Problem[] {
  return options.unresolved.map(({ node, importedFrom }) => {
    const source = snippet(text(file, node));
    return problem(
      'unresolved-option',
      node,
      `Options object ${source}${origin(importedFrom)} could not be worked out; ${result}.`,
      source,
    );
  });
}

/** The names a function takes from the object pattern of one of its parameters, in source order. */
export function destructuredNames(fn: FunctionNode | null, index: number | null): string[] {
  const parameter = index === null ? undefined : fn?.params[index];
  if (parameter?.type !== 'ObjectPattern') return [];
  const names = parameter.properties.map((property) => (property.type === 'Property' ? propertyKey(property) : null));
  return names.filter((name) => name !== null);
}

/**
 * Whether a function takes one of its parameters whole, as in `(fixtures) => ...`, or keeps the rest of its object
 * pattern, so that any key of it may be used.
 */
export function takesWhole(fn: FunctionNode | null, index: number | null): boolean {
  const parameter = index === null ? undefined : fn?.params[index];
  if (!parameter) return false;
  return (
    parameter.type !== 'ObjectPattern' ||
    parameter.properties.some((property) => property.type === 'RestElement' || property.computed)
  );
}

/** A whole number, such as a timeout in milliseconds; null, with a warning, when it can't be worked out. */
export function readCount(file: FileContext, name: string, option: OptionValue, problems: Problem[]): number | null {
  const { node, resolved } = option;
  if (!resolved.ok) {
    problems.push(unresolvedOption(file, name, node, resolved.importedFrom, 'it is not applied'));
    return null;
  }
  if (Number.isInteger(resolved.value) && (resolved.value as number) >= 0) return resolved.value as number;
  const source = snippet(text(file, node));
  problems.push(
    problem('unresolved-option', node, `Option ${name}: ${source} is not a whole number; it is not applied.`, source),
  );
  return null;
}

/** A warning for one option whose value could not be worked out. */
export function unresolvedOption(
  file: FileContext,
  name: string,
  node: Node,
  importedFrom: string | null,
  result: string,
): Problem {
  const source = snippet(text(file, node));
  return problem(
    'unresolved-option',
    node,
    `Option ${name}: ${source}${origin(importedFrom)} could not be worked out; ${result}.`,
    source,
  );
}

function isRecord(value: Value): value is Record<string, Value> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface Strings {
  values: string[];
  unresolved: { node: Node; importedFrom: string | null }[];
}

/** Reads a value that may be a string or an array of strings, as tags and locks are. */
export function readStrings(file: FileContext, scopes: readonly Node[], option: OptionValue): Strings {
  const { node, resolved } = option;
  if (resolved.ok && typeof resolved.value === 'string') return { values: [resolved.value], unresolved: [] };
  if (resolved.ok && Array.isArray(resolved.value) && resolved.value.every((value) => typeof value === 'string')) {
    return { values: resolved.value, unresolved: [] };
  }
  const expression = unwrap(node);
  if (expression.type !== 'ArrayExpression') {
    return { values: [], unresolved: [{ node, importedFrom: resolved.ok ? null : resolved.importedFrom }] };
  }
  // Keep the items that can be worked out, so one imported tag doesn't hide the others.
  const strings: Strings = { values: [], unresolved: [] };
  for (const element of expression.elements) {
    if (element === null) continue;
    const item = element.type === 'SpreadElement' ? element.argument : element;
    const parts = readStrings(file, scopes, { node: item, resolved: file.values.resolve(item, scopes) });
    strings.values.push(...parts.values);
    strings.unresolved.push(...parts.unresolved);
  }
  return strings;
}

/** Names the module a value came from, for diagnostic messages. */
export function origin(importedFrom: string | null): string {
  return importedFrom ? ` comes from '${importedFrom}' and` : '';
}
