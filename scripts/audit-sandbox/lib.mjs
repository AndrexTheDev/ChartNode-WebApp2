// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// Sandbox-Harness: Browser-Start, Instrumentierung, Messhelfer.
// Chromium kommt aus @sparticuz/chromium + AL2023-Libs (siehe bootstrap.mjs).
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

export const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
export const LOCALES = ['de', 'en', 'es', 'ru', 'zh'];
export const SHOTS = process.env.SHOTS_DIR || '/tmp/nc-shots';
mkdirSync(SHOTS, { recursive: true });

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(opts = {}) {
  return puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || '/tmp/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--font-render-hinting=none',
      ...(opts.args ?? []),
    ],
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib', FONTCONFIG_PATH: '/tmp/fonts' },
    protocolTimeout: 180000,
    defaultViewport: { width: 1440, height: 900 },
  });
}

export function instrument(page) {
  const log = { console: [], pageerror: [], failed: [], responses: [] };
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') log.console.push({ type: t, text: m.text() });
  });
  page.on('pageerror', (e) => log.pageerror.push(String(e.message ?? e)));
  page.on('requestfailed', (r) => log.failed.push({ url: r.url(), err: r.failure()?.errorText ?? '?' }));
  page.on('response', (r) => {
    if (r.status() >= 400) log.responses.push({ url: r.url(), status: r.status(), fromSandbox: r.headers()['x-nc-fixture'] === '1' });
  });
  return log;
}

const EXTERNAL = /^https?:\/\/(?!localhost|127\.0\.0\.1)/;
const NETNOISE = /ERR_(NAME_NOT_RESOLVED|CONNECTION|NETWORK|INTERNET|TIMED_OUT|CERT|ADDRESS)|WebSocket connection|SwiftShader|GroupMarkerNotSet/i;

export function classify(log) {
  return {
    appErrors: log.console.filter((c) => c.type === 'error' && !NETNOISE.test(c.text)),
    appWarnings: log.console.filter((c) => c.type === 'warning' && !NETNOISE.test(c.text)),
    pageErrors: log.pageerror.filter((e) => !NETNOISE.test(e)),
    failedExternal: log.failed.filter((f) => EXTERNAL.test(f.url)),
    failedInternal: log.failed.filter((f) => !EXTERNAL.test(f.url)),
    badResponses: log.responses.filter((r) => !EXTERNAL.test(r.url) && !r.fromSandbox && r.status !== 304),
  };
}

export async function shot(page, name) {
  const file = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: file });
  return file;
}

/** Menü öffnen (`data-menu-trigger`) und Eintrag per Text anklicken. */
export async function clickMenuItem(page, menu, label) {
  const opened = await page.evaluate((id) => {
    const t = document.querySelector(`[data-menu-trigger="${id}"]`);
    if (!t) return false;
    t.click();
    return true;
  }, menu);
  if (!opened) return null;
  await wait(350);
  return page.evaluate((text) => {
    const panel = document.querySelector('[role="menu"]');
    if (!panel) return null;
    const item = [...panel.querySelectorAll('button, [role="menuitem"]')].find((b) =>
      (b.textContent ?? '').trim().toLowerCase().includes(text.toLowerCase()),
    );
    if (!item) return null;
    item.click();
    return (item.textContent ?? '').trim().slice(0, 40);
  }, label);
}
