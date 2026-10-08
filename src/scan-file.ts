import { fileDiagnostic, toDiagnostic } from './diagnostics.ts';
import { extract } from './extract.ts';
import { problem, type FileContext } from './frameworks/common.ts';
import { PlaywrightAdapter } from './frameworks/playwright.ts';
import { VitestAdapter } from './frameworks/vitest.ts';
import type { ModuleReader } from './model.ts';
import { parseFile } from './parse.ts';
import { buildRecords, type CommentsMode, type FileRecords } from './records.ts';
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
}

export interface FileResult extends FileRecords {
  usesGlobals: boolean;
}

const TYPE_TEST = /\.(test|spec)-d\.[cm]?[jt]sx?$/;

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
      if (parsed.program.body.length === 0) return { suites: [], tests: [], diagnostics, usesGlobals: false };
    }
    const file: FileContext = { source: parsed.source, values: new Values(), version: settings.version };
    const adapter =
      settings.framework === 'playwright'
        ? new PlaywrightAdapter(parsed.program, file, settings.readModule)
        : new VitestAdapter(parsed, file, settings.readModule);
    const extraction = extract(parsed, adapter, file.values);
    const records = buildRecords(extraction, parsed, {
      relativeFilePath,
      framework: settings.framework,
      comments: settings.comments,
      isTypeTest: settings.framework === 'vitest' && TYPE_TEST.test(relativeFilePath),
    });
    return {
      ...records,
      diagnostics: [...diagnostics, ...records.diagnostics],
      usesGlobals: extraction.usesGlobals,
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = settings.root === null ? raw : raw.replaceAll(settings.root, '.');
    return {
      suites: [],
      tests: [],
      diagnostics: [
        fileDiagnostic('internal-error', relativeFilePath, `Reading the file failed unexpectedly: ${message}`),
      ],
      usesGlobals: false,
    };
  }
}
