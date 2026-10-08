import { useState } from 'react';

export interface TicketOrder {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  quantity: number;
  limitPrice?: number;
}

interface OrderTicketProps {
  symbol: string;
  lastPrice: number;
  buyingPower: number;
  onSubmit: (order: TicketOrder) => void;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function OrderTicket({ symbol, lastPrice, buyingPower, onSubmit }: OrderTicketProps) {
  const [quantity, setQuantity] = useState('');
  const [type, setType] = useState<'market' | 'limit'>('market');
  const [limitPrice, setLimitPrice] = useState('');
  const shares = Number(quantity);
  const price = type === 'limit' ? Number(limitPrice) : lastPrice;
  const cost = shares * price;

  return (
    <form
      aria-label={`Order ticket for ${symbol}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ symbol, side: 'buy', type, quantity: shares, ...(type === 'limit' && { limitPrice: price }) });
      }}
    >
      <label>
        Quantity
        <input inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
      </label>
      <label>
        Order type
        <select value={type} onChange={(event) => setType(event.target.value as 'market' | 'limit')}>
          <option value="market">Market</option>
          <option value="limit">Limit</option>
        </select>
      </label>
      {type === 'limit' && (
        <label>
          Limit price
          <input inputMode="decimal" value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} />
        </label>
      )}
      {shares > 0 && <p>Estimated cost {usd.format(cost)}</p>}
      {cost > buyingPower && <p role="alert">Not enough buying power</p>}
      <button type="submit" disabled={!(shares > 0) || cost > buyingPower}>
        Submit
      </button>
    </form>
  );
}
