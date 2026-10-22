// Every Playwright form the scanner reads, written as one order-entry suite. Not meant to run.
import { test, expect, mergeTests } from '@playwright/test';
import { test as auditTest } from '@playwright/test';
import { TAGS } from './tags';
import { WATCHED_SYMBOLS } from './symbols';

const tradingTest = test.extend<{ account: string }>({ account: 'paper' });
const auditedTrading = mergeTests(tradingTest, auditTest);

test.describe.configure({ mode: 'parallel' });

test.describe('order ticket', { tag: '@orders' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/trade/AAPL');
  });

  test('opens from the watchlist @smoke', async ({ page }) => {
    await expect(page.getByRole('dialog', { name: 'Order ticket' })).toBeVisible();
  });

  test.only('keeps the last order type', async () => {});

  // SKIP: TRD-120 quantity memory moved to user settings
  test.skip('remembers the last quantity', async () => {});

  test.fixme('shows the fee estimate', async () => {});

  test.fail('rounds the fee down', { annotation: { type: 'issue', description: 'TRD-455' } }, async () => {});

  test.fail.only('shows the margin impact', async () => {});

  test('closes on escape', { lock: 'order-ticket' }, async () => {});

  test('uses the account currency', { tag: TAGS.currency }, async () => {});
});

test.describe.serial('order lifecycle', () => {
  test('places the order', async () => {});
  test('cancels the order', async () => {});
});

test.describe.fixme('options chain', () => {
  test('lists the expiries', async () => {});
});

test.describe(() => {
  test('signs out after 15 minutes idle', async () => {});
});

test.describe('market hours', () => {
  test.skip(({ browserName }) => browserName === 'webkit', 'Clock mocking is unreliable on WebKit');

  test('shows the pre-market badge', async () => {});
});

test.describe('steps', () => {
  test('confirms an order in steps', async () => {
    await test.step('fills the ticket', async () => {});
    await test.step.skip('signs the order', async () => {});
    test.info().annotations.push({ type: 'audit', description: 'step-by-step confirmation' });
  });

  test('stops when the broker is down', async () => {
    test.abort('broker is down');
  });

  test('retries a rejected order', async ({ browserName }) => {
    if (process.env.BROKER === 'paper') {
      test.skip(browserName === 'firefox', 'The paper broker rejects Firefox sessions');
    }
    test('is not collected', async () => {});
  });
});

tradingTest('uses the paper account', async ({ account }) => {
  expect(account).toBe('paper');
});

auditedTrading.describe('audited trades', () => {
  auditedTrading('logs every order', async () => {});
});

test.describe('quotes', () => {
  for (const symbol of WATCHED_SYMBOLS) {
    test(`shows a quote for ${symbol}`, async () => {});
  }
});

if (process.env.LIVE_BROKER) {
  test('sends a live order', async () => {});
}

test.describe('market data', async () => {
  await Promise.resolve();
  test('loads candles', async () => {});
});

test.describe('account settings', () => {
  test.describe.configure({ lock: 'user-settings' });

  test('changes the base currency', async () => {});
});

const brokerTest = (broker: string) => (broker === 'live' ? test : tradingTest);

test.describe('quote feed', () => {
  brokerTest('live')('routes a live order', async () => {});

  test('streams quotes over IPv6', async ({ page }) => {
    try {
      await page.goto('http://[::1]:4173/quotes');
    } catch {
      test.skip(true, 'No IPv6 on this machine');
    }
  });
});

test.describe('order book depth', () => {
  test.describe.configure({ retries: 1, timeout: 60_000 });
  test.slow(({ browserName }) => browserName === 'webkit', 'The depth chart renders slowly on WebKit');

  test.beforeEach(async () => {
    test.setTimeout(90_000);
  });

  test('shows ten price levels', async () => {});

  test('streams level updates', async () => {
    test.setTimeout(120_000);
  });
});

test('places a bracket order', async ({ orderTicket }) => {
  await test.step('enter the entry order', async () => {
    await test.step('pick the symbol', async () => {});
  });
  await test.step.skip('attach a note', async () => {});
  expect.soft(orderTicket).toBeTruthy();
});
