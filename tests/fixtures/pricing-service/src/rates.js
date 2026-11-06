/** Cross rate of two USD quotes: how many units of `quote` one unit of `base` buys. */
export function crossRate(usdPer, base, quote) {
  if (!(base in usdPer) || !(quote in usdPer)) throw new RangeError(`No USD rate for ${base} or ${quote}`);
  return Math.round((usdPer[base] / usdPer[quote]) * 1e6) / 1e6;
}
