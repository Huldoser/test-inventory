export function OrderTicket({ symbol, buyingPower }: { symbol: string; buyingPower: number }) {
  return <button disabled={buyingPower <= 0}>Buy {symbol}</button>;
}
