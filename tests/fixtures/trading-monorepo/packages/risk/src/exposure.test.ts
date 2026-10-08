import { describe, expect, test } from 'vitest';
import { exposure, type Holding } from './exposure.ts';

const portfolio: Holding[] = [
  { symbol: 'AAPL', sector: 'Technology', quantity: 40, price: 187.5 },
  { symbol: 'MSFT', sector: 'Technology', quantity: 15, price: 420.1 },
  { symbol: 'JPM', sector: 'Financials', quantity: 30, price: 198.4 },
];

describe('exposure', () => {
  test('splits the gross value by sector', () => {
    const bySector = exposure(portfolio);
    expect(bySector.Technology).toBeCloseTo(0.6987, 4);
    expect(bySector.Financials).toBeCloseTo(0.3013, 4);
  });

  test('counts short positions at their absolute value', () => {
    const bySector = exposure([...portfolio, { symbol: 'TSLA', sector: 'Automotive', quantity: -20, price: 251 }]);
    expect(bySector.Automotive).toBeCloseTo(0.2026, 4);
  });

  test.todo('nets options against their underlying');
});
