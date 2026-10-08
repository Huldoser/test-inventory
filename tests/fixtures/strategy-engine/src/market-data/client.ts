export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDataClient {
  dailyCandles(symbol: string, from: string, to: string): Promise<Candle[]>;
}

export function createMarketDataClient(baseUrl: string, apiKey: string): MarketDataClient {
  return {
    async dailyCandles(symbol, from, to) {
      const url = new URL(`/v1/candles/${encodeURIComponent(symbol)}`, baseUrl);
      url.search = new URLSearchParams({ interval: '1d', from, to }).toString();
      const response = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` } });
      if (!response.ok) throw new Error(`Market data request failed with ${response.status}`);
      return (await response.json()) as Candle[];
    },
  };
}
