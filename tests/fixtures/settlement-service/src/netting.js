/** Net position after a set of fills: buys add, sells subtract. */
function netQuantity(fills) {
  return fills.reduce((net, fill) => net + (fill.side === 'buy' ? fill.quantity : -fill.quantity), 0);
}

/** Cash a set of fills moves, negative when the account pays. */
function netCash(fills) {
  const cents = fills.reduce((total, fill) => {
    const value = Math.round(fill.quantity * fill.price * 100);
    return total + (fill.side === 'buy' ? -value : value);
  }, 0);
  return cents / 100;
}

module.exports = { netQuantity, netCash };
