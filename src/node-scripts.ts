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
  for (const command of script.split(/&&|\|\||[;|]/)) {
    const words = [...command.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map(
      (match) => (match[1] as string | undefined) ?? (match[2] as string | undefined) ?? match[3],
    );
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
