import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { settingAt, type ConfigFile, type Configs, type Setting } from './config.ts';

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

/** Whether a config turns Vitest's globals on, for all its tests or in a project written in it; null when unknown. */
function configGlobals(config: ConfigFile, configs: Configs): boolean | null {
  const read = (setting: Setting, key: string): boolean | null => {
    const globals = settingAt(setting, ['test', 'globals']);
    if (globals?.kind !== 'unknown') return globals?.kind === 'value' && globals.value === true;
    configs.reportUnknown(globals, key, ASSUMED);
    return null;
  };
  const own = read(config.settings, 'test.globals');
  if (own !== false) return own;
  const projects = settingAt(config.settings, ['test', 'projects']);
  if (projects?.kind === 'unknown') {
    configs.reportUnknown(projects, 'test.projects', ASSUMED);
    return null;
  }
  const inProjects = projects?.kind === 'list' ? projects.items.map((project) => read(project, 'test.projects')) : [];
  return inProjects.includes(true) ? true : inProjects.includes(null) ? null : false;
}

/**
 * Returns a check of whether Vitest's globals are turned on for a file: by the config it uses, or by a tsconfig in its
 * folder or any folder above it up to the root, as in a monorepo where each package has its own. The check gives the
 * message to report when they are not, and null when they are or may be. Config files are read as code, never run.
 */
export function globalsCheck(root: string, configs: Configs): (file: string) => string | null {
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
    const config = configs.configFor(file);
    if (config && configGlobals(config, configs) !== false) return null;
    const why = config
      ? `${config.record.relativeFilePath} doesn't set test.globals to true`
      : 'no Vitest or Vite config was found';
    return `The file uses Vitest's global test functions, but ${why} and no tsconfig has vitest/globals in its types.`;
  };
}
