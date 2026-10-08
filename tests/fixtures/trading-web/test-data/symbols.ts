export const WATCHED_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'AMZN'] as const;

export type WatchedSymbol = (typeof WATCHED_SYMBOLS)[number];
