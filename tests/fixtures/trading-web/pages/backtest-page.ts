import type { Locator, Page } from '@playwright/test';

export class BacktestPage {
  readonly page: Page;
  readonly strategySelect: Locator;
  readonly symbolInput: Locator;
  readonly fromDate: Locator;
  readonly toDate: Locator;
  readonly runButton: Locator;
  readonly totalReturn: Locator;
  readonly maxDrawdown: Locator;
  readonly trades: Locator;
  readonly exportButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.strategySelect = page.getByLabel('Strategy');
    this.symbolInput = page.getByLabel('Symbol');
    this.fromDate = page.getByLabel('From');
    this.toDate = page.getByLabel('To');
    this.runButton = page.getByRole('button', { name: 'Run backtest' });
    this.totalReturn = page.getByTestId('total-return');
    this.maxDrawdown = page.getByTestId('max-drawdown');
    this.trades = page.getByRole('table', { name: 'Trades' }).getByRole('row');
    this.exportButton = page.getByRole('button', { name: 'Export trades' });
  }

  async goTo(): Promise<void> {
    await this.page.goto('/backtests/new');
  }

  async run(strategy: string, symbol: string, from: string, to: string): Promise<void> {
    await this.strategySelect.selectOption(strategy);
    await this.symbolInput.fill(symbol);
    await this.fromDate.fill(from);
    await this.toDate.fill(to);
    await this.runButton.click();
  }
}
