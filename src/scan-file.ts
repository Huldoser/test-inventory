import type { RunsWith } from './config-dependencies.ts';
import { DependencyGraph, fileDependencies, type Place, type SnapshotFiles } from './dependency-hash.ts';
import { fileDiagnostic, toDiagnostic } from './diagnostics.ts';
import { extract, noHooks, type Frame } from './extract.ts';
import { parseModule } from './frameworks/bindings.ts';
import { atLeast, problem, type FileContext } from './frameworks/common.ts';
import { PlaywrightAdapter } from './frameworks/playwright.ts';
import { VitestAdapter } from './frameworks/vitest.ts';
import type { Adapter, ModuleReader, ModuleSource } from './model.ts';
import { parseFile, type ParsedFile } from './parse.ts';
import { buildRecords, fileRecord, type CommentsMode, type FileConfig, type FileRecords } from './records.ts';
import { snippet } from './source.ts';
import type { Framework } from './types.ts';
import { Values } from './values.ts';

export interface FileSettings {
  framework: Framework;
  /** `[major, minor]` of the framework version; null applies the newest rules. */
  version: [number, number] | null;
  comments: CommentsMode;
  readModule: ModuleReader | null;
  /** The project root, left out of error messages so that the output has no absolute paths. */
  root: string | null;
  /** Whether the config runs the file as a benchmark; null takes it from the file's name, as Vitest 5's default does. */
  isBenchmarkFile?: boolean | null;
  /** What the config the file uses sets for its tests; null without a config. */
  config?: FileConfig | null;
  /** Shared by the files of one scan, so that code many tests reach is read once. */
  graph?: DependencyGraph;
  /** What the file's config runs with each of its tests: the config, setup files and setup projects. */
  runsWith?: RunsWith;
  /** Reads the snapshot files tests compare against; none when one file's code is scanned. */
  snapshotFiles?: SnapshotFiles;
}

export interface FileResult extends FileRecords {
  usesGlobals: boolean;
}

const TYPE_TEST = /\.(test|spec)-d\.[cm]?[jt]sx?$/;
const BENCHMARK = /\.(bench|benchmark)\.[cm]?[jt]sx?$/;

/** A file read for the scan: the scanned file, or a module a helper function is imported from. */
function frame(
  parsed: ParsedFile,
  relativeFilePath: string,
  settings: FileSettings,
  readModule: ModuleReader | null,
): Frame {
  const file: FileContext = { source: parsed.source, values: new Values(), version: settings.version };
  const adapter: Adapter =
    settings.framework === 'playwright'
      ? new PlaywrightAdapter(parsed.program, file, readModule)
      : new VitestAdapter(parsed, file, readModule);
  return { parsed, adapter, values: file.values, readModule, relativeFilePath };
}

/** The records of a file the scan read no tests from. */
export function noRecords(relativeFilePath: string): Omit<FileRecords, 'diagnostics'> {
  return { file: fileRecord(relativeFilePath, noHooks(), { suites: [], tests: [] }), suites: [], tests: [] };
}

/** Reads one file: parse, extract, build records, and drop the AST. Never throws. */
export function scanFile(code: string, relativeFilePath: string, settings: FileSettings): FileResult {
  try {
    const parsed = parseFile(relativeFilePath, code);
    const diagnostics = [];
    if (parsed.error) {
      const { message, start, end } = parsed.error;
      diagnostics.push(
        toDiagnostic(
          problem(
            'parse-error',
            { start, end },
            `The file could not be parsed: ${message}`,
            snippet(parsed.source.slice(start, end)) || null,
          ),
          relativeFilePath,
          parsed.source,
        ),
      );
      // The parser keeps what it could read after some errors; after others it returns nothing.
      if (parsed.program.body.length === 0) return { ...noRecords(relativeFilePath), diagnostics, usesGlobals: false };
    }
    const main = frame(parsed, relativeFilePath, settings, settings.readModule);
    const extraction = extract(main, (module: ModuleSource) => {
      const helper = parseModule(module);
      return helper.error ? null : frame(helper, module.relativeFilePath, settings, module.readModule);
    });
    const isTypeTest = settings.framework === 'vitest' && TYPE_TEST.test(relativeFilePath);
    const unfollowed: Place[] = [];
    const dependencies = fileDependencies(
      settings.graph ?? new DependencyGraph(),
      main,
      extraction,
      isTypeTest,
      (place) => unfollowed.push(place),
      settings.runsWith,
      settings.snapshotFiles,
    );
    const records = buildRecords(extraction, parsed, {
      relativeFilePath,
      framework: settings.framework,
      comments: settings.comments,
      isTypeTest,
      // Vitest 5's default `benchmark.include`, when no config says.
      isBenchmarkFile:
        settings.framework === 'vitest' &&
        atLeast(settings.version, 5, 0) &&
        (settings.isBenchmarkFile ?? BENCHMARK.test(relativeFilePath)),
      config: settings.config ?? null,
      dependencies,
    });
    return {
      ...records,
      diagnostics: [
        ...diagnostics,
        ...records.diagnostics,
        ...unfollowed.map((place) => toDiagnostic(place.problem, place.relativeFilePath, place.source)),
      ],
      usesGlobals: extraction.usesGlobals,
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = settings.root === null ? raw : raw.replaceAll(settings.root, '.');
    return {
      ...noRecords(relativeFilePath),
      diagnostics: [
        fileDiagnostic('internal-error', relativeFilePath, `Reading the file failed unexpectedly: ${message}`),
      ],
      usesGlobals: false,
    };
  }
}
