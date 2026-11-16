import type { Framework, Inventory } from './types.ts';

/** A command line that runs some test files of an inventory with their runner, config and projects. */
export interface RunCommand {
  /** The config the files run with, from the project root; null when the scan found none. */
  config: string | null;
  /** The projects of the config that run the files, as the command selects them; `[]` to run every project. */
  projects: string[];
  /** The test files, sorted. */
  files: string[];
  /** The command line, to run from the project root in a POSIX shell. */
  command: string;
  /** What the command runs beyond `files` or why it can't run them as it is; null otherwise. */
  caveat: string | null;
}

/** An argument as a POSIX shell reads it back: quoted when it holds anything but plain path characters. */
function quote(argument: string): string {
  return /^[\w./@:+=,-]+$/.test(argument) ? argument : `'${argument.replaceAll("'", "'\\''")}'`;
}

/** The arguments of the command for one runner, and its caveat. */
function commandFor(
  framework: Framework,
  config: string | null,
  projects: string[],
  files: string[],
): { args: string[]; caveat: string | null } {
  const withConfig = (flag: string) => (config === null ? [] : [flag, config]);
  switch (framework) {
    case 'vitest':
      return {
        args: [
          'npx',
          'vitest',
          'run',
          ...files,
          ...withConfig('--config'),
          ...projects.flatMap((p) => ['--project', p]),
        ],
        caveat: null,
      };
    case 'jest': {
      const selected = projects.length > 0 ? ['--selectProjects', ...projects] : [];
      return {
        args: ['npx', 'jest', ...withConfig('--config'), ...selected, '--runTestsByPath', ...files],
        caveat: null,
      };
    }
    case 'playwright': {
      // `--project` takes every name after it, so the files come first.
      const selected = projects.length > 0 ? ['--project', ...projects] : [];
      return { args: ['npx', 'playwright', 'test', ...files, ...withConfig('--config'), ...selected], caveat: null };
    }
    case 'mocha':
      return {
        args: ['npx', 'mocha', ...withConfig(config?.endsWith('package.json') ? '--package' : '--config'), ...files],
        caveat:
          config === null
            ? null
            : 'Mocha adds the files to the spec of the config, so every spec the config lists runs too.',
      };
    case 'jasmine':
      return { args: ['npx', 'jasmine', ...(config === null ? [] : [`--config=${config}`]), ...files], caveat: null };
    case 'cypress':
      return {
        args: [
          'npx',
          'cypress',
          'run',
          ...withConfig('--config-file'),
          ...(projects.includes('component') ? ['--component'] : []),
          '--spec',
          files.join(','),
        ],
        caveat: null,
      };
    case 'webdriverio':
      return {
        args: [
          'npx',
          'wdio',
          'run',
          ...(config === null ? [] : [config]),
          ...files.flatMap((file) => ['--spec', file]),
        ],
        caveat:
          config === null
            ? "No WebdriverIO config was found, and 'wdio run' needs one, as in 'npx wdio run wdio.conf.ts'."
            : null,
      };
    case 'node':
      return { args: ['node', '--test', ...files], caveat: null };
    case 'bun':
      // Without `./`, Bun takes an argument as part of a name to look for.
      return { args: ['bun', 'test', ...files.map((file) => `./${file}`)], caveat: null };
  }
}

/**
 * The commands that run the tests an inventory keeps, as after `filterInventory()` with `related`: one for each config,
 * and for Cypress one for each testing type, with the projects that run the tests, sorted by config. A test whose
 * projects are unknown runs in every project of its config.
 */
export function runCommands(inventory: Inventory): RunCommand[] {
  const configs = new Map(inventory.files.map((file) => [file.relativeFilePath, file.config]));
  const groups = new Map<string, { config: string | null; files: Set<string>; projects: Set<string>; all: boolean }>();
  for (const test of inventory.tests) {
    const config = configs.get(test.relativeFilePath) ?? null;
    // Cypress runs one testing type at a time.
    const type = inventory.framework === 'cypress' ? (test.projects?.join(',') ?? '') : '';
    const key = `${config ?? ''}\0${type}`;
    const group = groups.get(key) ?? { config, files: new Set(), projects: new Set(), all: false };
    groups.set(key, group);
    group.files.add(test.relativeFilePath);
    if (test.projects === null) group.all = true;
    // A config without projects has one with an empty name, which no flag selects.
    for (const name of test.projects ?? []) if (name !== '') group.projects.add(name);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, group]) => {
      const projects = group.all ? [] : [...group.projects].sort();
      const files = [...group.files].sort();
      const { args, caveat } = commandFor(inventory.framework, group.config, projects, files);
      return { config: group.config, projects, files, command: args.map(quote).join(' '), caveat };
    });
}
