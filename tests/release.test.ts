import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  changelogEntry,
  compareUrl,
  nextVersion,
  pullRequestBody,
  releaseBranch,
  releaseTitle,
  repositorySlug,
} from '../scripts/release-plan.ts';

// What `changeset status --output` writes for one pending patch changeset.
const STATUS = {
  changesets: [
    {
      releases: [{ name: 'test-inventory', type: 'patch' }],
      summary: 'Reads test.step.skip in a describe callback.',
      id: 'brave-quotes-fill',
    },
  ],
  releases: [
    {
      name: 'test-inventory',
      type: 'patch',
      oldVersion: '0.1.0',
      changesets: ['brave-quotes-fill'],
      newVersion: '0.1.1',
    },
  ],
};

const CHANGELOG = `# test-inventory

## 0.1.1

### Patch Changes

- [#7](https://github.com/Huldoser/test-inventory/pull/7) [\`1a2b3c4\`](https://github.com/Huldoser/test-inventory/commit/1a2b3c4) - Reads test.step.skip in a describe callback.

## 0.1.0

### Minor Changes

- [#1](https://github.com/Huldoser/test-inventory/pull/1) - First release.
`;

const TEMPLATE = readFileSync(path.resolve(import.meta.dirname, '../.github/pull_request_template.md'), 'utf8');

describe('release plan', () => {
  it('reads the next version from the changeset status', () => {
    expect(nextVersion(STATUS, 'test-inventory')).toBe('0.1.1');
  });

  it('has no version when no changeset releases the package', () => {
    expect(nextVersion({ releases: [] }, 'test-inventory')).toBeNull();
    expect(nextVersion(STATUS, 'trading-web')).toBeNull();
    expect(nextVersion({ releases: [{ name: 'test-inventory', type: 'none' }] }, 'test-inventory')).toBeNull();
  });

  it('names the branch and the pull request after the version', () => {
    expect(releaseBranch('0.1.1')).toBe('release-0.1.1');
    expect(releaseTitle('0.1.1')).toBe('Release 0.1.1');
  });

  it("takes a version's entry from the changelog, up to the next version", () => {
    expect(changelogEntry(CHANGELOG, '0.1.1')).toBe(
      '### Patch Changes\n\n- [#7](https://github.com/Huldoser/test-inventory/pull/7) [`1a2b3c4`](https://github.com/Huldoser/test-inventory/commit/1a2b3c4) - Reads test.step.skip in a describe callback.',
    );
    expect(changelogEntry(CHANGELOG, '0.1.0')).toBe(
      '### Minor Changes\n\n- [#1](https://github.com/Huldoser/test-inventory/pull/1) - First release.',
    );
    expect(changelogEntry(CHANGELOG.replaceAll('\n', '\r\n'), '0.1.0')).toContain('First release.');
    expect(changelogEntry(CHANGELOG, '0.2.0')).toBe('');
  });

  it('fills the pull request template for a release', () => {
    const body = pullRequestBody(TEMPLATE, '0.1.1', changelogEntry(CHANGELOG, '0.1.1'));
    expect(body).toContain('## What changed\n\nRelease 0.1.1, made with `npm run release`.\n\n### Patch Changes\n');
    expect(body).not.toContain('<!--');
    expect(body).toContain('- [x] No docs change is needed.');
    expect(body).toContain('- [x] A changeset describes the change for users');
    expect(body).toContain('- [ ] Tests cover the change');
    expect(body).toContain('- [ ] The docs describe the change');
  });

  it('keeps a $ in the changelog entry as it is', () => {
    const body = pullRequestBody(TEMPLATE, '0.1.1', 'Reads `$&` in titles.');
    expect(body).toContain('Reads `$&` in titles.');
  });

  it('reads the GitHub repository from package.json', () => {
    expect(repositorySlug('git+https://github.com/Huldoser/test-inventory.git')).toBe('Huldoser/test-inventory');
    expect(repositorySlug('git@github.com:Huldoser/test-inventory.git')).toBe('Huldoser/test-inventory');
    expect(repositorySlug('https://github.com/Huldoser/test-inventory')).toBe('Huldoser/test-inventory');
    expect(repositorySlug('https://gitlab.com/Huldoser/test-inventory.git')).toBeNull();
  });

  it('links to the pull request form with the title and description filled in', () => {
    const body = pullRequestBody(TEMPLATE, '0.1.1', '');
    const url = new URL(compareUrl('Huldoser/test-inventory', 'main', 'release-0.1.1', 'Release 0.1.1', body));
    expect(url.origin + url.pathname).toBe('https://github.com/Huldoser/test-inventory/compare/main...release-0.1.1');
    expect(url.searchParams.get('quick_pull')).toBe('1');
    expect(url.searchParams.get('title')).toBe('Release 0.1.1');
    expect(url.searchParams.get('body')).toBe(body);
  });
});
