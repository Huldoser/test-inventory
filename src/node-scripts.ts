import picomatch from 'picomatch';

/** Node.js options that take their value as the next argument, so it is not a file to test. */
const VALUE_OPTIONS = new Set([
  '--allow-fs-read',
  '--allow-fs-write',
  '--conditions',
  '-C',
  '--config-file',
  '--cpu-prof-dir',
  '--cpu-prof-name',
  '--diagnostic-dir',
  '--disable-warning',
  '--dns-result-order',
  '--env-file',
  '--env-file-if-exists',
  '--experimental-config-file',
  '--experimental-loader',
  '--heap-prof-dir',
  '--heap-prof-name',
  '--heapsnapshot-signal',
  '--icu-data-dir',
  '--import',
  '--input-type',
  '--loader',
  '--localstorage-file',
  '--max-http-header-size',
  '--openssl-config',
  '--redirect-warnings',
  '--report-dir',
  '--report-filename',
  '--require',
  '-r',
  '--secure-heap',
  '--secure-heap-min',
  '--test-concurrency',
  '--test-coverage-branches',
  '--test-coverage-exclude',
  '--test-coverage-functions',
  '--test-coverage-include',
  '--test-coverage-lines',
  '--test-global-setup',
  '--test-isolation',
  '--test-name-pattern',
  '--test-random-seed',
  '--test-reporter',
  '--test-reporter-destination',
  '--test-rerun-failures',
  '--test-shard',
  '--test-skip-pattern',
  '--test-timeout',
  '--title',
  '--unhandled-rejections',
  '--watch-kill-signal',
  '--watch-path',
]);

/**
 * The `node --test` commands of a package.json script, each as the files and globs it gives; empty for a command
 * that gives none. A command runs node:test when `--test` comes before any file, as `node build.js --test` passes it on
 * to the script.
 */
export function nodeTestCommands(script: string, setups = false): string[][] {
  const commands: string[][] = [];
  for (const words of commandsOf(script)) {
    const node = words.findIndex((word) => /(^|[/\\])node(\.exe)?$/.test(word));
    if (node === -1) continue;
    let runsTests = false;
    const files: string[] = [];
    const preload: string[] = [];
    for (let index = node + 1; index < words.length; index++) {
      const word = words[index];
      const [option] = word.split('=');
      const setup = ['--import', '--require', '-r', '--test-global-setup'].includes(option);
      if (word === '--test') runsTests = true;
      else if (setup && word.includes('=')) preload.push(word.slice(word.indexOf('=') + 1));
      else if (VALUE_OPTIONS.has(word)) {
        const value = words.at(index + 1);
        if (setup && value !== undefined) preload.push(value);
        index++;
      } else if (!word.startsWith('-')) {
        if (!runsTests) break;
        files.push(word);
      }
    }
    if (runsTests) commands.push(setups ? preload : files);
  }
  return commands;
}

/** The commands of a script, each as its words, without quotes. */
function commandsOf(script: string): string[][] {
  return script
    .split(/&&|\|\||[;|]/)
    .map((command) =>
      [...command.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map(
        (match) => (match[1] as string | undefined) ?? (match[2] as string | undefined) ?? match[3],
      ),
    );
}

/**
 * A package.json script and those it runs in turn, each once: through `npm run`, `npm test`, `pnpm`, `yarn`,
 * `bun run`, or `npm-run-all`, `run-s` and `run-p`, whose names may be globs where `*` stops at a `:`.
 */
export function scriptsRunBy(scripts: Record<string, unknown>, name: string): string[] {
  const names = Object.keys(scripts).filter((key) => typeof scripts[key] === 'string');
  const run: string[] = [];
  const visit = (current: string) => {
    if (run.includes(current) || !names.includes(current)) return;
    run.push(current);
    for (const words of commandsOf(scripts[current] as string)) {
      for (const called of calledScripts(words, names)) visit(called);
    }
  };
  visit(name);
  return run.map((key) => scripts[key] as string);
}

const NPM_RUN = new Set(['run', 'run-script', 'rum', 'urn']);
const NPM_TEST = new Set(['test', 't', 'tst']);

/** The scripts a command runs; a word that names no script, as `pnpm install`, runs none. */
function calledScripts(words: string[], names: string[]): string[] {
  // Variables set before the command, as in `TZ=UTC npm test` or `cross-env TZ=UTC npm test`, don't change it.
  let start = 0;
  while (start < words.length && (/^\w+=/.test(words[start]) || words[start] === 'cross-env')) start++;
  const [tool = '', ...rest] = words.slice(start);
  const end = rest.indexOf('--');
  const args = (end === -1 ? rest : rest.slice(0, end)).filter((word) => !word.startsWith('-'));
  const [first = '', second = ''] = args;
  if (['npm-run-all', 'run-s', 'run-p'].includes(tool)) {
    // As npm-run-all 4 and npm-run-all2 9 match names: `:` and `/` swapped, no `!` negation, no dot names for `*`.
    const swap = (text: string) => text.replaceAll(/[:/]/g, (char) => (char === ':' ? '/' : ':'));
    const matches = picomatch(args.map(swap), { nonegate: true });
    return names.filter((key) => matches(swap(key)));
  }
  if (tool === 'npm') return NPM_RUN.has(first) ? [second] : NPM_TEST.has(first) ? ['test'] : [];
  if (tool === 'bun') return first === 'run' ? [second] : [];
  if (tool === 'pnpm' || tool === 'yarn') return first === 'run' ? [second] : [first];
  return [];
}

/** The runners a script can start with a config of its own, which the scan then takes as one more that runs files. */
export type ScriptRunner = 'vitest' | 'jest' | 'playwright' | 'cypress' | 'webdriverio';

/** A command of a script that starts a test runner. */
export interface RunnerCommand {
  /** The config it names, as written; null when it names none. */
  config: string | null;
  /** The folder it takes as the project's root, as written: Vitest's `--root`, Cypress's `--project`; else null. */
  root: string | null;
  /** Whether it names its config or root in a way the scan can't read: a variable, or Jest's inline JSON. */
  unreadable: boolean;
}

/** Each runner's program, the subcommands that run tests, and the options that name its config and its root. */
const RUNNERS: Record<
  ScriptRunner,
  { program: string; subcommands: string[] | null; config: string[]; root: string[] }
> = {
  vitest: { program: 'vitest', subcommands: null, config: ['--config', '-c'], root: ['--root', '-r'] },
  jest: { program: 'jest', subcommands: null, config: ['--config', '-c'], root: [] },
  playwright: { program: 'playwright', subcommands: ['test'], config: ['--config', '-c'], root: [] },
  cypress: {
    program: 'cypress',
    subcommands: ['run', 'open'],
    config: ['--config-file', '-C'],
    root: ['--project', '-P'],
  },
  // `wdio run <config>` and `wdio <config>` take the config as the first argument.
  webdriverio: { program: 'wdio', subcommands: null, config: [], root: [] },
};

/** The program each package's files start when `node` runs them. */
const RUNNER_PACKAGES: Partial<Record<string, string>> = {
  vitest: 'vitest',
  jest: 'jest',
  'jest-cli': 'jest',
  '@playwright/test': 'playwright',
  playwright: 'playwright',
  cypress: 'cypress',
  '@wdio/cli': 'wdio',
};

/**
 * The commands of a package.json script that start a runner, with the config and root each names. Only a command whose
 * program is the runner counts, so `eslint --plugin jest -c .eslintrc.json` and `npm run jest` start none.
 */
export function runnerCommands(script: string, runner: ScriptRunner): RunnerCommand[] {
  const { program, subcommands, config, root } = RUNNERS[runner];
  const found: RunnerCommand[] = [];
  for (const words of commandsOf(script)) {
    const started = programOf(words);
    if (started?.program !== program) continue;
    let args = started.args;
    if (subcommands) {
      if (!subcommands.includes(args[0])) continue;
      args = args.slice(1);
    }
    const command: RunnerCommand = { config: null, root: null, unreadable: false };
    if (runner === 'webdriverio') {
      const first = args.at(0) === 'run' ? args.at(1) : args.at(0);
      if (first !== undefined && !first.startsWith('-')) command.config = first;
    }
    for (let index = 0; index < args.length; index++) {
      const parts = args[index].split(/=(.*)/s);
      const key = config.includes(parts[0]) ? 'config' : root.includes(parts[0]) ? 'root' : null;
      if (key === null) continue;
      const value = parts.at(1) ?? args.at(++index);
      if (value === undefined) command.unreadable = true;
      else command[key] = value;
    }
    // The shell expands a variable, and Jest reads a config that starts with `{` as the config itself.
    const values = [command.config, command.root].filter((value) => value !== null);
    if (values.some((value) => /[$%]/.test(value) || value.startsWith('{'))) command.unreadable = true;
    found.push(command);
  }
  return found;
}

/**
 * The program a command starts, with its arguments: past variables set before it, `cross-env`, `dotenv --`, and `npx`,
 * `bunx`, `pnpm exec`, `yarn exec`, `npm exec` or a package manager given a binary's name; for `node`, the runner whose
 * package holds the file it runs. Null when there is none.
 */
function programOf(words: string[]): { program: string; args: string[] } | null {
  let index = 0;
  const skip = (test: (word: string) => boolean) => {
    while (index < words.length && test(words[index])) index++;
  };
  const isAssignment = (word: string) => /^\w+=/.test(word);
  skip(isAssignment);
  for (;;) {
    const [word, next] = [words.at(index), words.at(index + 1)];
    if (word === 'cross-env' || word === 'env') {
      index++;
      skip(isAssignment);
    } else if (word === 'dotenv' || (word === 'npm' && next === 'exec')) {
      const end = words.indexOf('--', index);
      index = end === -1 ? index + 2 : end + 1;
    } else if (word === 'npx' || word === 'bunx') {
      index++;
      skip((item) => item.startsWith('-'));
    } else if (
      (word === 'pnpm' && (next === 'exec' || next === 'dlx')) ||
      (word === 'yarn' && next === 'exec') ||
      (word === 'bun' && next === 'x')
    ) {
      index += 2;
    } else if ((word === 'pnpm' || word === 'yarn') && next !== 'run') {
      // `pnpm vitest` starts the binary when no script has its name, which the scan takes to be so.
      index++;
    } else break;
  }
  const word = words.at(index);
  if (word === undefined) return null;
  if (/(^|[/\\])node(\.exe)?$/.test(word)) {
    index++;
    while (index < words.length && words[index].startsWith('-')) index += VALUE_OPTIONS.has(words[index]) ? 2 : 1;
    const file = /node_modules[/\\](?:\.bin[/\\]([^/\\]+)|(@[^/\\]+[/\\][^/\\]+|[^/\\]+)[/\\])/.exec(
      words.at(index) ?? '',
    );
    const program = file?.at(1) ?? RUNNER_PACKAGES[file?.at(2)?.replace('\\', '/') ?? ''];
    return program ? { program, args: words.slice(index + 1) } : null;
  }
  const name = word.split(/[/\\]/).at(-1) as string;
  return { program: name.replace(/\.(cmd|exe|[cm]?js)$/, ''), args: words.slice(index + 1) };
}
