export interface Bar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export const RISING = '#16a34a';
export const FALLING = '#dc2626';

export class CandlestickChart {
  readonly canvas: HTMLCanvasElement;
  readonly tooltip: HTMLElement;
  private bars: Bar[] = [];

  constructor(container: HTMLElement, width = 640, height = 320) {
    this.canvas = Object.assign(document.createElement('canvas'), { width, height });
    this.canvas.dataset.testid = 'chart';
    this.tooltip = document.createElement('div');
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.hidden = true;
    this.canvas.addEventListener('pointermove', (event) => this.showTooltip(event.offsetX));
    container.append(this.canvas, this.tooltip);
  }

  get candleWidth(): number {
    return this.canvas.width / Math.max(this.bars.length, 1);
  }

  draw(bars: Bar[]): void {
    this.bars = bars;
    const context = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    const high = Math.max(...bars.map((bar) => bar.high));
    const low = Math.min(...bars.map((bar) => bar.low));
    const y = (price: number) => ((high - price) / (high - low)) * this.canvas.height;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    bars.forEach((bar, index) => {
      const x = index * this.candleWidth;
      context.fillStyle = bar.close >= bar.open ? RISING : FALLING;
      context.fillRect(x + this.candleWidth / 2, y(bar.high), 1, y(bar.low) - y(bar.high));
      const top = y(Math.max(bar.open, bar.close));
      context.fillRect(x + 2, top, this.candleWidth - 4, Math.max(y(Math.min(bar.open, bar.close)) - top, 1));
    });
  }

  toPng(): Promise<Blob | null> {
    return new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
  }

  private showTooltip(x: number): void {
    const bar = this.bars[Math.floor(x / this.candleWidth)];
    this.tooltip.hidden = !bar;
    if (bar) this.tooltip.textContent = `O ${bar.open} H ${bar.high} L ${bar.low} C ${bar.close}`;
  }
}
