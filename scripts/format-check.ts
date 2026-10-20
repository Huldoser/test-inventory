// Usage: node scripts/format-check.ts, as `npm run format:check`.
//
// Checks formatting with Prettier, leaving out what git ignores. Git's own exclude file is found with git, since in a
// worktree `.git` is a file and `.git/info/exclude` can't be read.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { run } from './run.ts';

const root = path.resolve(import.meta.dirname, '..');
const exclude = path.resolve(root, run('git', ['rev-parse', '--git-common-dir'], root).trim(), 'info', 'exclude');
const prettier = createRequire(import.meta.url).resolve('prettier/bin/prettier.cjs');
const ignorePaths = ['.gitignore', '.prettierignore', exclude].flatMap((file) => ['--ignore-path', file]);
const { status } = spawnSync(process.execPath, [prettier, '--check', '.', ...ignorePaths], {
  cwd: root,
  stdio: 'inherit',
});
process.exitCode = status ?? 1;
