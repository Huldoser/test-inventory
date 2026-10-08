import { test, expect } from '../fixtures/index';
import { LOCKED_TRADER, TRADER } from '../test-data/accounts';

test.describe('login', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ loginPage }) => {
    await loginPage.goTo();
  });

  test('signs in with email and password', async ({ loginPage, page }) => {
    await loginPage.signIn(TRADER.email, TRADER.password);
    await expect(page).toHaveURL(/\/watchlist$/);
  });

  test('shows an error for a wrong password', async ({ loginPage }) => {
    await loginPage.signIn(TRADER.email, 'not-the-password');
    await expect(loginPage.errorMessage).toHaveText('Email or password is incorrect.');
  });

  test('blocks a locked account', { annotation: { type: 'issue', description: 'TRD-218' } }, async ({ loginPage }) => {
    await loginPage.signIn(LOCKED_TRADER.email, LOCKED_TRADER.password);
    await expect(loginPage.errorMessage).toContainText('Your account is locked');
  });

  // FIXME: TRD-301 the one-time code screen is behind a feature flag on staging
  test.fixme('asks for a one-time code on a new device', async ({ loginPage, context }) => {
    await context.clearCookies();
    await loginPage.signIn(TRADER.email, TRADER.password);
    await expect(loginPage.oneTimeCodeInput).toBeVisible();
  });
});
