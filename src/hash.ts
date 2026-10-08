import { createHash } from 'node:crypto';
import type { Node } from 'oxc-parser';
import type { Span } from './model.ts';

export function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/** Keys that hold positions or source text as written, which formatting changes and the code's meaning doesn't. */
const LAYOUT = new Set(['start', 'end', 'range', 'loc', 'raw']);

/** Text of a template literal with Windows line endings read as `\n`, as JavaScript does. */
function templateText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** JSX text the way JSX reads it: lines trimmed where they meet a line break, blank lines dropped, joined by spaces. */
function jsxText(text: string): string {
  const lines = text.split(/\r\n?|\n/);
  return lines
    .map((line, index) => {
      const start = index === 0 ? line : line.trimStart();
      return index === lines.length - 1 ? start : start.trimEnd();
    })
    .filter((line) => line !== '')
    .join(' ');
}

/**
 * Writes code as text that keeps its meaning and drops its layout, leaving out the nodes at the `cut` spans, given as
 * end by start. The text is appended to as the tree is walked: joining the parts at every level copies the text once
 * per level, and that was the slowest part of a scan.
 */
function canonical(root: readonly Node[], cut: ReadonlyMap<number, number>): string {
  let out = '';
  const write = (value: unknown): void => {
    if (typeof value === 'string') {
      out += JSON.stringify(value);
    } else if (typeof value === 'bigint') {
      out += `${String(value)}n`;
    } else if (typeof value !== 'object' || value === null) {
      out += String(value);
    } else if (Array.isArray(value)) {
      out += '[';
      for (const item of value) {
        write(item);
        out += ',';
      }
      out += ']';
    } else {
      writeNode(value as Record<string, unknown> & Node);
    }
  };
  const writeNode = (node: Record<string, unknown> & Node): void => {
    // Objects inside nodes, such as a regular expression's `{ pattern, flags }`, have no position.
    const end = cut.get(node.start);
    if (end !== undefined && end === node.end) {
      out += '_';
      return;
    }
    out += '{';
    for (const key in node) {
      if (LAYOUT.has(key)) continue;
      const field = node[key];
      out += key + ':';
      if (node.type === 'TemplateElement' && key === 'value') {
        const { cooked, raw } = field as { cooked: string | null; raw: string };
        write(templateText(cooked ?? raw));
      } else if (node.type === 'JSXText' && key === 'value') {
        write(jsxText(field as string));
      } else if (node.type === 'Literal' && key === 'value' && 'regex' in node) {
        // A regular expression is kept by its pattern and flags in `regex`.
        out += '/';
      } else {
        write(field);
      }
      out += ',';
    }
    out += '}';
  };
  write(root);
  return out;
}

/**
 * Hashes code by its syntax tree, so formatting, comments, quote style, trailing commas and line endings don't change
 * the hash. Nodes at the `cut` spans, such as the tests inside a describe, are left out. Returns null when no code is
 * given.
 */
export function hashNodes(nodes: readonly Node[], cut: readonly Span[] = []): string | null {
  const cuts = new Map(cut.map((span) => [span.start, span.end]));
  const kept = nodes.filter((node) => cuts.get(node.start) !== node.end);
  return kept.length === 0 ? null : shortHash(canonical(kept, cuts));
}
