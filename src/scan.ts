import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ConfigRuns, fileConfig, type Placement } from './config-runs.ts';
import { Configs } from './config.ts';
import { fileDiagnostic } from './diagnostics.ts';
import { findFiles, normalizePattern, readFailure } from './files.ts';
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
import { noRecords, scanFile } from './scan-file.ts';
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
  const name = framework === 'playwright' ? 'Playwright' : 'Vitest';
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
  // Without patterns, the configs choose among all JavaScript and TypeScript files.
  const found = await findFiles(root, patterns ?? [SCRIPT_FILES], ignore, framework);
  projectDiagnostics.push(...found.diagnostics);

  const readerFor = moduleResolver(root);
  const configs = new Configs(root, framework, readerFor, rules);
  const runs = new ConfigRuns(configs, framework, rules, patterns === null);
  const placements = new Map(found.files.map((file) => [file.absolutePath, runs.placementOf(file.absolutePath)]));
  const files = patterns ? found.files : found.files.filter((file) => placements.get(file.absolutePath)?.runs);
  const notRun: Diagnostic[] = [];
  const results: FileRecords[] = [];
  const globalsFiles: { absolutePath: string; relativeFilePath: string }[] = [];
  for (const { absolutePath, relativeFilePath } of files) {
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
    const result = scanFile(code, relativeFilePath, {
      framework,
      version: rules,
      comments,
      readModule: readerFor(absolutePath),
      root,
      isBenchmarkFile: placement.runs === null ? null : placement.runs === 'benchmark',
      config: fileConfig(placement, framework, absolutePath),
    });
    if (result.usesGlobals) globalsFiles.push({ absolutePath, relativeFilePath });
    // A file without tests that no config runs, such as a source file a broad pattern matches, misses nothing.
    if (placement.runs === false && result.tests.length > 0) {
      const message = `The file has tests, but no config in its folder or above runs it, so the runner doesn't collect them; the nearest config is ${config}.`;
      notRun.push(fileDiagnostic('file-not-run', relativeFilePath, message));
    }
    results.push({ ...result, file: { ...result.file, config } });
  }
  const missingGlobals = globalsCheck(root, configs, (file) => placements.get(file) as Placement);
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
