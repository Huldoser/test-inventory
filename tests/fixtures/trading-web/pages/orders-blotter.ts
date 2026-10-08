import type { Locator, Page } from '@playwright/test';

export class OrdersBlotter {
  readonly page: Page;
  readonly openOrders: Locator;
  readonly filledOrders: Locator;

  constructor(page: Page) {
    this.page = page;
    this.openOrders = page.getByRole('table', { name: 'Open orders' });
    this.filledOrders = page.getByRole('table', { name: 'Filled orders' });
  }

  row(symbol: string): Locator {
    return this.page.getByTestId('order-row').filter({ hasText: symbol }).first();
  }

  status(symbol: string): Locator {
    return this.row(symbol).getByTestId('order-status');
  }

  async cancel(symbol: string): Promise<void> {
    await this.row(symbol).getByRole('button', { name: 'Cancel' }).click();
    await this.page.getByRole('button', { name: 'Cancel order' }).click();
  }
}
