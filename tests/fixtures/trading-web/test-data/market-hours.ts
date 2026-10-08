const OPEN_MINUTE = 9 * 60 + 30;
const CLOSE_MINUTE = 16 * 60;

/** Regular US trading hours, 9:30 to 16:00 in New York, Monday to Friday. Holidays are not handled. */
export function isMarketClosed(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  if (part('weekday') === 'Sat' || part('weekday') === 'Sun') return true;
  const minute = Number(part('hour')) * 60 + Number(part('minute'));
  return minute < OPEN_MINUTE || minute >= CLOSE_MINUTE;
}
