import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Node } from 'oxc-parser';
import { childNodes } from './ast.ts';
import { parseFile } from './parse.ts';

const CONFIG_FILES = ['vitest.config', 'vite.config'].flatMap((name) =>
  ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'].map((extension) => name + extension),
);

function setsGlobals(node: Node): boolean {
  if (
    node.type === 'Property' &&
    !node.computed &&
    ((node.key.type === 'Identifier' && node.key.name === 'globals') ||
      (node.key.type === 'Literal' && node.key.value === 'globals')) &&
    node.value.type === 'Literal' &&
    node.value.value === true
  ) {
    return true;
  }
  return childNodes(node).some(setsGlobals);
}

/** A file's text, or null when it is missing or can't be read. */
function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Whether a folder has a Vitest or Vite config with `globals: true`, or a tsconfig with `vitest/globals`. */
function enablesGlobals(directory: string): boolean {
  for (const name of CONFIG_FILES) {
    const code = readText(path.join(directory, name));
    if (code !== null && setsGlobals(parseFile(name, code).program)) return true;
  }
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

/**
 * Returns a check of whether Vitest's globals are turned on for a file, by a config in its folder or any folder
 * above it up to the root, as in a monorepo where each package has its own config. Config files are read as code and
 * never run.
 */
export function globalsCheck(root: string): (file: string) => boolean {
  const known = new Map<string, boolean>();
  const enabled = (directory: string): boolean => {
    let result = known.get(directory);
    if (result === undefined) {
      const parent = path.dirname(directory);
      result = enablesGlobals(directory) || (directory !== root && parent !== directory && enabled(parent));
      known.set(directory, result);
    }
    return result;
  };
  return (file) => enabled(path.dirname(file));
}
