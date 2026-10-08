// Usage: node scripts/outdated.ts [--dry-run]
//
// Opens or updates one "Outdated dependencies" issue that lists the dependencies with a newer version, and closes it
// when there are none. The weekly "Outdated dependencies" workflow runs it; it never changes package.json or opens
// pull requests. With --dry-run it prints the issue instead of using the GitHub CLI.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from './run.ts';

const TITLE = 'Outdated dependencies';

/** Dependencies kept below their newest version on purpose. The issue lists them apart, with the reason. */
const HELD = new Map([
  ['@types/node', 'Types of the oldest supported Node.js, so that newer APIs are not used by accident.'],
  [
    'typescript',
    'typescript-eslint, TypeDoc and ts-json-schema-generator use the TypeScript 6 API, which TypeScript 7 does not have.',
  ],
]);

interface Outdated {
  current?: string;
  latest: string;
  type: string;
}

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** Compares two versions as semver does: numbers by value, and a prerelease before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const [release, prerelease = ''] = version.split(/-(.*)/s);
    return { release: release.split('.').map(Number), prerelease: prerelease ? prerelease.split('.') : [] };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index++) {
    if (left.release[index] !== right.release[index]) return left.release[index] - right.release[index];
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return right.prerelease.length - left.prerelease.length;
  }
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index++) {
    const [x, y] = [left.prerelease.at(index), right.prerelease.at(index)];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const numbers = /^\d+$/.test(x) && /^\d+$/.test(y);
    return numbers ? Number(x) - Number(y) : x < y ? -1 : 1;
  }
  return 0;
}

/** The newest version published under any dist-tag, so a prerelease such as `next` counts. */
function newest(name: string, latest: string): string {
  const tags = JSON.parse(run('npm', ['view', name, 'dist-tags', '--json'], root)) as Record<string, string>;
  return Object.values(tags).reduce((best, version) => (compareVersions(version, best) > 0 ? version : best), latest);
}

// npm outdated exits with 1 when something is outdated.
const listed = spawnSync('npm', ['outdated', '--json', '--long'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const outdated = JSON.parse(listed.stdout || '{}') as Record<string, Outdated>;
const rows: { name: string; type: string; range: string; installed: string; available: string }[] = [];
for (const [name, entry] of Object.entries(outdated).sort(([a], [b]) => (a < b ? -1 : 1))) {
  const installed = entry.current ?? 'not installed';
  const available = entry.current?.includes('-') ? newest(name, entry.latest) : entry.latest;
  // A prerelease from the `next` tag can be newer than `latest`.
  if (entry.current && compareVersions(available, entry.current) <= 0) continue;
  const range = manifest.dependencies[name] ?? manifest.devDependencies[name];
  rows.push({ name, type: entry.type === 'dependencies' ? 'runtime' : 'dev', range, installed, available });
}

const due = rows.filter((row) => !HELD.has(row.name));
const held = rows.filter((row) => HELD.has(row.name));
const body = [
  `\`npm outdated\` on ${new Date().toISOString().slice(0, 10)} found newer versions of these dependencies.`,
  '',
  '| Package | Type | In package.json | Installed | Newest |',
  '| --- | --- | --- | --- | --- |',
  ...due.map((row) => `| \`${row.name}\` | ${row.type} | \`${row.range}\` | ${row.installed} | ${row.available} |`),
  '',
  'Update them in a pull request, after checking their changelogs. This issue is updated every week and closed when',
  'everything is up to date.',
  ...(held.length > 0
    ? [
        '',
        '### Held back on purpose',
        '',
        ...held.map((row) => `- \`${row.name}\` ${row.available}: ${HELD.get(row.name)}`),
      ]
    : []),
].join('\n');

if (process.argv.includes('--dry-run')) {
  console.log(due.length > 0 ? `# ${TITLE}\n\n${body}` : 'Everything is up to date.');
  for (const row of held) console.log(`Held back: ${row.name} ${row.installed}, newest ${row.available}.`);
} else {
  const issues = JSON.parse(
    run('gh', ['issue', 'list', '--state', 'open', '--search', `"${TITLE}" in:title`, '--json', 'number,title'], root),
  ) as { number: number; title: string }[];
  const issue = issues.find((item) => item.title === TITLE);
  if (due.length === 0) {
    if (issue) run('gh', ['issue', 'close', String(issue.number), '--comment', 'Everything is up to date.'], root);
    console.log('Everything is up to date.');
  } else {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'outdated-')), 'body.md');
    writeFileSync(file, body);
    if (issue) run('gh', ['issue', 'edit', String(issue.number), '--body-file', file], root);
    else run('gh', ['issue', 'create', '--title', TITLE, '--body-file', file], root);
    console.log(`${issue ? 'Updated' : 'Opened'} "${TITLE}" with ${due.length} dependencies.`);
  }
}
