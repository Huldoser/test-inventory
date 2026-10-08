import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PositionsTable } from './PositionsTable';

describe('PositionsTable', () => {
  it('shows an empty state without positions', () => {
    render(<PositionsTable positions={[]} />);
    expect(screen.getByText('No open positions')).toBeInTheDocument();
  });

  it('shows the unrealized P&L of each position', () => {
    render(
      <PositionsTable
        positions={[
          { symbol: 'AAPL', quantity: 40, averagePrice: 172.1, lastPrice: 187.5 },
          { symbol: 'MSFT', quantity: 15, averagePrice: 431, lastPrice: 420.1 },
        ]}
      />,
    );
    const [, apple, microsoft] = screen.getAllByRole('row');
    expect(within(apple).getByText('+$616.00')).toBeInTheDocument();
    expect(within(microsoft).getByText('-$163.50')).toBeInTheDocument();
  });
});
