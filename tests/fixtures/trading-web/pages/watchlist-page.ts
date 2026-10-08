import type { Locator, Page } from '@playwright/test';

export class WatchlistPage {
  readonly page: Page;
  readonly rows: Locator;
  readonly symbolSearch: Locator;
  readonly sortByChangeButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.rows = page.getByTestId('watchlist-row');
    this.symbolSearch = page.getByPlaceholder('Add a symbol');
    this.sortByChangeButton = page.getByRole('columnheader', { name: 'Change %' });
  }

  async goTo(): Promise<void> {
    await this.page.goto('/watchlist');
  }

  row(symbol: string): Locator {
    return this.rows.filter({ hasText: symbol });
  }

  lastPrice(symbol: string): Locator {
    return this.row(symbol).getByTestId('last-price');
  }

  async addSymbol(symbol: string): Promise<void> {
    await this.symbolSearch.fill(symbol);
    await this.page.getByRole('option', { name: symbol, exact: true }).click();
  }

  async removeSymbol(symbol: string): Promise<void> {
    await this.row(symbol).hover();
    await this.row(symbol).getByRole('button', { name: 'Remove' }).click();
  }
}
