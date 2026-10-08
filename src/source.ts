// Editors and the Language Server Protocol break lines at \r\n, \r and \n only, not at U+2028 or U+2029.
const LINE_BREAK = /\r\n?|\n/g;

/** Longest `condition` or `source` text kept in the output, in UTF-16 code units. */
export const MAX_SNIPPET_LENGTH = 200;

export interface Position {
  line: number;
  column: number;
}

/** A file's text with offset-to-position lookup. Offsets, lines and columns all count UTF-16 code units. */
export class SourceText {
  readonly text: string;
  private readonly lineStarts: number[];

  constructor(text: string) {
    this.text = text;
    this.lineStarts = [0];
    for (const match of text.matchAll(LINE_BREAK)) {
      this.lineStarts.push(match.index + match[0].length);
    }
  }

  /** 1-based line and column of an offset. */
  position(offset: number): Position {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.lineStarts[middle] <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return { line: low + 1, column: offset - this.lineStarts[low] + 1 };
  }

  line(offset: number): number {
    return this.position(offset).line;
  }

  /** Whether only spaces and tabs come before an offset on its line. */
  startsLine(offset: number): boolean {
    let index = offset;
    while (index > 0 && (this.text[index - 1] === ' ' || this.text[index - 1] === '\t')) index--;
    return this.position(index).column === 1;
  }

  slice(start: number, end: number): string {
    return this.text.slice(start, end);
  }

  /** Whether the text between two offsets is only whitespace with at most one line break. */
  isAdjacent(start: number, end: number): boolean {
    const between = this.text.slice(start, end);
    return between.trim() === '' && (between.match(LINE_BREAK)?.length ?? 0) <= 1;
  }
}

export function splitLines(text: string): string[] {
  return text.split(LINE_BREAK);
}

/** Collapses whitespace and cuts long text, so snippets of source stay readable on one line. */
export function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_SNIPPET_LENGTH ? `${oneLine.slice(0, MAX_SNIPPET_LENGTH - 1)}…` : oneLine;
}
