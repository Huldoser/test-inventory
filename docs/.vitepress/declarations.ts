import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseSync } from 'oxc-parser';
import type { MarkdownRenderer } from 'vitepress';

// The files that declare what src/index.ts exports. Other files reuse some of the names, such as `Position`.
const FILES = ['types.ts', 'options.ts', 'records.ts', 'scan.ts', 'scan-source.ts'];
const src = path.resolve(import.meta.dirname, '../../src');

/**
 * `@inline` makes TypeDoc show a type in place of a link on the API pages. It means nothing to a reader of the
 * declaration, so it goes, and a comment that had one line before the tag is put back on one line.
 */
function withoutInline(text: string): string {
  return text
    .replace(/^\/\*\* @inline \*\/\n/, '')
    .replace(/^\/\*\*\n \* (.+)\n \*\n \* @inline\n \*\/\n/, '/** $1 */\n')
    .replace(/^ \*\n \* @inline\n/m, '');
}

/** Each top-level type, interface and function signature in the file, with the doc comment above it. */
function declarationsIn(file: string): Map<string, string> {
  const code = readFileSync(path.join(src, file), 'utf8');
  const { program, comments } = parseSync(file, code);
  const found = new Map<string, string>();
  for (const statement of program.body) {
    const node =
      statement.type === 'ExportNamedDeclaration' && statement.declaration ? statement.declaration : statement;
    let name: string;
    let end = statement.end;
    if (node.type === 'TSTypeAliasDeclaration' || node.type === 'TSInterfaceDeclaration') {
      name = node.id.name;
    } else if (node.type === 'FunctionDeclaration' && node.id && node.body) {
      name = node.id.name;
      end = node.body.start;
    } else {
      continue;
    }
    const doc = comments.findLast((comment) => comment.end <= statement.start);
    const documented =
      doc?.type === 'Block' && doc.value.startsWith('*') && !code.slice(doc.end, statement.start).trim();
    let text = code.slice(documented ? doc.start : statement.start, end).trimEnd();
    // A signature without its body, the way the published .d.ts file declares it.
    if (node.type === 'FunctionDeclaration') text = `${text.replace(/^(export )?async /m, '$1')};`;
    found.set(name, withoutInline(text));
  }
  return found;
}

/** The source of the named declarations, in the order given. */
export function declarations(names: readonly string[]): string {
  const files = FILES.map((file) => ({ file, found: declarationsIn(file) }));
  return names
    .map((name) => {
      const matches = files.filter(({ found }) => found.has(name));
      if (matches.length !== 1) {
        const where = matches.length ? `in ${matches.map(({ file }) => file).join(' and ')}` : 'nowhere';
        throw new Error(`"${name}" must be declared in exactly one of src/${FILES.join(', src/')}; it is ${where}.`);
      }
      return matches[0].found.get(name);
    })
    .join('\n\n');
}

/** The names in a `<!-- types: Inventory, Tool -->` line, or null for any other line. */
export function typeNames(line: string): string[] | null {
  return /^<!-- types: (.+) -->$/.exec(line)?.[1].split(/,\s*/) ?? null;
}

/**
 * Replaces each `<!-- types: ... -->` line with a TypeScript block holding those declarations, read from src/ when the
 * page is built, so the docs show the types as they are in the code.
 */
export function typesFromSource(md: MarkdownRenderer): void {
  md.block.ruler.before('html_block', 'types', (state, line, _endLine, silent) => {
    const names = typeNames(state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]));
    if (!names) return false;
    if (!silent) {
      const token = state.push('fence', 'code', 0);
      token.info = 'ts';
      token.markup = '```';
      token.content = `${declarations(names)}\n`;
      token.map = [line, line + 1];
    }
    state.line = line + 1;
    return true;
  });
}
