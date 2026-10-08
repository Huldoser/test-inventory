// The parts of `npm run release` that don't run git, npm or gh, kept apart so that tests can import them.

/** What `changeset status --output` writes, as far as a release reads it. */
export interface ReleasePlan {
  releases: { name: string; type: string; newVersion?: string }[];
}

/** The version the pending changesets give the package, or null when none of them releases it. */
export function nextVersion(plan: ReleasePlan, name: string): string | null {
  const release = plan.releases.find((item) => item.name === name && item.type !== 'none');
  return release?.newVersion ?? null;
}

export function releaseBranch(version: string): string {
  return `release-${version}`;
}

export function releaseTitle(version: string): string {
  return `Release ${version}`;
}

/** The text of a version's entry in CHANGELOG.md, without its heading; empty when the version has none. */
export function changelogEntry(changelog: string, version: string): string {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return '';
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

/**
 * The release pull request's description: the repository's template, with the version and its changelog entry under
 * "What changed", and the two boxes that hold for every release ticked. A release changes no docs, and it is where the
 * changesets end up.
 */
export function pullRequestBody(template: string, version: string, entry: string): string {
  const summary = `${releaseTitle(version)}, made with \`npm run release\`.${entry ? `\n\n${entry}` : ''}`;
  return template
    .replace(/<!--[\s\S]*?-->/, () => summary)
    .replace(/^- \[ \] (No docs change is needed)/m, '- [x] $1')
    .replace(/^- \[ \] (A changeset describes)/m, '- [x] $1');
}

/** `owner/name` from a GitHub repository URL as package.json writes it; null for anything else. */
export function repositorySlug(url: string): string | null {
  const match = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url);
  return match ? match[1] : null;
}

/** A link that opens GitHub's pull request form for the branch, with the title and description filled in. */
export function compareUrl(slug: string, base: string, branch: string, title: string, body: string): string {
  const query = `quick_pull=1&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  return `https://github.com/${slug}/compare/${base}...${branch}?${query}`;
}
