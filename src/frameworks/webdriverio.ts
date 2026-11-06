import type { CallExpression } from 'oxc-parser';
import type { ApiCall, CallContext, ModuleReader } from '../model.ts';
import type { ParsedFile } from '../parse.ts';
import type { FileContext } from './common.ts';
import { JasmineAdapter } from './jasmine.ts';
import { MochaAdapter, type MochaInterface } from './mocha.ts';

/** The framework a WebdriverIO config runs its specs with; Cucumber's are `.feature` files, which the scan doesn't read. */
export type WebdriverIOFramework = 'mocha' | 'jasmine';

/**
 * The file as the framework WebdriverIO runs it with sees it: the version is that of the Mocha or Jasmine its adapter
 * depends on, Mocha 12 and Jasmine 6 from WebdriverIO 10, Mocha 10.8 and Jasmine 5 before.
 */
function bundled(file: FileContext, from10: [number, number], before: [number, number]): FileContext {
  if (file.version === null) return file;
  return { ...file, version: file.version[0] >= 10 ? from10 : before };
}

/**
 * WebdriverIO on Mocha: Mocha's calls, where a number after a test's function is a retry count. WebdriverIO catches
 * a call Mocha refuses while it loads the file, runs the tests declared before it, and then fails the file.
 */
export class WebdriverIOMochaAdapter extends MochaAdapter {
  protected override readonly trailingRetries = true;
  protected override readonly refusedEffect =
    'WebdriverIO runs only the tests declared above it in the file, and none of the spec files after it in its worker';

  constructor(parsed: ParsedFile, file: FileContext, readModule: ModuleReader | null, ui: MochaInterface = 'bdd') {
    super(parsed, bundled(file, [12, 0], [10, 8]), readModule, ui);
  }

  override classify(call: CallExpression, context: CallContext): ApiCall | null {
    const found = super.classify(call, context);
    return found?.kind === 'invalid' ? { ...found, problem: { ...found.problem, keepsEarlierTests: true } } : found;
  }
}

/**
 * WebdriverIO on Jasmine: Jasmine's calls, where a second number after a spec's function, after the timeout, is a
 * retry count. A call Jasmine refuses at the top level of a file fails the whole worker that runs it.
 */
export class WebdriverIOJasmineAdapter extends JasmineAdapter {
  protected override readonly trailingRetries = true;
  protected override readonly refusedEffect =
    'WebdriverIO fails the worker that runs the spec file, which runs none of its specs, nor those of the files grouped with it';

  constructor(parsed: ParsedFile, file: FileContext, readModule: ModuleReader | null) {
    super(parsed, bundled(file, [6, 3], [5, 0]), readModule);
  }
}
