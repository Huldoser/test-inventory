// Usage: npm run release [-- --dry-run]
//
// Prepares the next release from an up-to-date main with pending changesets: a release-<version> branch where
// `changeset version` has raised the version and written the changelog, with the lockfile updated, committed as
// "Release <version>" and pushed, and the pull request for it, opened with gh when it is installed and otherwise
// through a link. Nothing is published here: the Release workflow publishes once the pull request is merged, and npm
// lists the version once a maintainer approves it on npmjs.com, as CONTRIBUTING.md describes. With --dry-run it checks
// and prints each step instead; it fetches main to compare with it, and changes no file and no branch.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  changelogEntry,
  compareUrl,
  nextVersion,
  pullRequestBody,
  releaseBranch,
  releaseTitle,
  repositorySlug,
  type ReleasePlan,
} from './release-plan.ts';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

/** Runs a command in the repository and returns its standard output; errors go to the terminal and throw. */
function capture(command: string, commandArgs: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    env: env ?? process.env,
    // npm and npx need a shell on Windows.
    shell: process.platform === 'win32' && (command === 'npm' || command === 'npx'),
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

function quote(arg: string): string {
  return /^[\w./:=@<>-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

/** Prints a step of the release and, unless this is a dry run, runs it with its output in the terminal. */
function step(command: string, commandArgs: string[], note = '', env?: NodeJS.ProcessEnv): void {
  console.log(`$ ${[command, ...commandArgs].map(quote).join(' ')}${note ? `   # ${note}` : ''}`);
  if (dryRun) return;
  execFileSync(command, commandArgs, {
    cwd: root,
    env: env ?? process.env,
    shell: process.platform === 'win32' && (command === 'npm' || command === 'npx'),
    stdio: 'inherit',
  });
}

/** Whether a command is installed, found on PATH without running it. */
function installed(command: string): boolean {
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD').split(';') : [''];
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .some(
      (folder) => folder !== '' && extensions.some((extension) => existsSync(path.join(folder, command + extension))),
    );
}

/** The pending changesets' version, from `changeset status`, or null when nothing is pending. */
function pendingVersion(name: string, folder: string): string | null {
  const file = path.join(folder, 'status.json');
  capture('npx', ['changeset', 'status', '--output', file]);
  return nextVersion(JSON.parse(readFileSync(file, 'utf8')) as ReleasePlan, name);
}

/** The checks a release must pass before anything changes, as messages for the ones that fail. */
function check(name: string, folder: string): { problems: string[]; version: string | null } {
  const problems: string[] = [];
  if (capture('git', ['status', '--porcelain']) !== '') {
    problems.push('The working tree has changes. Commit or stash them first.');
  }
  const branch = capture('git', ['branch', '--show-current']);
  if (branch !== 'main') problems.push(`Releases are made from main, and this is ${branch || 'a detached HEAD'}.`);
  console.log('$ git fetch --quiet origin main   # to compare main with GitHub');
  capture('git', ['fetch', '--quiet', 'origin', 'main']);
  if (capture('git', ['rev-parse', 'HEAD']) !== capture('git', ['rev-parse', 'origin/main'])) {
    problems.push('This is not the commit origin/main points to. Pull or push first.');
  }
  let version: string | null = null;
  try {
    version = pendingVersion(name, folder);
    if (version === null) problems.push('There are no changesets to release.');
  } catch (error) {
    // Changesets prints its reason on standard output, which was captured.
    const { stdout } = error as { stdout?: string };
    const output = (stdout ?? '')
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/^.*changeset v[\d.]+\s*$/m, '')
      .trim();
    problems.push(`changeset status failed${output ? `: ${output.replace(/\s*\n\s*/g, ' ')}` : '.'}`);
  }
  if (!process.env.GITHUB_TOKEN && !installed('gh')) {
    problems.push(
      'changeset version needs a GitHub token to link each change to its pull request. Set GITHUB_TOKEN, or install gh and run `gh auth login`.',
    );
  }
  return { problems, version };
}

/** The token `changeset version` reads pull request links with: GITHUB_TOKEN, or the one gh is logged in with. */
function githubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return capture('gh', ['auth', 'token']);
  } catch {
    throw new Error('gh has no token. Run `gh auth login`, or set GITHUB_TOKEN.');
  }
}

function main(): number {
  if (args.some((arg) => arg !== '--dry-run')) {
    console.error('Usage: npm run release [-- --dry-run]');
    return 2;
  }
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    name: string;
    repository: { url: string };
  };
  const slug = repositorySlug(manifest.repository.url);
  if (slug === null) {
    console.error(`package.json's repository, ${manifest.repository.url}, is not on GitHub.`);
    return 1;
  }
  const folder = mkdtempSync(path.join(tmpdir(), 'test-inventory-release-'));
  try {
    if (dryRun) console.log('Dry run: each step is checked and printed, and nothing changes.\n');
    const { problems, version } = check(manifest.name, folder);
    if (problems.length > 0) {
      console.error(`\n${problems.map((problem) => `- ${problem}`).join('\n')}\n`);
      if (!dryRun) return 1;
      console.log('A release would stop here. The steps after these checks:\n');
    }
    const shown = version ?? '<version>';
    const branch = releaseBranch(shown);
    const title = releaseTitle(shown);
    step('git', ['switch', '--create', branch]);
    const token = process.env.GITHUB_TOKEN ? 'from GITHUB_TOKEN' : 'from gh auth token';
    step('npx', ['changeset', 'version'], `with a GitHub token ${token}`, {
      ...process.env,
      GITHUB_TOKEN: dryRun ? undefined : githubToken(),
    });
    step('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
    step('git', ['commit', '--all', '--message', title]);
    step('git', ['push', '--set-upstream', 'origin', branch]);
    const entry = dryRun ? '' : changelogEntry(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), shown);
    const template = readFileSync(path.join(root, '.github/pull_request_template.md'), 'utf8');
    const body = pullRequestBody(template, shown, entry);
    if (installed('gh')) {
      const bodyFile = path.join(folder, 'body.md');
      writeFileSync(bodyFile, body);
      step('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body-file', bodyFile]);
    } else {
      console.log(`\nOpen the pull request: ${compareUrl(slug, 'main', branch, title, body)}`);
    }
    if (dryRun)
      console.log(
        `\nThe pull request's description, without the changelog entry until it is written:\n\n${body.trimEnd()}`,
      );
    console.log(
      '\nNext: wait for CI to pass, squash merge the pull request, and approve the new version on npmjs.com once the Release run has published it.',
    );
    return problems.length > 0 ? 1 : 0;
  } catch (error) {
    console.error(`\nThe release stopped: ${error instanceof Error ? error.message : String(error)}`);
    console.error('Finish it by hand from the step that failed, as CONTRIBUTING.md describes, or delete the branch.');
    return 1;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

process.exitCode = main();
