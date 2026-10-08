import type { Locator, Page } from '@playwright/test';

export class AlertsPage {
  readonly page: Page;
  readonly alerts: Locator;
  readonly newAlertButton: Locator;
  readonly notifications: Locator;

  constructor(page: Page) {
    this.page = page;
    this.alerts = page.getByTestId('price-alert');
    this.newAlertButton = page.getByRole('button', { name: 'New alert' });
    this.notifications = page.getByRole('status');
  }

  async goTo(): Promise<void> {
    await this.page.goto('/alerts');
  }

  async create(symbol: string, condition: 'above' | 'below', price: number): Promise<void> {
    await this.newAlertButton.click();
    await this.page.getByLabel('Symbol').fill(symbol);
    await this.page.getByLabel('Condition').selectOption(condition);
    await this.page.getByLabel('Price').fill(price.toFixed(2));
    await this.page.getByRole('button', { name: 'Save alert' }).click();
  }
}
