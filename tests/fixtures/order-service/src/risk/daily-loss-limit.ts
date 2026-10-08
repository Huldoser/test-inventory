export interface TradingDay {
  sessionDate: string;
  realizedPnl: number;
}

export function isHalted(day: TradingDay, lossLimit: number): boolean {
  return day.realizedPnl <= -lossLimit;
}

export function nextSession(day: TradingDay, now: Date): TradingDay {
  const sessionDate = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return sessionDate === day.sessionDate ? day : { sessionDate, realizedPnl: 0 };
}
