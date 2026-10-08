export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  receivedAt: number;
}

export class QuoteCache {
  private readonly quotes = new Map<string, Quote>();

  constructor(private readonly maxAgeMs: number) {}

  put(quote: Quote): void {
    const current = this.quotes.get(quote.symbol);
    if (!current || current.receivedAt <= quote.receivedAt) this.quotes.set(quote.symbol, quote);
  }

  get(symbol: string, now: number): Quote | undefined {
    const quote = this.quotes.get(symbol);
    return quote && now - quote.receivedAt <= this.maxAgeMs ? quote : undefined;
  }

  mid(symbol: string, now: number): number | undefined {
    const quote = this.get(symbol, now);
    return quote && (quote.bid + quote.ask) / 2;
  }
}
