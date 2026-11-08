import type { InventoryDiff } from './diff.ts';

/** Escapes project text so titles cannot become markup, links or extra table rows. */
function cell(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replaceAll('`', '&#96;')
    .replaceAll('*', '&#42;')
    .replaceAll('_', '&#95;')
    .replaceAll('[', '&#91;')
    .replaceAll(']', '&#93;')
    .replaceAll('\\', '&#92;')
    .replaceAll(/\r?\n|\r/g, ' ');
}

/** A report ready to save as Markdown or use as the body of a pull request comment. */
export function formatDiffMarkdown(diff: InventoryDiff): string {
  const lines = [
    `Test inventory diff: ${diff.summary.added} added, ${diff.summary.removed} removed, ${diff.summary.changed} changed, ${diff.summary.unchanged} unchanged.`,
    ...diff.warnings.map((warning) => `\n${cell(warning)}`),
  ];
  if (diff.changes.length > 0) {
    lines.push('', '| Changes | Before | After | Match |', '| --- | --- | --- | --- |');
    for (const change of diff.changes) {
      const show = (test: typeof change.before) =>
        test === null ? '' : cell(`${test.relativeFilePath}:${test.lineStart} ${test.fullName}`);
      lines.push(
        `| ${change.kinds.join(', ')} | ${show(change.before)} | ${show(change.after)} | ${change.match ?? ''} |`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
