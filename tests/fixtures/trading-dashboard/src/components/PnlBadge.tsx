const signed = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: 'exceptZero' });

export function PnlBadge({ pnl }: { pnl: number }) {
  const tone = pnl > 0 ? 'gain' : pnl < 0 ? 'loss' : 'flat';
  return (
    <span className={`pnl pnl-${tone}`} data-tone={tone}>
      {signed.format(pnl)}
    </span>
  );
}
