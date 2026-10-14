import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// One new business going through the self-serve journey: sign up, trial,
// onboarding checklist, billing and WhatsApp (coming soon), and the new
// pages loading without an error.

const id = Date.now().toString(36);
const email = `e2e-${id}@example.com`;
const password = 'e2e-password-123';

// One browser session for the whole journey: sign-in is rate limited
// (10 a minute per IP), so the tests share the signed-in context instead
// of each logging in again.
let context: BrowserContext;
let page: Page;

test.describe.serial('self-serve SaaS smoke', () => {
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('sign up lands on home with the getting-started checklist', async () => {
    await page.goto('/register');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('you@company.com').fill(email);
    const inputs = page.locator('input');
    await inputs.nth(0).fill(`E2E Toko ${id}`);
    await page.locator('input[type="password"]').nth(0).fill(password);
    await page.locator('input[type="password"]').nth(1).fill(password);
    await page.getByRole('button', { name: /create/i }).click();

    await expect(page).toHaveURL(/\/home/);
    await expect(page.getByText('Get started with WareSys')).toBeVisible();
    await expect(page.getByText('Add your business details')).toBeVisible();
  });

  // Online payment and WhatsApp are switched off by default
  // (ONLINE_PAYMENTS_ENABLED / WHATSAPP_ENABLED): prices show, nothing buys.
  test('billing shows the trial and the prices, with payment coming soon', async () => {
    await page.goto('/settings/billing');
    await expect(page.getByText('Free trial').first()).toBeVisible();
    await expect(page.getByText(/Online payment is coming soon/)).toBeVisible();
    await expect(page.getByText(/Rp\s*3\.000\.000/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay now' })).toHaveCount(0);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  });

  test('WhatsApp shows the balance and packages, with top-up coming soon', async () => {
    await page.goto('/settings/whatsapp');
    await expect(page.getByText('Balance').first()).toBeVisible();
    await expect(page.getByText(/Sending through WhatsApp is coming soon/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Rp\s*50\.000/ })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: /WhatsApp/ })).toBeDisabled();
  });

  for (const path of [
    '/approvals',
    '/purchasing/reorder',
    '/purchasing/returns',
    '/purchasing/bills',
    '/inventory/transfers',
    '/inventory/batches',
    '/settings/security',
    '/settings/integrations',
    '/admin/products',
  ]) {
    test(`${path} renders`, async () => {
      const errors: string[] = [];
      const onError = (e: Error) => errors.push(e.message);
      page.on('pageerror', onError);
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
      await expect(page.getByText(/could not load|request failed|could not reach/i)).toHaveCount(0);
      page.off('pageerror', onError);
      expect(errors).toEqual([]);
    });
  }

  test('signing in again works', async () => {
    // Leave the app first: an open page would itself redirect to /login
    // the moment the session goes, racing this navigation.
    await page.goto('about:blank');
    await context.clearCookies();
    await page.goto('/login');
    // Fill only once the page is interactive: typing before hydration is lost.
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('you@company.com').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/home/);
  });
});
