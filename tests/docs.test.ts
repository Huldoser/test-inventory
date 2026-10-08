// Checks that the docs and the README stay true to the code: code shown from the example projects is in their
// files, JSON shown is in their scan output, recipes print what the docs say, and the reference pages list every
// diagnostic, option and key.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP } from '../src/cli.ts';
import { LEVELS } from '../src/diagnostics.ts';
import type { Inventory } from '../src/index.ts';
import { EXAMPLES, fixtures, goldenPath, readGolden } from './examples.ts';
import { schema } from './helpers.ts';

const repository = path.resolve(import.meta.dirname, '..');

interface Block {
  page: string;
  line: number;
  lang: string;
  code: string;
  /** The `<!-- kind: value -->` comment right above the block, or above the code group it is in. */
  marker: { kind: string; value: string } | null;
  /** For a recipe, the output block after its code group. */
  output: string | null;
}

function pages(): string[] {
  const found = ['README.md'];
  const visit = (folder: string) => {
    for (const entry of readdirSync(path.join(repository, folder), { withFileTypes: true })) {
      const relative = path.posix.join(folder, entry.name);
      // The API pages are generated and the changelog is written by Changesets.
      if (entry.isDirectory() && entry.name !== 'api' && !entry.name.startsWith('.')) visit(relative);
      if (entry.isFile() && entry.name.endsWith('.md') && relative !== 'docs/changelog.md') found.push(relative);
    }
  };
  visit('docs');
  return found;
}

function blocks(page: string): Block[] {
  const lines = readFileSync(path.join(repository, page), 'utf8').split('\n');
  const found: Block[] = [];
  let marker: Block['marker'] = null;
  let group: Block[] | null = null;
  let recipe: Block[] | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const comment = /^<!-- ([\w-]+): (.+?) -->$/.exec(line);
    const fence = /^```(\w*)/.exec(line);
    if (comment) {
      marker = { kind: comment[1], value: comment[2] };
    } else if (line === '::: code-group') {
      group = [];
    } else if (line === ':::' && group) {
      // A recipe's output is the next block after its code group.
      if (marker?.kind === 'recipe') recipe = group;
      group = null;
      marker = null;
    } else if (fence) {
      const start = index;
      const code: string[] = [];
      while (!lines[++index].startsWith('```')) code.push(lines[index]);
      const block: Block = { page, line: start + 1, lang: fence[1], code: code.join('\n'), marker, output: null };
      if (recipe) {
        for (const item of recipe) item.output = block.code;
        recipe = null;
      } else {
        found.push(block);
        group?.push(block);
      }
      // A recipe's marker covers its whole code group; any other covers one block.
      if (marker?.kind !== 'recipe') marker = null;
    } else if (line.trim() !== '' && !group) {
      marker = null;
    }
  }
  return found;
}

const all = pages().flatMap(blocks);
const marked = (kind: string) => all.filter((block) => block.marker?.kind === kind);
const at = (block: Block) => `${block.page}:${block.line}`;

/** Whether every key shown is in the scan output with the same value. Lists of records shown empty are left out. */
function matches(shown: unknown, actual: unknown): boolean {
  if (Array.isArray(shown)) {
    if (!Array.isArray(actual)) return false;
    if (shown.length === 0 && actual.every((item) => typeof item === 'object' && item !== null)) return true;
    return shown.length === actual.length && shown.every((item, index) => matches(item, actual[index]));
  }
  if (typeof shown === 'object' && shown !== null) {
    if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return false;
    return Object.entries(shown).every(([key, value]) => key in actual && matches(value, (actual as never)[key]));
  }
  // Golden files hold `<version>` for the tool version, which the version shown in the docs stands for.
  return shown === actual || (actual === '<version>' && typeof shown === 'string' && /^\d+\.\d+\.\d+$/.test(shown));
}

/** The records and objects of a scan output, the output itself included, that a JSON block can show. */
function candidates(inventory: Inventory): unknown[] {
  return [inventory, inventory.summary, ...inventory.tests, ...inventory.suites, ...inventory.diagnostics];
}

describe('docs', () => {
  it('mark every JSON block with the example project it comes from', () => {
    const unmarked = all.filter((block) => block.lang.startsWith('json') && block.marker?.kind !== 'output');
    expect(unmarked.map(at)).toEqual([]);
  });

  it.each(marked('output').map((block) => [at(block), block] as const))(
    'show output from a real scan at %s',
    (_, block) => {
      const shown = JSON.parse(block.code) as unknown;
      expect(candidates(readGolden(block.marker?.value ?? '')).some((item) => matches(shown, item))).toBe(true);
    },
  );

  it.each(marked('code').map((block) => [at(block), block] as const))(
    'show code that is in the example project at %s',
    (_, block) => {
      // Prettier indents an excerpt as if it were the whole file, so indentation is left out of the comparison.
      const dedent = (text: string) => text.replaceAll('\r\n', '\n').replace(/^[ \t]+/gm, '');
      const file = dedent(readFileSync(path.join(fixtures, block.marker?.value ?? ''), 'utf8'));
      // A first line naming the file is there for the reader, and a `// ...` line stands for lines left out.
      const parts = dedent(block.code)
        .replace(/^\/\/ \S+\.\w+\n/, '')
        .split(/^\/\/ \.\.\.\n/m);
      let from = 0;
      for (const part of parts) {
        const found = file.indexOf(part, from);
        expect(found, `${at(block)}: ${part.split('\n')[0]}`).toBeGreaterThanOrEqual(0);
        from = found + part.length;
      }
    },
  );

  it.each(marked('scan').map((block) => [at(block), block] as const))(
    'show the command that scanned the example project at %s',
    (_, block) => {
      const example = EXAMPLES.find((item) => item.name === block.marker?.value);
      const words = [...block.code.matchAll(/"[^"]*"|\S+/g)].map((match) => match[0].replace(/^"(.*)"$/, '$1'));
      expect(words.slice(0, 2)).toEqual(['npx', 'test-inventory']);
      expect({
        patterns: words
          .slice(2)
          .filter((word, index, list) => !word.startsWith('-') && !list[index - 1]?.startsWith('--')),
        framework: words[words.indexOf('--framework') + 1],
      }).toEqual({ patterns: example?.patterns, framework: example?.framework });
    },
  );
});

/** jq, DuckDB and Python run when installed; `DOCS_RECIPES=all`, set in CI, makes a missing one fail instead. */
const RUNNERS: Record<string, { command: string; available: boolean; run: (code: string, dir: string) => string }> = {
  sh: {
    command: 'jq',
    available: spawnSync('jq', ['--version']).status === 0,
    run: (code, dir) => {
      const args = [...code.matchAll(/'[^']*'|\S+/g)].map((match) => match[0].replace(/^'(.*)'$/s, '$1'));
      expect(args[0]).toBe('jq');
      return execFileSync('jq', args.slice(1), { cwd: dir, encoding: 'utf8' });
    },
  },
  sql: {
    command: 'duckdb',
    available: spawnSync('duckdb', ['--version']).status === 0,
    run: (code, dir) => execFileSync('duckdb', ['-list', '-noheader', '-c', code], { cwd: dir, encoding: 'utf8' }),
  },
  js: {
    command: 'node',
    available: true,
    run: (code, dir) => {
      writeFileSync(path.join(dir, 'recipe.mjs'), code);
      return execFileSync(process.execPath, ['recipe.mjs'], { cwd: dir, encoding: 'utf8' });
    },
  },
  python: {
    command: process.platform === 'win32' ? 'python' : 'python3',
    available: spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['--version']).status === 0,
    run: (code, dir) => {
      writeFileSync(path.join(dir, 'recipe.py'), code);
      const command = process.platform === 'win32' ? 'python' : 'python3';
      return execFileSync(command, ['recipe.py'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, PYTHONUTF8: '1' },
      });
    },
  },
};

describe('recipes', () => {
  const recipes = marked('recipe');

  it('have one output and a version in each language', () => {
    expect(recipes.length).toBeGreaterThan(0);
    for (const block of recipes) {
      expect(block.output, at(block)).not.toBeNull();
      expect(Object.keys(RUNNERS), at(block)).toContain(block.lang);
    }
  });

  it.each(recipes.map((block) => [`${block.lang} at ${at(block)}`, block] as const))(
    'print the output shown for %s',
    (_, block) => {
      const runner = RUNNERS[block.lang];
      if (!runner.available && process.env.DOCS_RECIPES !== 'all') return;
      const dir = mkdtempSync(path.join(tmpdir(), 'test-inventory-recipe-'));
      try {
        writeFileSync(path.join(dir, 'inventory.json'), readFileSync(goldenPath(block.marker?.value ?? '')));
        expect(runner.run(block.code, dir).replaceAll('\r\n', '\n').trimEnd()).toBe(block.output);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('tables', () => {
  // A `|` splits a cell even inside a code span, which cuts the rest of the row off the page; it must be written `\|`.
  it.each(pages())('have as many cells in each row as in the header in %s', (page) => {
    const broken: number[] = [];
    let cells: number | null = null;
    let fenced = false;
    const lines = readFileSync(path.join(repository, page), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      if (line.startsWith('```')) fenced = !fenced;
      if (fenced || !line.startsWith('|')) {
        cells = null;
        continue;
      }
      const count = line.replaceAll('\\|', '').split('|').length;
      cells ??= count;
      if (count !== cells) broken.push(index + 1);
    }
    expect(broken).toEqual([]);
  });
});

describe('reference pages', () => {
  const page = (name: string) => readFileSync(path.join(repository, 'docs', name), 'utf8');
  /** The first two cells of each table row, without backticks. */
  const rows = (text: string) =>
    [...text.matchAll(/^\| `([^|]+)` *\| ([^|]+?) *\|/gm)].map((match) => [match[1].replaceAll('`', ''), match[2]]);

  it('list every diagnostic code with its level', () => {
    // A level can differ by framework, as in "warning, error in Playwright"; the first word is the usual one.
    const levels = rows(page('reference/diagnostics.md')).map(([code, level]) => [code, level.split(',')[0]]);
    expect(Object.fromEntries(levels)).toEqual(LEVELS);
  });

  it('list every command line option', () => {
    const documented = rows(page('guide/cli.md')).map(([option]) => option);
    const help = [...HELP.matchAll(/^ {2}(-[\w-]+(?:, --[\w-]+)?(?: <[\w.]+>)?)/gm)].map((match) => match[1]);
    expect(documented).toEqual(help);
  });

  it('describe every key of the output', () => {
    const text = page('reference/output.md');
    const definitions = (schema as { definitions: Record<string, { properties?: Record<string, unknown> }> })
      .definitions;
    const keys = new Set(Object.values(definitions).flatMap((definition) => Object.keys(definition.properties ?? {})));
    // A key is described when it is in a code span, alone or in a list such as `{ type, description }`.
    const spans = [...text.replace(/^```[\s\S]*?^```/gm, '').matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const missing = [...keys].filter((key) => !spans.some((span) => new RegExp(`\\b${key}\\b`).test(span)));
    expect(missing).toEqual([]);
  });
});
