import type { CallExpression, Expression, Node } from 'oxc-parser';
import type { FunctionNode } from './ast.ts';
import type { Annotation, DiagnosticCode, DiagnosticLevel, HookCounts, MetaValue } from './types.ts';

export type State = 'skip' | 'fixme' | 'todo' | 'expectedToFail';

/** The Vitest options that set a test's state. */
export type StateOption = 'skip' | 'only' | 'todo' | 'fails';

export type Mode = 'parallel' | 'serial' | 'default';

/** A state set by a declaration, a describe or a call such as `test.skip(condition)`. */
export interface StateSetting {
  state: State;
  /** Source text of the condition; null when the state always applies. */
  condition: string | null;
  reason: string | null;
  /** The reason could not be worked out to a string, so `reason` holds its source text. */
  hasDynamicReason: boolean;
  /** The line in the file that sets the state; null for a state from the config. */
  line: number | null;
  /**
   * Set by code in a test or hook body, which runs only when the test does: a state set while the file loads, on the
   * test or a describe around it, keeps the test from getting there.
   */
  afterLoad?: boolean;
}

export interface Span {
  start: number;
  end: number;
}

/** A diagnostic found while reading a file, before test ids exist. */
export interface Problem {
  code: DiagnosticCode;
  /** Where the problem is; null for problems with the whole file. */
  node: Span | null;
  message: string;
  source: string | null;
  /** A level other than the code's usual one, as for a duplicate title, which Playwright rejects and Vitest allows. */
  level?: DiagnosticLevel;
  /** Raised by code in a test, hook or helper body, which runs after the file is loaded and so can't stop it loading. */
  afterLoad?: boolean;
}

export interface Title {
  text: string;
  withoutTags: string;
  isDynamic: boolean;
}

/** Values written on a test or describe itself. */
export interface Details {
  tags: string[];
  annotations: Annotation[];
  locks: string[];
  meta: Record<string, MetaValue> | null;
  run: RunSettings;
}

/** Run settings written in one place; a key that is missing is not set there. */
export interface RunSettings {
  timeout?: number;
  /**
   * A retry setting replaces the whole `retry` of the describes around, delay and condition included; null when it is
   * set to a value the runner can't use.
   */
  retry?: { count: number; delay: number | null; condition: string | null } | null;
  repeats?: number;
  /** Playwright `test.slow()`: the conditions of the calls, any of which makes the test slow; null when one always does. */
  slow?: { conditions: string[] | null };
}

interface Declaration {
  title: Title | null;
  states: StateSetting[];
  isOnly: boolean;
  mode: Mode | null;
  /** Vitest: the line of the describe whose `skip` option reaches this declaration, merged into its options. */
  skipPassedDown?: number;
  details: Details;
  fn: FunctionNode | null;
  /** The function whose code is hashed: `fn`, or a function declared in the file and passed by name. */
  hashed: FunctionNode | null;
  isParameterized: boolean;
  /** Number of cases of `.each` or `.for` when the table is written out; null otherwise. */
  caseCount: number | null;
  problems: Problem[];
}

export interface TestDeclaration extends Declaration {
  kind: 'test';
  title: Title;
  /** Framework-specific names through which the test body can change its own state, such as Vitest's `context.skip`. */
  testContext: unknown;
  /** Names the test function takes from its context, without the framework's own keys. */
  fixtures: string[];
  /** The test function takes its fixtures whole, or keeps the rest of them, so it may use any. */
  takesAllFixtures: boolean;
  /** Uses Vitest 5's `bench` fixture. */
  usesBench: boolean;
  /** Vitest: the state options the test sets itself, to `false` too, which replace those of its tags. */
  ownStateOptions?: StateOption[];
}

export interface SuiteDeclaration extends Declaration {
  kind: 'describe';
  isShuffled: boolean;
  /** What the describe passes down to the calls inside it, such as Vitest's `skip` option; null for nothing. */
  passesDown: unknown;
}

export interface Condition {
  /** `always` and `never` are conditions that could be worked out from the file. */
  applies: 'always' | 'never' | 'sometimes';
  text: string | null;
}

export type ApiCall =
  | TestDeclaration
  | SuiteDeclaration
  | {
      kind: 'modifier';
      state: State;
      condition: Condition;
      reason: string | null;
      hasDynamicReason: boolean;
      problems: Problem[];
    }
  /** `test.describe.configure()`: a mode, locks (Playwright 1.64), a timeout and retries. */
  | { kind: 'configure'; mode: Mode | null; locks: string[]; run: RunSettings; problems: Problem[] }
  /** Playwright `test.setTimeout()` or `test.slow()`, which apply where they are called. */
  | {
      kind: 'run';
      settings: RunSettings;
      /** Source text of the first argument. */ argument: string | null;
      problems: Problem[];
    }
  | {
      kind: 'hook';
      name: keyof HookCounts;
      fn: FunctionNode | null;
      testContext: unknown;
      fixtures: string[];
      takesAllFixtures: boolean;
    }
  /** Playwright `test.step()` or `test.step.skip()`. */
  | { kind: 'step'; title: Title; isSkipped: boolean; fn: FunctionNode | null }
  | { kind: 'annotations'; items: Annotation[]; problems: Problem[] }
  /**
   * A call the runner refuses. When it is shaped like a declaration, as `describe.sequential('title', fn)` is in Vitest
   * 5, `declaration` is what it would declare, so that its tests are listed as not loaded rather than missing.
   */
  | { kind: 'invalid'; problem: Problem; declaration?: TestDeclaration | SuiteDeclaration }
  | { kind: 'other' };

export interface CallContext {
  scopes: readonly Node[];
  /** The test context of the test or hook whose body the call is in, as the framework returned it. */
  testContext: unknown;
  inTest: boolean;
  /** Inside a test or hook body, where calls don't declare tests. */
  inBody: boolean;
  /**
   * What the describe the call is registered in passes down, as the framework returned it: the describe around a
   * helper's call, not where the helper is written. Null outside any describe.
   */
  passedDown: unknown;
  /**
   * What a function declared in the file, or imported from a local module, returns, for a call on its result such as
   * `conditionalTest({ min: 22 })('title', fn)`; null when the name is not a function the scan can find.
   */
  returnsOf(name: string, scopes: readonly Node[]): Returns | null;
}

/** The values a function returns, read by the adapter of the file that writes the function. */
export interface Returns {
  adapter: Adapter;
  /** Each value with the scopes around it; null when the function may return no value, or returns a promise. */
  values: { expression: Expression; scopes: readonly Node[] }[] | null;
  /** What the functions the values call return, looked up in the file that writes the function. */
  returnsOf: CallContext['returnsOf'];
}

/** A module read to see whether it exports a custom `test` object. */
export interface ModuleSource {
  code: string;
  relativeFilePath: string;
  /** Reads the modules this module imports in turn. */
  readModule: ModuleReader;
}

/** Reads the module an import refers to, or says why it can't, as in "could not be read". */
export type ModuleReader = (specifier: string) => ModuleSource | { reason: string };

export interface Adapter {
  /** Problems found in imports, reported once per file. */
  problems: Problem[];
  /** Tags that apply to every test in the file. */
  fileTags: string[];
  /** Where each of `fileTags` is written. */
  fileTagSpans: Span[];
  usesGlobals: boolean;
  classify(call: CallExpression, context: CallContext): ApiCall | null;
  /**
   * The test or describe function a value holds, in the adapter's own terms, as `it.skip` in `return it.skip`; null
   * when it holds none. A function the value calls is followed to what it returns through `returnsOf`.
   */
  testFunction(expression: Expression, scopes: readonly Node[], returnsOf: CallContext['returnsOf']): unknown;
}
