import { createWriteStream, openSync, renameSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { Writable } from 'node:stream';
import { readFailure } from './files.ts';
import { checkFields, filterInventory, matcher, pickTestFields, type InventoryFilter } from './filter.ts';
import { writeInventory, writeInventoryLines, type Output } from './json.ts';
import { OptionsError } from './options.ts';
import { scan } from './scan.ts';
import type { TestRecord, TestState } from './types.ts';
import { toolVersion } from './version.ts';

export interface Io {
  stdout: Writable;
  stderr: Writable;
  cwd: string;
}

export const HELP = `Usage: test-inventory [glob...] --framework <playwright|vitest> [options]

Lists the tests in the matching files as JSON, read from the source code without running them. Without globs, the
test files are those the Playwright or Vitest configs in the root and the folders below it run.

Options:
  --framework <name>           playwright or vitest (required)
  --root <dir>                 project root; paths in the output are relative to it (default: current directory)
  --ignore <glob>              leave out matching files; can be repeated (node_modules is always left out)
  --framework-version <x.y.z>  apply the rules of this framework version instead of the one in the project
  --comments <mode>            comments above tests: all, non-active or none (default: non-active)
  --state <state>              keep tests in this state, such as skip or fixme; can be repeated
  --tag <tag>                  keep tests with this tag, such as @smoke; can be repeated
  --grep <regex>               keep tests whose full name matches, ignoring case
  --only                       keep tests that use .only, or are inside a describe that does
  --without-reason             keep tests that don't run and give no reason
  --fields <keys>              write only these keys of each test, separated by commas; id is always kept
  --format <format>            json or jsonl, one record per line (default: json)
  -o, --output <file>          write to a file instead of standard output
  --pretty                     indent the JSON
  -h, --help                   show this help
  -v, --version                show the version

Exit codes: 0 when the scan finishes, even with diagnostics; 2 for invalid arguments, an output that cannot be
written, or a crash. 1 is reserved for a future release.

Examples:
  test-inventory "tests/**/*.spec.ts" --framework playwright --output inventory.json
  test-inventory "tests/**/*.spec.ts" --framework playwright --state skip --fields fullName,reason
`;

/** CLI names for the option names in the library's errors. */
const FLAGS: Record<string, string> = {
  'options.patterns': 'the glob patterns',
  'options.framework': '--framework',
  'options.root': '--root',
  'options.ignore': '--ignore',
  'options.frameworkVersion': '--framework-version',
  'options.comments': '--comments',
  'filter.states': '--state',
  'filter.tags': '--tag',
  'filter.grep': '--grep',
  fields: '--fields',
};

const FORMATS = ['json', 'jsonl'];

async function writeTo(stream: Writable, chunk: string): Promise<void> {
  if (stream.errored) throw stream.errored;
  if (!stream.write(chunk)) await once(stream, 'drain');
}

/**
 * Writes to standard output, or to a file through a temporary file next to it, renamed when complete, so that a
 * failed write leaves no partial file behind.
 */
async function writeOutput(
  io: Io,
  file: string | undefined,
  write: (output: Writable) => Promise<void>,
): Promise<void> {
  if (file === undefined) {
    await write(io.stdout);
    return;
  }
  const target = path.resolve(io.cwd, file);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  // Opening the file first reports a missing folder or a permission problem before any work is written.
  const output = createWriteStream('', { fd: openSync(temporary, 'w') });
  try {
    await write(output);
    output.end();
    await once(output, 'finish');
    renameSync(temporary, target);
  } catch (error) {
    output.destroy();
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** ESLint's exit codes. 1 is reserved for a future release. */
const FINISHED = 0;
const FAILED = 2;

/** Runs the command line with the given arguments and streams. Resolves to the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  const fail = (message: string) => {
    io.stderr.write(`test-inventory: ${message}\nRun test-inventory --help for usage.\n`);
    return FAILED;
  };
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        framework: { type: 'string' },
        root: { type: 'string' },
        ignore: { type: 'string', multiple: true },
        'framework-version': { type: 'string' },
        comments: { type: 'string' },
        state: { type: 'string', multiple: true },
        tag: { type: 'string', multiple: true },
        grep: { type: 'string' },
        only: { type: 'boolean' },
        'without-reason': { type: 'boolean' },
        fields: { type: 'string' },
        format: { type: 'string' },
        output: { type: 'string', short: 'o' },
        pretty: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    return fail((error as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout.write(HELP);
    return FINISHED;
  }
  if (values.version) {
    io.stdout.write(`${toolVersion}\n`);
    return FINISHED;
  }
  if (values.framework === undefined) return fail('--framework is required: playwright or vitest.');
  const format = values.format ?? 'json';
  if (!FORMATS.includes(format)) return fail('--format must be json or jsonl.');
  if (format === 'jsonl' && values.pretty) return fail('--pretty indents JSON, so it does not go with --format jsonl.');
  const filter: InventoryFilter = {
    states: values.state as TestState[] | undefined,
    tags: values.tag,
    grep: values.grep,
    only: values.only,
    withoutReason: values['without-reason'],
  };
  const fields = values.fields?.split(',').map((field) => field.trim()) as (keyof TestRecord)[] | undefined;

  let inventory;
  let result: Output;
  try {
    // Checked before the scan, so a mistyped state or key doesn't wait for every file to be read.
    matcher(filter);
    if (fields !== undefined) checkFields(fields);
    inventory = await scan({
      patterns: positionals.length > 0 ? positionals : undefined,
      framework: values.framework as 'playwright',
      root: path.resolve(io.cwd, values.root ?? '.'),
      ignore: values.ignore ?? [],
      frameworkVersion: values['framework-version'],
      comments: values.comments as 'all' | undefined,
    });
    const filtered = filterInventory(inventory, filter);
    result = fields === undefined ? filtered : pickTestFields(filtered, fields);
  } catch (error) {
    if (error instanceof OptionsError) {
      return fail(error.message.replace(/^[\w.]+/, (name) => FLAGS[name]));
    }
    io.stderr.write(
      `test-inventory: unexpected error: ${error instanceof Error ? String(error.stack) : String(error)}\n`,
    );
    return FAILED;
  }
  const unmatched = inventory.diagnostics.find((diagnostic) => diagnostic.code === 'no-files-matched');
  if (unmatched) {
    io.stderr.write(`test-inventory: ${unmatched.message[0].toLowerCase()}${unmatched.message.slice(1)}\n`);
  }
  // A reader that stops early, as `| head` does, closes the pipe: an EPIPE error, which ends the output quietly.
  const quiet = () => undefined;
  io.stdout.on('error', quiet);
  try {
    await writeOutput(io, values.output, async (output) => {
      const write = (chunk: string) => writeTo(output, chunk);
      if (format === 'jsonl') {
        await writeInventoryLines(result, write);
      } else {
        await writeInventory(result, values.pretty === true, write);
        await write('\n');
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPIPE') return FINISHED;
    const where = values.output ?? 'the output';
    io.stderr.write(`test-inventory: could not write ${where}: ${readFailure(error)}.\n`);
    return FAILED;
  } finally {
    io.stdout.off('error', quiet);
  }
  return FINISHED;
}
