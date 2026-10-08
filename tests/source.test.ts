import { describe, expect, it } from 'vitest';
import { MAX_SNIPPET_LENGTH, snippet, SourceText, splitLines } from '../src/source.ts';

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

describe('SourceText', () => {
  it('counts lines at \\n, \\r\\n and \\r as editors do, and columns in UTF-16 code units', () => {
    const source = new SourceText(`a\nb\r\nc\rd${LINE_SEPARATOR}e${PARAGRAPH_SEPARATOR}f 😀 g`);
    expect(['a', 'b', 'c', 'd', 'e', 'f'].map((letter) => source.position(source.text.indexOf(letter)))).toEqual([
      { line: 1, column: 1 },
      { line: 2, column: 1 },
      { line: 3, column: 1 },
      { line: 4, column: 1 },
      { line: 4, column: 3 },
      { line: 4, column: 5 },
    ]);
    expect(source.position(source.text.indexOf('g'))).toEqual({ line: 4, column: 10 });
    expect(source.line(source.text.length)).toBe(4);
  });

  it('tells whether an offset starts its line after spaces and tabs', () => {
    const source = new SourceText('const a = 1; // trailing\n \t// own line\n');
    expect(source.startsLine(source.text.indexOf('// trailing'))).toBe(false);
    expect(source.startsLine(source.text.indexOf('// own line'))).toBe(true);
    expect(source.startsLine(0)).toBe(true);
  });

  it('tells whether two offsets are separated by at most one line break', () => {
    const source = new SourceText('a\n  b\n\nc');
    expect(source.isAdjacent(1, source.text.indexOf('b'))).toBe(true);
    expect(source.isAdjacent(source.text.indexOf('b') + 1, source.text.indexOf('c'))).toBe(false);
    expect(source.isAdjacent(0, 1)).toBe(false);
    expect(new SourceText('/* a */   test()').isAdjacent(7, 10)).toBe(true);
  });
});

describe('splitLines', () => {
  it('splits on \\r\\n, \\r and \\n, and keeps U+2028 inside a line', () => {
    expect(splitLines(`a\r\nb\rc\nd${LINE_SEPARATOR}e`)).toEqual(['a', 'b', 'c', `d${LINE_SEPARATOR}e`]);
  });
});

describe('snippet', () => {
  it('puts source on one line', () => {
    expect(snippet("  browserName ===\n    'webkit'  ")).toBe("browserName === 'webkit'");
  });

  it('cuts text longer than the limit with an ellipsis', () => {
    const cut = snippet('x'.repeat(MAX_SNIPPET_LENGTH + 10));
    expect(cut).toHaveLength(MAX_SNIPPET_LENGTH);
    expect(cut.endsWith('…')).toBe(true);
    expect(snippet('x'.repeat(MAX_SNIPPET_LENGTH))).toHaveLength(MAX_SNIPPET_LENGTH);
  });
});
