import { PnlBadge } from './PnlBadge';

export interface Position {
  symbol: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
}

export function PositionsTable({ positions }: { positions: Position[] }) {
  if (positions.length === 0) return <p>No open positions</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Quantity</th>
          <th>Unrealized P&amp;L</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => (
          <tr key={position.symbol}>
            <td>{position.symbol}</td>
            <td>{position.quantity}</td>
            <td>
              <PnlBadge pnl={(position.lastPrice - position.averagePrice) * position.quantity} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
