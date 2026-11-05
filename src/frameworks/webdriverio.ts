import type { ModuleReader } from '../model.ts';
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
 * WebdriverIO on Mocha: Mocha's calls, where a number after a test's function is a retry count. WebdriverIO runs each
 * spec file in a worker of its own, so a call Mocha refuses fails that file only.
 */
export class WebdriverIOMochaAdapter extends MochaAdapter {
  protected override readonly trailingRetries = true;
  protected override readonly refusedEffect = 'WebdriverIO fails the spec file and runs none of its tests';

  constructor(parsed: ParsedFile, file: FileContext, readModule: ModuleReader | null, ui: MochaInterface = 'bdd') {
    super(parsed, bundled(file, [12, 0], [10, 8]), readModule, ui);
  }
}

/**
 * WebdriverIO on Jasmine: Jasmine's calls, where a second number after a spec's function, after the timeout, is a
 * retry count. A call Jasmine refuses at the top level of a file fails that file only.
 */
export class WebdriverIOJasmineAdapter extends JasmineAdapter {
  protected override readonly trailingRetries = true;
  protected override readonly refusedEffect = 'WebdriverIO fails the spec file and runs none of its specs';

  constructor(parsed: ParsedFile, file: FileContext, readModule: ModuleReader | null) {
    super(parsed, bundled(file, [6, 3], [5, 0]), readModule);
  }
}
