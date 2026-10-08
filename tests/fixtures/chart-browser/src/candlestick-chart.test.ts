import { beforeEach, describe, expect, test } from 'vitest';
import { page, server } from 'vitest/browser';
import { CandlestickChart, FALLING, RISING, type Bar } from './candlestick-chart.ts';

const aaplSession: Bar[] = [
  { time: '09:30', open: 186.2, high: 187.9, low: 185.8, close: 187.5 },
  { time: '10:00', open: 187.5, high: 188.4, low: 186.9, close: 187.1 },
  { time: '10:30', open: 187.1, high: 189.2, low: 187.0, close: 189.0 },
];

function pixel(chart: CandlestickChart, x: number, y: number): string {
  const context = chart.canvas.getContext('2d') as CanvasRenderingContext2D;
  const [red, green, blue] = context.getImageData(x, y, 1, 1).data;
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

describe('CandlestickChart', () => {
  let chart: CandlestickChart;

  beforeEach(() => {
    document.body.replaceChildren();
    chart = new CandlestickChart(document.body);
    chart.draw(aaplSession);
  });

  test('gives each bar the same width', () => {
    expect(chart.candleWidth).toBeCloseTo(640 / 3);
  });

  test('colors rising candles green and falling candles red', () => {
    expect(pixel(chart, 50, 200)).toBe(RISING);
    expect(pixel(chart, 320, 180)).toBe(FALLING);
  });

  test('shows the prices of the candle under the pointer', async () => {
    await page.getByTestId('chart').hover({ position: { x: 330, y: 150 } });
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('O 187.5 H 188.4 L 186.9 C 187.1');
  });

  // WebKit returns an empty blob for canvases larger than the device pixel ratio allows in headless mode.
  test.skipIf(server.browser === 'webkit')('exports the chart as a PNG', async () => {
    const png = await chart.toPng();
    expect(png?.type).toBe('image/png');
  });

  test('matches the screenshot of the morning session', async () => {
    await expect(page.getByTestId('chart')).toMatchScreenshot('aapl-morning-session');
  });
});
