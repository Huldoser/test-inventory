import { createInventory } from './inventory.ts';
import {
  checkComments,
  checkFramework,
  checkObject,
  checkString,
  checkVersion,
  invalid,
  majorMinor,
  toPosixPath,
  type ScanSourceOptions,
} from './options.ts';
import { scanFile } from './scan-file.ts';
import type { Inventory } from './types.ts';

/**
 * Scans the code of one test file, without reading anything from disk.
 *
 * Throws a `TypeError` for invalid options. Problems in the code itself are reported as diagnostics.
 * A custom `test` object imported from a local file can't be followed here; use `scan()` for that.
 */
export function scanSource(options: ScanSourceOptions): Inventory {
  const checked = checkObject(options, 'options');
  if (typeof checked.code !== 'string') throw invalid('options.code', 'a string');
  const relativeFilePath = toPosixPath(checkString(checked.relativeFilePath, 'options.relativeFilePath'));
  const framework = checkFramework(checked.framework, 'options.framework');
  const frameworkVersion = checkVersion(checked.frameworkVersion, 'options.frameworkVersion');
  const comments = checkComments(checked.comments, 'options.comments');
  const result = scanFile(checked.code, relativeFilePath, {
    framework,
    version: majorMinor(frameworkVersion),
    comments,
    readModule: null,
    root: null,
  });
  return createInventory(framework, frameworkVersion, 1, [result], []);
}
