import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PnlBadge } from './PnlBadge';

describe('PnlBadge', () => {
  it.each([
    [1250.5, '+$1,250.50', 'gain'],
    [-310, '-$310.00', 'loss'],
    [0, '$0.00', 'flat'],
  ])('formats %d as %s with the %s tone', (pnl, text, tone) => {
    render(<PnlBadge pnl={pnl} />);
    expect(screen.getByText(text)).toHaveAttribute('data-tone', tone);
  });
});
