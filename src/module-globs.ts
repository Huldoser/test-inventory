import { readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { CallExpression } from 'oxc-parser';
import picomatch from 'picomatch';
import { globSync } from 'tinyglobby';

/** One Vite glob call, with root-relative positive and negative patterns kept together. */
export function modulePatterns(call: CallExpression, from: string): string[] | null {
  const first = call.arguments.at(0);
  const options = call.arguments.at(1);
  if (
    options &&
    (call.arguments.length !== 2 ||
      options.type !== 'ObjectExpression' ||
      !options.properties.every(
        (p) =>
          p.type === 'Property' &&
          !p.computed &&
          p.key.type === 'Identifier' &&
          p.key.name === 'eager' &&
          p.value.type === 'Literal' &&
          typeof p.value.value === 'boolean',
      ))
  )
    return null;
  const items = first?.type === 'ArrayExpression' ? first.elements : [first];
  const patterns: string[] = [];
  for (const item of items) {
    if (item?.type !== 'Literal' || typeof item.value !== 'string') return null;
    const negative = item.value.startsWith('!');
    const literal = negative ? item.value.slice(1) : item.value;
    if (
      !/^\.\.?\//.test(literal) ||
      !/^[\w./*-]+$/.test(literal) ||
      literal
        .replace(/^(?:\.\.?\/)+/, '')
        .split('/')
        .includes('..')
    )
      return null;
    const target = path.posix.join(path.posix.dirname(from), literal);
    if (
      target.split('/').some((segment) => segment.startsWith('.') || segment === 'node_modules') ||
      !/^[\w./*-]+$/.test(target)
    )
      return null;
    patterns.push((negative ? '!' : '') + target);
  }
  if (!patterns.some((p) => !p.startsWith('!')) || !/^[\w./-]+$/.test(from)) return null;
  return [...new Set([...patterns, '!' + from])].sort();
}

/** Keep symlinked and unreadable trees unknown. Vite can include files beyond what the scan may read. */
export function moduleMatches(root: string, patterns: string[]): string[] | null {
  const unreadable = new Set<string>();
  const files = globSync(patterns, {
    cwd: root,
    expandDirectories: false,
    extglob: false,
    followSymbolicLinks: false,
    ignore: ['**/node_modules/**'],
    fs: {
      readdirSync: ((folder: string) => {
        try {
          if (path.relative(realpathSync(root), realpathSync(folder)) !== path.relative(root, folder)) {
            unreadable.add(folder);
            return [];
          }
          const entries = readdirSync(folder, { withFileTypes: true });
          if (entries.some((e) => e.isSymbolicLink())) unreadable.add(folder);
          return entries;
        } catch {
          unreadable.add(folder);
          return [];
        }
      }) as unknown as typeof readdirSync,
    },
  });
  return unreadable.size > 0 || files.some((f) => /[?#\\]/.test(f)) ? null : files.sort();
}

/** Whether a changed path belongs to this saved call, including one added after the scan. */
export function globRelated(patterns: string[], files: Set<string>): boolean {
  const include = picomatch(
    patterns.filter((p) => !p.startsWith('!')),
    {
      noext: true,
      ignore: [...patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1)), '**/node_modules/**'],
    },
  );
  return [...files].some((file) => include(file));
}
