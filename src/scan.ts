import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileDiagnostic } from './diagnostics.ts';
import { findFiles, readFailure } from './files.ts';
import { detectFrameworkVersion, OLDEST } from './framework-version.ts';
import { createInventory } from './inventory.ts';
import {
  checkComments,
  checkFramework,
  checkObject,
  checkStrings,
  checkVersion,
  invalid,
  majorMinor,
  type ScanOptions,
} from './options.ts';
import type { FileRecords } from './records.ts';
import { moduleResolver } from './resolve.ts';
import { scanFile } from './scan-file.ts';
import type { Diagnostic, Framework, Inventory } from './types.ts';
import { globalsCheck } from './vitest-config.ts';

function versionDiagnostics(
  framework: Framework,
  version: string | null,
  source: string,
  range: string | null,
): Diagnostic[] {
  const name = framework === 'playwright' ? 'Playwright' : 'Vitest';
  if (version === null) {
    return [
      fileDiagnostic(
        'unknown-framework-version',
        source,
        `The ${name} version could not be read from the project, so the rules of the newest supported version apply.`,
      ),
    ];
  }
  const [major, minor] = majorMinor(version) as [number, number];
  const [oldestMajor, oldestMinor] = OLDEST[framework];
  if (major < oldestMajor || (major === oldestMajor && minor < oldestMinor)) {
    return [
      fileDiagnostic(
        'unsupported-framework-version',
        source,
        `${name} ${version} is older than ${oldestMajor}.${oldestMinor}, the oldest supported version; the results follow ${oldestMajor}.${oldestMinor}.`,
      ),
    ];
  }
  if (range === null) return [];
  return [
    fileDiagnostic(
      'approximate-framework-version',
      source,
      `Only the range "${range}" was found for ${name}, so the rules of the newest ${major}.x release apply.`,
    ),
  ];
}

/**
 * Scans the test files that match `patterns` under `root`, one file at a time.
 *
 * Throws a `TypeError` for invalid options. Problems with files and code are reported as diagnostics.
 */
export async function scan(options: ScanOptions): Promise<Inventory> {
  const checked = checkObject(options, 'options');
  const patterns = checkStrings(checked.patterns, 'options.patterns', true);
  const framework = checkFramework(checked.framework, 'options.framework');
  const ignore = checkStrings(checked.ignore, 'options.ignore', false);
  const comments = checkComments(checked.comments, 'options.comments');
  const override = checkVersion(checked.frameworkVersion, 'options.frameworkVersion');
  if (checked.root !== undefined && (typeof checked.root !== 'string' || checked.root === '')) {
    throw invalid('options.root', 'a non-empty string');
  }
  const root = path.resolve(checked.root ?? process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory())
    throw invalid('options.root', `a directory, and ${root} is not one`);

  const detected = override === null ? detectFrameworkVersion(root, framework) : null;
  const frameworkVersion = override ?? detected?.version ?? null;
  const range = detected?.range ?? null;
  // With only a range, the newest rules of its major apply, as the newest release in it is the likeliest installed.
  const rules = range
    ? ([(majorMinor(frameworkVersion) as [number, number])[0], Number.MAX_SAFE_INTEGER] as [number, number])
    : majorMinor(frameworkVersion);
  const source = override === null ? (detected?.source ?? 'package.json') : '.';
  const projectDiagnostics = versionDiagnostics(framework, frameworkVersion, source, range);
  const found = await findFiles(root, patterns, ignore, framework);
  projectDiagnostics.push(...found.diagnostics);
  if (found.files.length === 0) {
    const list = patterns.map((pattern) => `"${pattern}"`).join(', ');
    projectDiagnostics.push(fileDiagnostic('no-files-matched', '.', `No test files match ${list} in the root.`));
  }

  const readerFor = moduleResolver(root);
  const results: FileRecords[] = [];
  const globalsFiles: { absolutePath: string; relativeFilePath: string }[] = [];
  for (const { absolutePath, relativeFilePath } of found.files) {
    let code: string;
    try {
      code = await readFile(absolutePath, 'utf8');
    } catch (error) {
      results.push({
        suites: [],
        tests: [],
        diagnostics: [
          fileDiagnostic('read-error', relativeFilePath, `The file could not be read: ${readFailure(error)}.`),
        ],
      });
      continue;
    }
    const result = scanFile(code, relativeFilePath, {
      framework,
      version: rules,
      comments,
      readModule: readerFor(absolutePath),
      root,
    });
    if (result.usesGlobals) globalsFiles.push({ absolutePath, relativeFilePath });
    results.push(result);
  }
  const enabled = globalsCheck(root);
  const globalsFile = globalsFiles.find((file) => !enabled(file.absolutePath))?.relativeFilePath;
  if (globalsFile !== undefined) {
    projectDiagnostics.push(
      fileDiagnostic(
        'globals-not-enabled',
        globalsFile,
        "The file uses Vitest's global test functions, but no Vitest or Vite config with globals: true and no tsconfig with vitest/globals was found.",
      ),
    );
  }
  return createInventory(framework, frameworkVersion, found.files.length, results, projectDiagnostics);
}
