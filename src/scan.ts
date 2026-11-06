import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { ConfigDependencies } from './config-dependencies.ts';
import { ConfigRuns, fileConfig, mochaInterface, type Placement } from './config-runs.ts';
import { Configs, settingAt } from './config.ts';
import { atLeast } from './frameworks/common.ts';
import { DependencyGraph } from './dependency-hash.ts';
import { ExportedValues } from './imported-values.ts';
import { fileDiagnostic } from './diagnostics.ts';
import { findFiles, normalizePattern, readFailure } from './files.ts';
import { detectFramework, detectFrameworkVersion, FRAMEWORK_NAMES, OLDEST } from './framework-version.ts';
import { createInventory } from './inventory.ts';
import {
  checkComments,
  checkFlag,
  checkFramework,
  checkObject,
  checkSignal,
  checkStrings,
  checkVersion,
  invalid,
  majorMinor,
  type ScanOptions,
  toPosixPath,
} from './options.ts';
import type { FileRecords } from './records.ts';
import { moduleResolver } from './resolve.ts';
import { noRecords, scanFile } from './scan-file.ts';
import type { Diagnostic, Framework, Inventory } from './types.ts';
import { globalsCheck } from './vitest-config.ts';

function versionDiagnostics(
  framework: Framework,
  version: string | null,
  source: string,
  range: string | null,
): Diagnostic[] {
  const name = FRAMEWORK_NAMES[framework];
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
  // A range gets the newest rules of its major, so only its major has to be supported.
  const tooOld = major < oldestMajor || (major === oldestMajor && minor < oldestMinor && range === null);
  if (tooOld) {
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
 * The length Vitest shortens a value in a case title to: `test.taskTitleValueFormatTruncate` from Vitest 5,
 * `test.chaiConfig.truncateThreshold` before, from the project that runs the file; 40, Vitest's default, when it sets
 * none or the scan can't read it.
 */
function titleTruncate(placement: Placement, version: [number, number] | null): number {
  const key = atLeast(version, 5, 0)
    ? ['test', 'taskTitleValueFormatTruncate']
    : ['test', 'chaiConfig', 'truncateThreshold'];
  const setting = placement.settings && settingAt(placement.settings, key);
  return setting?.kind === 'value' && typeof setting.value === 'number' ? setting.value : 40;
}

/** Why Jest gives a file that uses its globals none: a project that runs it sets `injectGlobals` to false. */
function jestGlobals(placement: Placement): string | null {
  const off = placement.projects?.find(({ settings }) => {
    const setting = settingAt(settings, ['injectGlobals']);
    return setting?.kind === 'value' && setting.value === false;
  });
  if (!off) return null;
  const config = off.config.record.relativeFilePath;
  return `The file uses describe, it or test without importing them, but ${config} sets injectGlobals to false, so Jest doesn't define them; import them from '@jest/globals'.`;
}

/** For a pattern that names a folder, which matches no file, a pattern that matches the test files in it. */
function folderHint(root: string, patterns: string[], framework: Framework): string {
  const folder = patterns.find((pattern) => {
    const target = path.resolve(root, normalizePattern(pattern));
    return existsSync(target) && statSync(target).isDirectory();
  });
  if (folder === undefined) return '';
  // A loop, as a regular expression for trailing slashes takes quadratic time on a long run of slashes.
  let end = folder.length;
  while (end > 0 && '/\\'.includes(folder[end - 1])) end -= 1;
  const example = `${folder.slice(0, end)}/**/*.${framework === 'playwright' ? 'spec' : 'test'}.ts`;
  return ` "${folder}" is a folder; to scan the test files in it, use a pattern such as "${example}".`;
}

/** The JavaScript and TypeScript files the runners read, which the configs choose the test files from. */
const SCRIPT_FILES = '**/*.{js,jsx,ts,tsx,mjs,mjsx,mts,mtsx,cjs,cjsx,cts,ctsx}';

/** Whether an error says a file or folder isn't there, as a snapshot isn't before a test first writes it. */
function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * The files in a folder of the project and the folders in it, linked files too, as paths in the folder with `/`;
 * none for no folder.
 */
function filesIn(root: string, folder: string): string[] | 'unreadable' {
  const base = path.join(root, folder);
  try {
    return readdirSync(base, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() || (entry.isSymbolicLink() && isFile(path.join(entry.parentPath, entry.name))))
      .map((entry) => toPosixPath(path.relative(base, path.join(entry.parentPath, entry.name))))
      .sort();
  } catch (error) {
    return isMissing(error) ? [] : 'unreadable';
  }
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** A file's bytes, from the project root; null when there is none. */
function bytesOf(root: string, file: string): Uint8Array | null | 'unreadable' {
  try {
    return readFileSync(path.join(root, file));
  } catch (error) {
    return isMissing(error) ? null : 'unreadable';
  }
}

/** Why a scan found no test files: what the patterns matched, or whether there is a config to find them from. */
function noFiles(
  root: string,
  patterns: string[] | null,
  framework: Framework,
  placements: Map<string, Placement>,
): string {
  if (patterns) {
    const list = patterns.map((pattern) => `"${pattern}"`).join(', ');
    return `No test files match ${list} in the root.${folderHint(root, patterns, framework)}`;
  }
  if ([...placements.values()].some((placement) => placement.config)) {
    return 'No test files were found from the configs in the root.';
  }
  const name = FRAMEWORK_NAMES[framework];
  return `No patterns were given, and no ${name} config is in the root or a folder below it, so there are no test files to find.`;
}

/**
 * Scans the test files that match `patterns` under `root`, or without patterns those the configs run, one file at a
 * time.
 *
 * Throws a `TypeError` for invalid options. Problems with files and code are reported as diagnostics.
 */
export async function scan(options: ScanOptions): Promise<Inventory> {
  const checked = checkObject(options, 'options');
  const patterns = checked.patterns === undefined ? null : checkStrings(checked.patterns, 'options.patterns', true);
  const ignore = checkStrings(checked.ignore, 'options.ignore', false);
  const comments = checkComments(checked.comments, 'options.comments');
  const expandCases = checkFlag(checked.expandCases, 'options.expandCases');
  const override = checkVersion(checked.frameworkVersion, 'options.frameworkVersion');
  const signal = checkSignal(checked.signal, 'options.signal');
  signal?.throwIfAborted();
  if (checked.root !== undefined && (typeof checked.root !== 'string' || checked.root === '')) {
    throw invalid('options.root', 'a non-empty string');
  }
  const root = path.resolve(checked.root ?? process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory())
    throw invalid('options.root', `a directory, and ${root} is not one`);
  const framework =
    checked.framework === undefined
      ? detectFramework(root, ignore)
      : checkFramework(checked.framework, 'options.framework');

  // Without patterns, the configs choose among all JavaScript and TypeScript files.
  const found = await findFiles(root, patterns ?? [SCRIPT_FILES], ignore, framework);
  signal?.throwIfAborted();
  const scanned = found.files.map((file) => file.relativeFilePath);
  const detected = override === null ? detectFrameworkVersion(root, framework, scanned) : null;
  const frameworkVersion = override ?? detected?.version ?? null;
  const range = detected?.range ?? null;
  // With only a range, the newest rules of its major apply, as the newest release in it is the likeliest installed.
  const rules = range
    ? ([(majorMinor(frameworkVersion) as [number, number])[0], Number.MAX_SAFE_INTEGER] as [number, number])
    : majorMinor(frameworkVersion);
  const source = override === null ? (detected?.source ?? 'package.json') : '.';
  const projectDiagnostics = versionDiagnostics(framework, frameworkVersion, source, range);
  projectDiagnostics.push(...found.diagnostics);

  const readerFor = moduleResolver(root);
  const graph = new DependencyGraph();
  const exports = new ExportedValues();
  const configs = new Configs(root, framework, readerFor, rules);
  const runs = new ConfigRuns(configs, framework, rules, patterns === null);
  const placements = new Map(found.files.map((file) => [file.absolutePath, runs.placementOf(file.absolutePath)]));
  const files = patterns ? found.files : found.files.filter((file) => placements.get(file.absolutePath)?.runs);
  // A setup project's files may be outside the patterns, or ignored for the scan, so they are looked for in its testDir.
  const setupDirs = new Set<string>();
  for (const { config, projects } of placements.values()) {
    const seen = new Set<string>();
    const names = (projects ?? []).flatMap((project) => project.dependencies);
    for (let name = names.pop(); config && name !== undefined; name = names.pop()) {
      const project = seen.has(name) ? null : runs.projectNamed(config, name);
      seen.add(name);
      if (!project) continue;
      setupDirs.add(project.about.testDir);
      names.push(...project.about.dependencies);
    }
  }
  // Searched from the folder itself, as a folder named like `(auth)` would be read as a glob in a pattern.
  const setupFiles = await Promise.all(
    [...setupDirs].map((folder) => glob(SCRIPT_FILES, { cwd: folder, absolute: true, ignore: ['**/node_modules/**'] })),
  );
  const candidates = setupFiles.flat().map((file) => path.resolve(file));
  const configDependencies = new ConfigDependencies(framework, runs, readerFor, candidates);
  // Many tests of a file compare against one folder, so each is listed once.
  const listed = new Map<string, string[] | 'unreadable'>();
  const list = (folder: string) => {
    if (!listed.has(folder)) listed.set(folder, filesIn(root, folder));
    return listed.get(folder) as string[] | 'unreadable';
  };
  const snapshotFiles = { framework, list, read: (file: string) => bytesOf(root, file) };
  const notRun: Diagnostic[] = [];
  const results: FileRecords[] = [];
  const globalsFiles: { absolutePath: string; relativeFilePath: string }[] = [];
  for (const { absolutePath, relativeFilePath } of files) {
    signal?.throwIfAborted();
    const placement = placements.get(absolutePath) as Placement;
    if (placement.config) configs.use(placement.config);
    const config = placement.config?.record.relativeFilePath ?? null;
    let code: string;
    try {
      code = await readFile(absolutePath, 'utf8');
    } catch (error) {
      const records = noRecords(relativeFilePath);
      results.push({
        ...records,
        file: { ...records.file, config },
        diagnostics: [
          fileDiagnostic('read-error', relativeFilePath, `The file could not be read: ${readFailure(error)}.`),
        ],
      });
      continue;
    }
    const runsWith = configDependencies.of(placement);
    const result = scanFile(code, relativeFilePath, {
      framework,
      version: rules,
      comments,
      expandCases,
      readModule: readerFor(absolutePath),
      root,
      isBenchmarkFile: placement.runs === null ? null : placement.runs === 'benchmark',
      config: fileConfig(placement, framework, rules, absolutePath),
      mochaInterface: framework === 'mocha' ? mochaInterface(placement, configs) : undefined,
      titleTruncate: framework === 'vitest' ? titleTruncate(placement, rules) : undefined,
      graph,
      exports,
      runsWith,
      snapshotFiles: { ...snapshotFiles, moved: runsWith.moved },
    });
    if (result.usesGlobals) globalsFiles.push({ absolutePath, relativeFilePath });
    // A file without tests that no config runs, such as a source file a broad pattern matches, misses nothing.
    if (placement.runs === false && result.tests.length > 0) {
      const message = `The file has tests, but no config in its folder or above runs it, so the runner doesn't collect them; the nearest config is ${config}.`;
      notRun.push(fileDiagnostic('file-not-run', relativeFilePath, message));
    }
    results.push({ ...result, file: { ...result.file, config } });
  }
  // Mocha, Jasmine and Cypress always set their globals, and Playwright has none.
  const missingGlobals =
    framework === 'jest'
      ? (file: string) => jestGlobals(placements.get(file) as Placement)
      : framework === 'mocha' || framework === 'jasmine' || framework === 'cypress'
        ? () => null
        : globalsCheck(root, configs, (file) => placements.get(file) as Placement);
  let globals: Diagnostic | null = null;
  for (const { absolutePath, relativeFilePath } of globalsFiles) {
    const message = missingGlobals(absolutePath);
    if (message === null) continue;
    globals = fileDiagnostic('globals-not-enabled', relativeFilePath, message);
    break;
  }
  projectDiagnostics.push(...configs.diagnostics, ...notRun, ...(globals ? [globals] : []));
  // After the config warnings, which may say why no file was found.
  if (files.length === 0) {
    projectDiagnostics.push(fileDiagnostic('no-files-matched', '.', noFiles(root, patterns, framework, placements)));
  }
  const fileCount = files.length;
  const records = configs.records((config) => runs.projectsIn(config));
  return createInventory(framework, frameworkVersion, fileCount, results, projectDiagnostics, records);
}
