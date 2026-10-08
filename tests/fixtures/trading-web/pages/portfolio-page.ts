import type { Locator, Page } from '@playwright/test';

export class PortfolioPage {
  readonly page: Page;
  readonly totalValue: Locator;
  readonly dayPnl: Locator;
  readonly unrealizedPnl: Locator;
  readonly cashBalance: Locator;
  readonly positions: Locator;

  constructor(page: Page) {
    this.page = page;
    this.totalValue = page.getByTestId('portfolio-total-value');
    this.dayPnl = page.getByTestId('portfolio-day-pnl');
    this.unrealizedPnl = page.getByTestId('portfolio-unrealized-pnl');
    this.cashBalance = page.getByTestId('cash-balance');
    this.positions = page.getByRole('table', { name: 'Positions' });
  }

  async goTo(): Promise<void> {
    await this.page.goto('/portfolio');
  }

  position(symbol: string): Locator {
    return this.positions.getByRole('row').filter({ hasText: symbol });
  }
}
