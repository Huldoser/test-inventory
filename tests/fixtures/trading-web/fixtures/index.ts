import { test as base, type Page } from '@playwright/test';
import { signedInPage } from './auth';
import { AlertsPage } from '../pages/alerts-page';
import { BacktestPage } from '../pages/backtest-page';
import { LoginPage } from '../pages/login-page';
import { OrderTicket } from '../pages/order-ticket';
import { OrdersBlotter } from '../pages/orders-blotter';
import { PortfolioPage } from '../pages/portfolio-page';
import { WatchlistPage } from '../pages/watchlist-page';

interface TradingFixtures {
  signedInPage: Page;
  loginPage: LoginPage;
  watchlistPage: WatchlistPage;
  orderTicket: OrderTicket;
  blotter: OrdersBlotter;
  portfolioPage: PortfolioPage;
  alertsPage: AlertsPage;
  backtestPage: BacktestPage;
}

export const test = base.extend<TradingFixtures>({
  signedInPage,
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  watchlistPage: async ({ signedInPage }, use) => {
    await use(new WatchlistPage(signedInPage));
  },
  orderTicket: async ({ signedInPage }, use) => {
    await use(new OrderTicket(signedInPage));
  },
  blotter: async ({ signedInPage }, use) => {
    await use(new OrdersBlotter(signedInPage));
  },
  portfolioPage: async ({ signedInPage }, use) => {
    await use(new PortfolioPage(signedInPage));
  },
  alertsPage: async ({ signedInPage }, use) => {
    await use(new AlertsPage(signedInPage));
  },
  backtestPage: async ({ signedInPage }, use) => {
    await use(new BacktestPage(signedInPage));
  },
});

export { expect } from '@playwright/test';
