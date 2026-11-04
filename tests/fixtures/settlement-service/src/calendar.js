const HOLIDAYS = new Set(['2026-12-25', '2027-01-01']);

function isBusinessDay(date) {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6 && !HOLIDAYS.has(date.toISOString().slice(0, 10));
}

/** The settlement date `days` business days after the trade date. */
function settlementDate(tradeDate, days) {
  const date = new Date(tradeDate);
  for (let left = days; left > 0;) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isBusinessDay(date)) left -= 1;
  }
  return date.toISOString().slice(0, 10);
}

module.exports = { isBusinessDay, settlementDate };
