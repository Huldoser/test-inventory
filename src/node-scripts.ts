import path from 'node:path';
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
  for (const { words } of commandsOf(script)) {
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
function commandsOf(script: string): { words: string[]; next: string }[] {
  // A word is quoted in whole or in part, as `--server-args="-screen 0 1280x1024x24"`, and the shell drops the quotes.
  const commands = [];
  let words: string[] = [];
  for (const [word, separator] of script.matchAll(/(&&|\|\||[;|])|(?:[^\s'"&;|]+|'[^']*'|"[^"]*"|&(?!&))+/g)) {
    if (separator) {
      commands.push({ words, next: separator });
      words = [];
    } else words.push(word.replaceAll(/'([^']*)'|"([^"]*)"/g, '$1$2'));
  }
  return [...commands, { words, next: '' }];
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
    for (const { words } of commandsOf(scripts[current] as string)) {
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
export type ScriptRunner = 'vitest' | 'jest' | 'playwright' | 'cypress' | 'webdriverio' | 'mocha';

/** A command of a script that starts a test runner. */
export interface RunnerCommand {
  cwd?: string;
  /** The config it names, as written; null when it names none. */
  config: string | null;
  /** The folder it takes as the project's root, as written: Vitest's `--root`, Cypress's `--project`; else null. */
  root: string | null;
  /** Whether it names its config or root in a way the scan can't read: a variable, or Jest's inline JSON. */
  unreadable: boolean;
  /** A plain playwright test command collects its default files even without a config. */
  playwrightDefaults?: true;
  /** Static positional file filters, when every selection argument is readable. */
  filters?: string[];
  /** For Mocha, which takes its files and settings from them, the words after the program. */
  args?: string[];
}

/**
 * Each runner's programs, with the subcommands that run tests (null for none), and the options that name its config and
 * its root. Currents' `pwc` and `pwc-p` start Playwright with the options they are given, and its `cypress-cloud` runs
 * Cypress with Cypress's own options.
 */
const RUNNERS: Record<ScriptRunner, { programs: Record<string, string[] | null>; config: string[]; root: string[] }> = {
  vitest: { programs: { vitest: null }, config: ['--config', '-c'], root: ['--root', '-r'] },
  jest: { programs: { jest: null }, config: ['--config', '-c'], root: [] },
  playwright: { programs: { playwright: ['test'], pwc: null, 'pwc-p': null }, config: ['--config', '-c'], root: [] },
  cypress: {
    programs: { cypress: ['run', 'open'], 'cypress-cloud': null },
    config: ['--config-file', '-C'],
    root: ['--project', '-P'],
  },
  // `wdio run <config>` and `wdio <config>` take the config as the first argument.
  webdriverio: { programs: { wdio: null }, config: [], root: [] },
  mocha: { programs: { mocha: null, _mocha: null, 'ts-mocha': null }, config: ['--config'], root: [] },
};

/** The programs a coverage tool starts the command after it with: the runners', and those that start one in turn. */
const STARTERS = new Set([
  ...Object.values(RUNNERS).flatMap((runner) => Object.keys(runner.programs)),
  'node',
  'npx',
  'pnpm',
  'yarn',
  'bunx',
]);

/** The options of `xvfb-run` written with their value as the next word. */
const XVFB_VALUE_OPTIONS = new Set([
  '-n',
  '-s',
  '-e',
  '-f',
  '-p',
  '-w',
  '--server-num',
  '--server-args',
  '--error-file',
  '--auth-file',
  '--xauth-protocol',
  '--wait',
]);

/** The program each package's files start when `node` runs them. */
const RUNNER_PACKAGES: Partial<Record<string, string>> = {
  vitest: 'vitest',
  jest: 'jest',
  'jest-cli': 'jest',
  '@playwright/test': 'playwright',
  playwright: 'playwright',
  cypress: 'cypress',
  '@wdio/cli': 'wdio',
  mocha: 'mocha',
};

/** Only narrow discovery when every remaining argument has an unambiguous role. */
function fileFilters(program: string, args: string[]): string[] {
  let files: string[];
  if (program === 'jest' && args.includes('--runTestsByPath')) {
    files = args.filter((arg) => !['--runTestsByPath', '--ci', '--runInBand'].includes(arg));
  } else if (program === 'vitest' && args[0] === 'run') {
    files = args.slice(1).filter((arg) => arg !== '--coverage');
  } else if (program === 'playwright') {
    files = args;
  } else return [];
  // Variables, shell globs, redirects and options with unmodeled values cannot safely narrow a command.
  return files.every((file) => !file.startsWith('-') && /^(?:[A-Za-z]:\/)?[\p{L}\p{N}_./ -]+$/u.test(file))
    ? files
    : [];
}

/**
 * The commands of a package.json script that start a runner, with the config and root each names. Only a command whose
 * program is the runner counts, so `eslint --plugin jest -c .eslintrc.json` and `npm run jest` start none.
 */
export function runnerCommands(
  script: string,
  runner: ScriptRunner,
  canEnter: (cwd: string) => boolean | null = () => true,
): RunnerCommand[] {
  const { programs, config, root } = RUNNERS[runner];
  const found: RunnerCommand[] = [];
  let cwd: string | null = '.';
  let previous = '';
  let success: boolean | null = null;
  for (const { words, next } of commandsOf(script)) {
    const before = previous;
    previous = next;
    if ((before === '&&' && success === false) || (before === '||' && success === true)) continue;
    success = null;
    if (words.length === 1 && ['true', 'false', ':'].includes(words[0])) {
      success = words[0] !== 'false';
      continue;
    }
    if (words[0] === 'cd' && before !== '|' && next !== '|') {
      const args = words.slice(1);
      if (args[0] === '-L') args.shift();
      if (args[0] === '--') args.shift();
      const [target] = args;
      if (args.length !== 1 || !/^(?:[A-Za-z]:\/)?[\p{L}\p{N}_./ -]+$/u.test(target) || target.startsWith('-')) {
        cwd = null;
      } else {
        const dir: string | null = path.isAbsolute(target) ? target : cwd === null ? null : path.join(cwd, target);
        success = dir === null ? null : canEnter(dir);
        if (success !== false) cwd = success ? dir : null;
      }
      continue;
    }
    const started = programOf(words);
    if (!started || !Object.hasOwn(programs, started.program)) continue;
    const subcommands = programs[started.program];
    let args = started.args;
    if (subcommands) {
      if (!subcommands.includes(args[0])) continue;
      args = args.slice(1);
    }
    const command: RunnerCommand = { config: null, root: null, unreadable: cwd === null };
    if (cwd && cwd !== '.') command.cwd = cwd;
    if (started.program === 'playwright' && args.length === 0) command.playwrightDefaults = true;
    if (runner === 'mocha') command.args = args;
    if (runner === 'webdriverio') {
      const first = args.at(0) === 'run' ? args.at(1) : args.at(0);
      if (first !== undefined && !first.startsWith('-')) command.config = first;
    }
    const remaining: string[] = [];
    for (let index = 0; index < args.length; index++) {
      const parts = args[index].split(/=(.*)/s);
      const key = config.includes(parts[0]) ? 'config' : root.includes(parts[0]) ? 'root' : null;
      if (key === null) {
        remaining.push(args[index]);
        continue;
      }
      const value = parts.at(1) ?? args.at(++index);
      if (value === undefined) command.unreadable = true;
      else command[key] = value;
    }
    // The shell expands a variable, and Jest reads a config that starts with `{` as the config itself.
    const values = [command.config, command.root].filter((value) => value !== null);
    if (values.some((value) => /[$%]/.test(value) || value.startsWith('{'))) command.unreadable = true;
    const filters = fileFilters(started.program, remaining);
    if (filters.length) command.filters = filters;
    found.push(command);
  }
  return found;
}

/**
 * The program a command starts, with its arguments: past variables set before it, `cross-env`, `dotenv --`,
 * `xvfb-run` and `xvfb-maybe`, the coverage tools `nyc`, `c8` and `mcr`, and `npx`, `bunx`, `pnpm exec`, `yarn exec`, `npm exec` or a package manager given a
 * binary's name; for `node`, the runner whose package holds the file it runs. Null when there is none.
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
    } else if (word === 'xvfb-run') {
      // Its options before the command, some of which take the next word as their value.
      index++;
      while (words.at(index)?.startsWith('-')) index += XVFB_VALUE_OPTIONS.has(words[index]) ? 2 : 1;
    } else if (word === 'xvfb-maybe') {
      index += next === '--' ? 2 : 1;
    } else if (word === 'nyc' || word === 'c8' || word === 'mcr') {
      // A coverage tool's options can take values, so its command starts at the first program that starts one.
      const start = words.findIndex((item, at) => at > index && STARTERS.has(item.split(/[/\\]/).at(-1) as string));
      if (start === -1) return null;
      index = start;
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
    const program = file?.at(1) ?? RUNNER_PACKAGES[file?.at(2)?.replaceAll('\\', '/') ?? ''];
    return program ? { program, args: words.slice(index + 1) } : null;
  }
  const name = word.split(/[/\\]/).at(-1) as string;
  return { program: name.replace(/\.(cmd|exe|[cm]?js)$/, ''), args: words.slice(index + 1) };
}

/** What a Mocha command line gives: the specs, positional or `--spec`, and each option's values, aliases resolved. */
export interface MochaArguments {
  positional: string[];
  /** Values by option name, in order; a flag has none. */
  options: Map<string, string[]>;
}

/** Mocha's options that take a value, by name and alias, from its `run-option-metadata`. */
const MOCHA_VALUES: Partial<Record<string, string>> = {
  config: 'config',
  extension: 'extension',
  file: 'file',
  global: 'global',
  globals: 'global',
  ignore: 'ignore',
  exclude: 'ignore',
  'node-option': 'node-option',
  n: 'node-option',
  'reporter-option': 'reporter-option',
  'reporter-options': 'reporter-option',
  O: 'reporter-option',
  require: 'require',
  r: 'require',
  spec: 'spec',
  'watch-files': 'watch-files',
  'watch-ignore': 'watch-ignore',
  fgrep: 'fgrep',
  f: 'fgrep',
  grep: 'grep',
  g: 'grep',
  package: 'package',
  reporter: 'reporter',
  R: 'reporter',
  ui: 'ui',
  u: 'ui',
  slow: 'slow',
  s: 'slow',
  timeout: 'timeout',
  timeouts: 'timeout',
  t: 'timeout',
  retries: 'retries',
  jobs: 'jobs',
  j: 'jobs',
};

/** The flags Mocha's options take, aliases resolved, that change which files run. */
const MOCHA_FLAGS: Partial<Record<string, string>> = {
  recursive: 'recursive',
  'no-config': 'no-config',
  'no-package': 'no-package',
};

/**
 * Reads a Mocha command line as Mocha does: an option written `--name value` or `--name=value`, a list option given
 * more than once or, but for `spec` and `ignore`, split at commas; any other word is a spec. A flag it doesn't know
 * takes no value.
 */
export function mochaArguments(args: readonly string[]): MochaArguments {
  const positional: string[] = [];
  const options = new Map<string, string[]>();
  for (let index = 0; index < args.length; index++) {
    const word = args[index];
    if (word === '--') {
      positional.push(...args.slice(index + 1));
      break;
    }
    const option = /^--?([^=]+)(?:=(.*))?$/s.exec(word);
    if (!option || word === '-') {
      positional.push(word);
      continue;
    }
    const name = option[1];
    const valued = MOCHA_VALUES[name];
    if (valued === undefined) {
      const flag = MOCHA_FLAGS[name];
      if (word === '--no-recursive') options.set('recursive', ['false']);
      else if (flag !== undefined) options.set(flag, flag === 'recursive' && option[2] === 'false' ? ['false'] : []);
      continue;
    }
    const value = option.at(2) ?? args.at(++index);
    if (value === undefined) break;
    const values = valued === 'spec' || valued === 'ignore' ? [value] : value.split(',');
    options.set(valued, [...(options.get(valued) ?? []), ...values]);
  }
  return { positional, options };
}
