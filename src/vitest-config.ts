import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Placement } from './config-runs.ts';
import { settingAt, type Configs, type Setting } from './config.ts';

/** A file's text, or null when it is missing or can't be read. */
function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Whether a folder has a tsconfig with `vitest/globals` in its types. */
function typesGlobals(directory: string): boolean {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return false;
  }
  return names.some(
    (name) =>
      /^tsconfig.*\.json$/.test(name) && (readText(path.join(directory, name)) ?? '').includes('"vitest/globals"'),
  );
}

const ASSUMED = "files that use Vitest's global test functions are taken to have them";

/** Whether a project's settings turn Vitest's globals on; null when the scan can't tell. */
function turnsOnGlobals(settings: Setting, configs: Configs): boolean | null {
  // A project the scan can't work out was reported where its files were asked for.
  if (settings.kind === 'unknown') return null;
  const globals = settingAt(settings, ['test', 'globals']);
  if (globals?.kind !== 'unknown') return globals?.kind === 'value' && globals.value === true;
  configs.reportUnknown(globals, 'test.globals', ASSUMED);
  return null;
}

/**
 * Returns a check of whether Vitest's globals are turned on for a file: by the project of the config it uses, or by a
 * tsconfig in its folder or any folder above it up to the root. The check gives the message to report when they are
 * not, and null when they are or may be. Config files are read as code, never run.
 */
export function globalsCheck(
  root: string,
  configs: Configs,
  placementOf: (file: string) => Placement,
): (file: string) => string | null {
  const known = new Map<string, boolean>();
  const typed = (directory: string): boolean => {
    let result = known.get(directory);
    if (result === undefined) {
      const parent = path.dirname(directory);
      result = typesGlobals(directory) || (directory !== root && parent !== directory && typed(parent));
      known.set(directory, result);
    }
    return result;
  };
  return (file) => {
    if (typed(path.dirname(file))) return null;
    const { config, settings } = placementOf(file);
    if (config && settings && turnsOnGlobals(settings, configs) !== false) return null;
    const why = config
      ? `${config.record.relativeFilePath} doesn't set test.globals to true for it`
      : 'no Vitest or Vite config was found';
    return `The file uses Vitest's global test functions, but ${why} and no tsconfig has vitest/globals in its types.`;
  };
}
