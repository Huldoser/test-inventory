import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { hashNodes, shortHash } from '../src/hash.ts';
import { parseFile } from '../src/parse.ts';

function hashOf(code: string, cut: (program: string) => { start: number; end: number }[] = () => []): string | null {
  const parsed = parseFile('hash.tsx', code);
  return hashNodes(parsed.program.body, cut(code));
}

const ORDER_TEST = `await orderTicket.buy({ symbol: "AAPL", quantity: 5, limitPrice: 187.5, note: 'scaling in' }); await expect(blotter.status('AAPL')).toHaveText("Working")
const fills = trades.filter(trade => trade.side === 'buy').map(trade => ({ ...trade, total: trade.price * trade.quantity }))`;

describe('hashNodes', () => {
  it.each([
    ['Prettier defaults', {}],
    ["this repository's Prettier settings", { printWidth: 120, singleQuote: true, trailingComma: 'all' as const }],
    ['no semicolons and no arrow parentheses', { semi: false, arrowParens: 'avoid' as const, printWidth: 40 }],
  ])('gives the same hash after formatting with %s', async (_, options) => {
    const formatted = await format(ORDER_TEST, { parser: 'typescript', ...options });
    expect(formatted).not.toBe(ORDER_TEST);
    expect(hashOf(formatted)).toBe(hashOf(ORDER_TEST));
  });

  it('ignores comments and parentheses', () => {
    expect(hashOf('const total = price * quantity; await ticket.buy({ quantity: 10 });')).toBe(
      hashOf(
        'const total = (price * quantity);\nawait ticket.buy({\n  // ten shares\n  quantity: 10, /* limit later */\n});',
      ),
    );
  });

  it('gives the same hash for Windows and Unix line endings in templates and JSX text', () => {
    const unix = 'const report = `AAPL 10\nMSFT 5`;\nconst row = <td>\n  Buy order\n  for AAPL\n</td>;';
    expect(hashOf(unix.replaceAll('\n', '\r\n'))).toBe(hashOf(unix));
    expect(hashOf('const row = <td>Buy order for AAPL</td>;')).toBe(
      hashOf('const row = (\n  <td>\n    Buy order\n    for AAPL\n  </td>\n);'),
    );
  });

  it('keeps what the code means: values, templates, regular expressions, JSX text and numbers', () => {
    expect(hashOf("expect(status).toBe('Partially filled');")).not.toBe(
      hashOf("expect(status).toBe('Partiallyfilled');"),
    );
    expect(hashOf('const label = `Total ${n} shares`;')).not.toBe(hashOf('const label = `Total ${n}shares`;'));
    expect(hashOf('const pattern = / AAPL/;')).not.toBe(hashOf('const pattern = /AAPL/;'));
    expect(hashOf('const pattern = /AAPL/i;')).not.toBe(hashOf('const pattern = /AAPL/;'));
    expect(hashOf('const row = <td>Buy order</td>;')).not.toBe(hashOf('const row = <td>Buyorder</td>;'));
    expect(hashOf('const volume = 10n ** 18n;')).not.toBe(hashOf('const volume = 10n ** 17n;'));
    expect(hashOf("const quote = 'AAPL';")).toBe(hashOf('const quote = "AAPL";'));
    // A tagged template may hold an escape that is not valid in a string, which leaves only its raw text.
    expect(hashOf('const path = String.raw`C:\\units\\AAPL`;')).not.toBe(
      hashOf('const path = String.raw`C:\\units\\MSFT`;'),
    );
  });

  it('leaves out cut spans, including the literals inside them', () => {
    const code = "setup(); test('fills', () => {});";
    const cut = (text: string) => [{ start: text.indexOf('test'), end: text.length }];
    expect(hashOf(code, cut)).toBe(hashOf('setup();'));
    expect(hashOf("test('fills', () => {});", (text) => [{ start: 0, end: text.length }])).toBeNull();
  });

  it('returns null when there is no code', () => {
    expect(hashOf('  // nothing here\n')).toBeNull();
  });

  it('uses 16 hex characters of SHA-256', () => {
    expect(shortHash('[]')).toMatch(/^[0-9a-f]{16}$/);
  });
});
