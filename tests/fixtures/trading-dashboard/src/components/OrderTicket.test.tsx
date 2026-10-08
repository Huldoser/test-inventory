import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OrderTicket } from './OrderTicket';

describe('OrderTicket', () => {
  it('disables Submit until a quantity is entered', async () => {
    const user = userEvent.setup();
    render(<OrderTicket symbol="AAPL" lastPrice={187.5} buyingPower={25_000} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await user.type(screen.getByLabelText('Quantity'), '10');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
  });

  it('shows the estimated cost of a market order at the last price', async () => {
    const user = userEvent.setup();
    render(<OrderTicket symbol="AAPL" lastPrice={187.5} buyingPower={25_000} onSubmit={vi.fn()} />);
    await user.type(screen.getByLabelText('Quantity'), '10');
    expect(screen.getByText('Estimated cost $1,875.00')).toBeInTheDocument();
  });

  it('warns when the order costs more than the buying power', async () => {
    const user = userEvent.setup();
    render(<OrderTicket symbol="NVDA" lastPrice={118.3} buyingPower={1_000} onSubmit={vi.fn()} />);
    await user.type(screen.getByLabelText('Quantity'), '10');
    expect(screen.getByRole('alert')).toHaveTextContent('Not enough buying power');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('submits a limit order with its limit price', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<OrderTicket symbol="AAPL" lastPrice={187.5} buyingPower={25_000} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Quantity'), '10');
    await user.selectOptions(screen.getByLabelText('Order type'), 'limit');
    await user.type(screen.getByLabelText('Limit price'), '185');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledWith({
      symbol: 'AAPL',
      side: 'buy',
      type: 'limit',
      quantity: 10,
      limitPrice: 185,
    });
  });

  // TODO(TRD-731): the date picker for good-till-date orders is being rebuilt
  it.skip('submits a good-till-date order', async () => {
    const user = userEvent.setup();
    render(<OrderTicket symbol="AAPL" lastPrice={187.5} buyingPower={25_000} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Good till date' }));
  });

  it.todo('shows the estimated commission');
});
