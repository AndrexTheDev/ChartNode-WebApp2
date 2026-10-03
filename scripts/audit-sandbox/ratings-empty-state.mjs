// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * Exercise the ratings matrix's true empty state against an uncached symbol/feed.
 *
 * The chart is first seeded from the normal deterministic fixture. The test
 * then selects Bybit (whose browser REST endpoint is CORS-blind) and injects a
 * 503 for every Gate fallback candle request before opening Ratings. This
 * avoids reusing the active chart's Binance candles or a previously cached
 * ratings matrix, and proves the explicit no-data copy is rendered.
 *
 * Run against a built app on :3000: node scripts/audit-sandbox/ratings-empty-state.mjs
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { installFixtures } from './fixtures.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
let failureMode = 'none';
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => {
    throw error;
  });

  const fixtures = await installFixtures(page, {
    route: ({ url, venue }) => {
      if (venue === 'gate' && /spot\/candlesticks/.test(url)) {
        const timeframe = new URL(url).searchParams.get('interval');
        if (failureMode === 'all' || (failureMode === 'partial' && timeframe !== '1h')) {
          return { status: 503, body: { error: 'fixture: deliberately unavailable candle history' } };
        }
      }
      return null;
    },
  });

  await page.goto(`${BASE}/de/terminal?qa=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('canvas', { timeout: 30_000 });

  // Select Bybit through the real picker. Ratings intentionally use Gate as
  // the CORS-safe fallback, so the targeted fault cannot hit Binance's live
  // chart seed or accidentally leave one cached timeframe row behind.
  await page.click('button[aria-label="Datenquelle"]');
  await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 5_000 });
  const selectedBybit = await page.evaluate(() => {
    const option = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find((item) =>
      /bybit/i.test(item.textContent ?? ''),
    );
    option?.querySelector('button')?.click();
    return Boolean(option);
  });
  assert.equal(selectedBybit, true, 'Bybit should be present in the exchange picker');
  await page.waitForFunction(
    () => /bybit/i.test(document.querySelector('button[aria-label="Datenquelle"]')?.innerText ?? ''),
    { timeout: 10_000 },
  );

  failureMode = 'all';
  await page.click('[data-menu-trigger="analyse"]');
  await page.waitForSelector('[role="menuitem"]', { timeout: 5_000 });
  const openedRatings = await page.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((entry) =>
      /^rating$/i.test((entry.textContent ?? '').trim()),
    );
    item?.click();
    return Boolean(item);
  });
  assert.equal(openedRatings, true, 'Ratings should be available in the Analyse menu');
  await page.waitForSelector('[role="dialog"]', { timeout: 10_000 });
  await page.waitForFunction(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
    return dialog?.textContent?.includes('Für diese Börse sind nicht genügend Kerzen verfügbar');
  }, { timeout: 30_000, polling: 250 });

  const result = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
    return {
      rows: dialog?.querySelectorAll('tbody tr').length ?? 0,
      noData: dialog?.textContent?.includes('Für diese Börse sind nicht genügend Kerzen verfügbar') ?? false,
      partial: dialog?.textContent?.includes('Daten verfügbar für') ?? false,
    };
  });
  assert.deepEqual(result, { rows: 0, noData: true, partial: false });
  assert.ok(fixtures.injected >= 6, `Expected all six Gate timeframe requests to fail; got ${fixtures.injected}`);
  console.log(`PASS ratings empty state — ${JSON.stringify(result)}, injected=${fixtures.injected}`);

  await page.evaluate(() => {
    const close = [...(document.querySelector('[role="dialog"]')?.querySelectorAll('button') ?? [])].find((button) =>
      /schließen/i.test(button.textContent ?? ''),
    );
    close?.click();
  });
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 5_000 });

  // One available timeframe must not look like a complete six-timeframe matrix.
  // The 1h fallback succeeds while the other five Gate requests still fail.
  failureMode = 'partial';
  await page.click('[data-menu-trigger="analyse"]');
  await page.waitForSelector('[role="menuitem"]', { timeout: 5_000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="menuitem"]')]
      .find((entry) => /^rating$/i.test((entry.textContent ?? '').trim()))
      ?.click();
  });
  await page.waitForFunction(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
    return dialog?.querySelectorAll('tbody tr').length === 1 &&
      dialog.textContent?.includes('Daten verfügbar für 1 von 6 Zeitrahmen');
  }, { timeout: 30_000, polling: 250 });

  const partialResult = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
    return {
      rows: dialog?.querySelectorAll('tbody tr').length ?? 0,
      disclosure: [...(dialog?.querySelectorAll('p') ?? [])]
        .map((paragraph) => paragraph.textContent?.trim() ?? '')
        .find((text) => text.startsWith('Daten verfügbar für')) ?? null,
    };
  });
  assert.equal(partialResult.rows, 1);
  assert.ok(partialResult.disclosure?.includes('1 von 6 Zeitrahmen'));
  console.log(`PASS ratings partial coverage — ${JSON.stringify(partialResult)}`);
} finally {
  await browser.close();
}
