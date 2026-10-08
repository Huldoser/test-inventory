import type { Page } from '@playwright/test';
import { LoginPage } from '../pages/login-page';
import { TRADER } from '../test-data/accounts';

export const signedInPage = async ({ page }: { page: Page }, use: (page: Page) => Promise<void>) => {
  const loginPage = new LoginPage(page);
  await loginPage.goTo();
  await loginPage.signIn(TRADER.email, TRADER.password);
  await page.waitForURL('**/watchlist');
  await use(page);
};
