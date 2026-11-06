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
export function nodeTestCommands(script: string): string[][] {
  const commands: string[][] = [];
  for (const words of commandsOf(script)) {
    const node = words.findIndex((word) => /(^|[/\\])node(\.exe)?$/.test(word));
    if (node === -1) continue;
    let runsTests = false;
    const files: string[] = [];
    for (let index = node + 1; index < words.length; index++) {
      const word = words[index];
      if (word === '--test') runsTests = true;
      else if (VALUE_OPTIONS.has(word)) index++;
      else if (!word.startsWith('-')) {
        if (!runsTests) break;
        files.push(word);
      }
    }
    if (runsTests) commands.push(files);
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
