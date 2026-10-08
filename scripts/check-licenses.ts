// Fails when an installed package, a runtime or a development dependency, direct or not, or a tool that CI downloads,
// has a license outside the allowed lists: permissive licenses that cost nothing and ask for no more than keeping their
// notice.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { run } from './run.ts';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
]);

/**
 * Also allowed for development tools, which are never shipped: MPL-2.0 (lightningcss, under Vite) only asks for
 * changes to its own files to be shared when they are distributed, and Python-2.0 is permissive.
 */
const DEV_ONLY = new Set(['MPL-2.0', 'Python-2.0']);

/**
 * Command line tools that CI downloads outside npm, each pinned by a `<NAME>_VERSION` and a checksum in ci.yml, with
 * the license its repository states. A tool in ci.yml that is missing here has an unknown license and fails the check.
 */
const CI_TOOLS = new Map([
  ['actionlint', 'MIT'],
  ['duckdb', 'MIT'],
  ['gitleaks', 'MIT'],
  ['zizmor', 'MIT'],
]);

interface Dependency {
  version?: string;
  license?: string;
  dependencies?: Record<string, Dependency>;
}

/** Whether an SPDX expression such as "(MIT OR Apache-2.0)" is allowed: one side of OR, every side of AND. */
export function isAllowed(license: string, dev: boolean): boolean {
  const allowed = (part: string) => ALLOWED.has(part) || (dev && DEV_ONLY.has(part));
  return license
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/)
    .some((option) => option.split(/\s+AND\s+/).every((part) => allowed(part.trim())));
}

function collect(dependencies: Record<string, Dependency>, found: Map<string, string>, skipped: Set<string>): void {
  for (const [name, dependency] of Object.entries(dependencies)) {
    // Optional packages for other platforms, such as oxc's prebuilt binaries, are listed but not installed.
    if (dependency.version === undefined) {
      skipped.add(name);
      continue;
    }
    found.set(`${name}@${dependency.version}`, dependency.license ?? 'unknown');
    collect(dependency.dependencies ?? {}, found, skipped);
  }
}

function installed(args: string[]): { found: Map<string, string>; skipped: Set<string> } {
  const tree = JSON.parse(run('npm', ['ls', '--all', '--long', '--json', ...args], root)) as Dependency;
  const found = new Map<string, string>();
  const skipped = new Set<string>();
  collect(tree.dependencies ?? {}, found, skipped);
  return { found, skipped };
}

function ciTools(): Map<string, string> {
  const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const tools = new Map<string, string>();
  for (const match of workflow.matchAll(/^\s+([A-Z]+)_VERSION: (\S+)$/gm)) {
    const name = match[1].toLowerCase();
    tools.set(`${name}@${match[2]} (CI tool)`, CI_TOOLS.get(name) ?? 'unknown');
  }
  return tools;
}

const root = path.resolve(import.meta.dirname, '..');
const { found, skipped } = installed([]);
for (const [name, license] of ciTools()) found.set(name, license);
const runtime = installed(['--omit=dev']).found;
const rows = [...found]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([name, license]) => ({ name, license, dev: !runtime.has(name) }));
const rejected = rows.filter((row) => !isAllowed(row.license, row.dev));
console.log(
  rows
    .map((row) => {
      const verdict = isAllowed(row.license, row.dev) ? 'ok' : 'NOT ALLOWED';
      return `${verdict}  ${row.dev ? 'dev' : 'runtime'}  ${row.name}  ${row.license}`;
    })
    .join('\n'),
);
console.log(`\nNot installed on this platform, so not checked here: ${[...skipped].sort().join(', ') || 'none'}.`);
if (rejected.length > 0) {
  console.error(`\n${rejected.length} packages have a license outside: ${[...ALLOWED].join(', ')}.`);
  process.exitCode = 1;
}
