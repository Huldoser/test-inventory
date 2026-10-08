// Usage: node scripts/docs-required.ts, in the "Docs required" workflow of a pull request.
//
// Fails when the pull request changes what the package does (src/ or schema/) and not the docs (docs/ or README.md).
// The "no docs" label, or a ticked "No docs change is needed" in the pull request template, lets it pass. A release
// pull request, which only changes the version, the changelog and the changesets, passes on its own.
import { readFileSync } from 'node:fs';
import { run } from './run.ts';

interface PullRequestEvent {
  pull_request: { body: string | null; labels: { name: string }[]; base: { sha: string }; head: { sha: string } };
}

const { pull_request: pullRequest } = JSON.parse(
  readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'),
) as PullRequestEvent;
const changed = run('git', ['diff', '--name-only', `${pullRequest.base.sha}...${pullRequest.head.sha}`], process.cwd())
  .split('\n')
  .filter(Boolean);
const RELEASE_FILES = new Set(['CHANGELOG.md', 'package.json', 'package-lock.json']);
const release = changed.every((file) => RELEASE_FILES.has(file) || file.startsWith('.changeset/'));
const code = changed.filter((file) => file.startsWith('src/') || file.startsWith('schema/'));
const docs = changed.filter((file) => file.startsWith('docs/') || file === 'README.md');
const label = pullRequest.labels.some((item) => item.name === 'no docs');
const ticked = /^- \[x\] No docs change is needed/im.test(pullRequest.body ?? '');

if (release) {
  console.log('A release pull request: only the version, the changelog and the changesets changed.');
} else if (code.length === 0) {
  console.log('No changes in src/ or schema/; docs are not required.');
} else if (docs.length > 0) {
  console.log(`Docs changed with the code: ${docs.join(', ')}.`);
} else if (label || ticked) {
  console.log(`No docs change, as ${label ? 'the "no docs" label' : 'the pull request description'} says.`);
} else {
  console.log(`These files change what the package does, and no file in docs/ or README.md changed:`);
  for (const file of code) console.log(`  ${file}`);
  console.log('Update the docs, or tick "No docs change is needed" in the description if none is needed.');
  process.exitCode = 1;
}
