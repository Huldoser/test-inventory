import type { Argument, CallExpression } from 'oxc-parser';
import { unwrap } from '../ast.ts';
import type { CallContext, ModuleReader, SuiteDeclaration, TestDeclaration } from '../model.ts';
import type { ParsedFile } from '../parse.ts';
import { snippet } from '../source.ts';
import {
  atLeast,
  problem,
  readCount,
  readOptions,
  readStrings,
  text,
  unresolvedOptions,
  type FileContext,
  type OptionValue,
} from './common.ts';
import { dialect, MochaAdapter } from './mocha.ts';

/**
 * Cypress runs its specs on its own copy of Mocha's BDD interface. A test or describe takes Cypress's settings as an
 * object before its function, as `it(title, { retries: 2 }, fn)`, and Cypress sets no Mocha timeout or retries from
 * `this`.
 */
export class CypressAdapter extends MochaAdapter {
  protected override readonly readsContextSettings = false;
  protected override readonly refusedEffect = 'Cypress fails the spec and runs none of its tests';

  constructor(parsed: ParsedFile, file: FileContext, readModule: ModuleReader | null) {
    super(parsed, file, readModule, 'bdd', { ...dialect('bdd'), name: 'Cypress', source: 'cypress' });
  }

  protected override splitArguments(args: CallExpression['arguments']): {
    body: Argument | undefined;
    options: Argument | null;
  } {
    // Cypress takes the config only before a function: `it(title, { retries: 2 })` gives Mocha the object as the test's
    // function, so the test runs, and fails.
    if (args.length >= 3) return { body: args.at(2), options: args.at(1) as Argument };
    return { body: args.at(1), options: null };
  }

  /**
   * Cypress's test config: `retries`, a count or `{ runMode, openMode }`, of which `cypress run` takes `runMode`;
   * `browser`, which skips the test in the browsers it leaves out; `@cypress/grep`'s `tags`; and `env`, which Cypress
   * 16 refuses in a test's config.
   */
  protected override withOptions(
    declared: TestDeclaration | SuiteDeclaration,
    options: Argument,
    context: CallContext,
  ): void {
    const read = readOptions(this.file, context.scopes, options);
    const { problems, details } = declared;
    problems.push(...unresolvedOptions(this.file, read, 'its retries, tags and browser are missing'));
    const retries = read.values.get('retries');
    if (retries) {
      const count = this.retryCount(retries, context, problems);
      if (count !== null) details.run = { ...details.run, retry: { count, delay: null, condition: null } };
    }
    const tags = read.values.get('tags');
    if (tags) details.tags.push(...readStrings(this.file, context.scopes, tags).values);
    const browser = read.values.get('browser');
    if (browser) {
      const line = this.file.source.line(browser.node.start);
      const condition = `browser: ${snippet(text(this.file, browser.node))}`;
      declared.states.push({ state: 'skip', condition, reason: null, hasDynamicReason: false, line });
    }
    const env = read.values.get('env');
    if (env && atLeast(this.file.version, 16, 0)) {
      const source = snippet(text(this.file, env.node));
      const message =
        "Cypress 16 no longer takes env in a test's or describe's config, and fails each test it applies to when the test runs; expose: { KEY: value } sets a value the browser reads.";
      problems.push(problem('removed-api', env.node, message, source));
    }
  }

  /**
   * A retry count, or `runMode` of `{ runMode, openMode }`, which `cypress run` uses; null when it is `null`, which
   * Cypress takes as no retries set, or can't be worked out.
   */
  private retryCount(option: OptionValue, context: CallContext, problems: TestDeclaration['problems']): number | null {
    const node = unwrap(option.node);
    if (node.type !== 'ObjectExpression') return this.count('retries', option, problems);
    const runMode = readOptions(this.file, context.scopes, node).values.get('runMode');
    return runMode ? this.count('retries.runMode', runMode, problems) : null;
  }

  private count(name: string, option: OptionValue, problems: TestDeclaration['problems']): number | null {
    if (option.resolved.ok && option.resolved.value === null) return null;
    return readCount(this.file, name, option, problems);
  }
}
