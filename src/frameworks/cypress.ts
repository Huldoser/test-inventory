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
    const second = args.at(1);
    if (args.length >= 3) return { body: args.at(2), options: second as Argument };
    // `it(title, { retries: 2 })` without a function is pending, as any test without one.
    if (second?.type === 'ObjectExpression') {
      return { body: undefined, options: second };
    }
    return { body: second, options: null };
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
      const message = "Cypress 16 no longer takes env in a test's config; Cypress.expose() or cy.env() set it.";
      problems.push(problem('removed-api', env.node, message, source));
    }
  }

  /** A retry count, or `runMode` of `{ runMode, openMode }`, which `cypress run` uses. */
  private retryCount(option: OptionValue, context: CallContext, problems: TestDeclaration['problems']): number | null {
    const node = unwrap(option.node);
    if (node.type !== 'ObjectExpression') return readCount(this.file, 'retries', option, problems);
    const runMode = readOptions(this.file, context.scopes, node).values.get('runMode');
    return runMode ? readCount(this.file, 'retries.runMode', runMode, problems) : null;
  }
}
