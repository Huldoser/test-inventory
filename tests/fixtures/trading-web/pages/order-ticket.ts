import type { Locator, Page } from '@playwright/test';

export interface OrderInput {
  quantity: number;
  /** Leave out for a market order. */
  limitPrice?: number;
}

export class OrderTicket {
  readonly page: Page;
  readonly dialog: Locator;
  readonly quantityInput: Locator;
  readonly orderTypeSelect: Locator;
  readonly limitPriceInput: Locator;
  readonly estimatedCost: Locator;
  readonly submitButton: Locator;
  readonly confirmButton: Locator;
  readonly error: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dialog = page.getByRole('dialog', { name: 'Order ticket' });
    this.quantityInput = this.dialog.getByLabel('Quantity');
    this.orderTypeSelect = this.dialog.getByLabel('Order type');
    this.limitPriceInput = this.dialog.getByLabel('Limit price');
    this.estimatedCost = this.dialog.getByTestId('estimated-cost');
    this.submitButton = this.dialog.getByRole('button', { name: 'Review order' });
    this.confirmButton = page.getByRole('button', { name: 'Place order' });
    this.error = this.dialog.getByRole('alert');
  }

  async open(symbol: string): Promise<void> {
    await this.page.goto(`/trade/${symbol}`);
  }

  async buy(order: OrderInput): Promise<void> {
    await this.dialog.getByRole('radio', { name: 'Buy' }).check();
    await this.fill(order);
  }

  async sell(order: OrderInput): Promise<void> {
    await this.dialog.getByRole('radio', { name: 'Sell' }).check();
    await this.fill(order);
  }

  private async fill({ quantity, limitPrice }: OrderInput): Promise<void> {
    await this.orderTypeSelect.selectOption(limitPrice === undefined ? 'Market' : 'Limit');
    await this.quantityInput.fill(String(quantity));
    if (limitPrice !== undefined) await this.limitPriceInput.fill(limitPrice.toFixed(2));
    await this.submitButton.click();
  }

  async confirm(): Promise<void> {
    await this.confirmButton.click();
  }
}
