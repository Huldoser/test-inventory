import type { CallExpression, Node } from 'oxc-parser';
import type { FunctionNode } from './ast.ts';
import type { Annotation, DiagnosticCode, DiagnosticLevel, MetaValue } from './types.ts';

export type State = 'skip' | 'fixme' | 'todo' | 'expectedToFail';

export type Mode = 'parallel' | 'serial' | 'default';

/** A state set by a declaration, a describe or a call such as `test.skip(condition)`. */
export interface StateSetting {
  state: State;
  /** Source text of the condition; null when the state always applies. */
  condition: string | null;
  reason: string | null;
  /** The reason could not be worked out to a string, so `reason` holds its source text. */
  hasDynamicReason: boolean;
  line: number;
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
}

interface Declaration {
  title: Title | null;
  states: StateSetting[];
  isOnly: boolean;
  mode: Mode | null;
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
}

export interface SuiteDeclaration extends Declaration {
  kind: 'describe';
  isShuffled: boolean;
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
  | { kind: 'mode'; mode: Mode }
  | { kind: 'hook'; fn: FunctionNode | null; testContext: unknown }
  | { kind: 'annotations'; items: Annotation[]; problems: Problem[] }
  | { kind: 'invalid'; problem: Problem }
  | { kind: 'other' };

export interface CallContext {
  scopes: readonly Node[];
  /** The test context of the test or hook whose body the call is in, as the framework returned it. */
  testContext: unknown;
  inTest: boolean;
  /** Inside a test or hook body, where calls don't declare tests. */
  inBody: boolean;
}

/** A module read to see whether it exports a custom `test` object. */
export interface ModuleSource {
  code: string;
  relativeFilePath: string;
}

/** Reads the module an import refers to, or says why it can't, as in "could not be read". */
export type ModuleReader = (specifier: string) => ModuleSource | { reason: string };

export interface Adapter {
  /** Problems found in imports, reported once per file. */
  problems: Problem[];
  /** Tags that apply to every test in the file. */
  fileTags: string[];
  usesGlobals: boolean;
  classify(call: CallExpression, context: CallContext): ApiCall | null;
}
