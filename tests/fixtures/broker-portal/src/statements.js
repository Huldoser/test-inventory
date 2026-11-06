/** The statement months a client can download: the last `count` full months before `today`, newest first. */
export function statementMonths(today, count) {
  const months = [];
  for (let back = 1; back <= count; back++) {
    const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
    months.push(month.toISOString().slice(0, 7));
  }
  return months;
}

/** The margin a client has left: equity less the maintenance requirement, never below 0. */
export function excessMargin({ equity, requirement }) {
  return Math.max(Math.round((equity - requirement) * 100) / 100, 0);
}
