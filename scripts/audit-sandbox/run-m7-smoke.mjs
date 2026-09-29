// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// M7-Smoke: prüft die drei Funktionspfade, die der Lazy-Umbau berührt hat.
//
//  1. Kopfzeilen-Suche auf der Landingpage: Engine (api/search + cex-universe)
//     lädt erst beim Tippen, Treffer erscheinen, Enter navigiert ins Terminal.
//  2. Teilen-Dialog: Support-/Share-Dialog hängen hinter LazyGate + dynamic.
//  3. Support-Dialog (Spenden-Wall) aus der Terminal-Werkzeugleiste.
//
// Nutzung: node scripts/audit-sandbox/run-m7-smoke.mjs   (Server auf :3000)
import { launch, wait, BASE, shot } from './lib.mjs';
const browser = await launch();
let ok = 0, bad = 0;
const check = (name, cond, detail) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ── 1) Smart-Search nach dem Lazy-Umbau ────────────────────────────────── */
{
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/de`, { waitUntil: 'load' });
  await wait(800);
  const input = await page.$('header input[type="search"], header input');
  check('Suchfeld im Header vorhanden', !!input);
  if (input) {
    await input.click();
    await input.type('btc', { delay: 60 });
    await wait(2500);
    const panel = await page.evaluate(() => ({
      hits: document.querySelectorAll('[role="option"], [data-search-hit]').length,
      list: [...document.querySelectorAll('button')].filter((b) => /BTC/i.test(b.textContent ?? '')).length,
    }));
    check('Suchtreffer erscheinen (Engine lazy geladen)', panel.hits + panel.list > 0, `${panel.hits} Optionen / ${panel.list} BTC-Buttons`);
    await shot(page, 'm7-smartsearch');
    await page.keyboard.press('Enter');
    await wait(2500);
    const url = page.url();
    check('Auswahl navigiert ins Terminal', url.includes('/terminal'), url.replace(BASE, ''));
    const chart = await page.evaluate(() => document.body.innerText.match(/BTC\s*\/\s*USDT/)?.[0] ?? '—');
    check('Terminal zeigt den gewählten Markt', /BTC/.test(chart), chart);
  }
  await ctx.close();
}

/* ── 2) Teilen-Dialog (jetzt lazy) ─────────────────────────────────────── */
{
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load' });
  await wait(3500);
  const flow = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const trigger = document.querySelector('[data-menu-trigger="more"]');
    if (!trigger) return { error: 'kein "more"-Trigger' };
    trigger.click();
    const deadline = performance.now() + 3000;
    let item = null;
    while (!(item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => /teilen|share/i.test(b.textContent ?? ''))) && performance.now() < deadline) await sleep(25);
    if (!item) return { error: 'kein Teilen-Eintrag' };
    item.click();
    const ddl = performance.now() + 3000;
    while (!document.querySelector('[role="dialog"]') && performance.now() < ddl) await sleep(25);
    return { dialog: !!document.querySelector('[role="dialog"]') };
  });
  check('Teilen-Dialog öffnet (lazy Chunk)', flow.dialog === true, JSON.stringify(flow));
  if (flow.dialog) await shot(page, 'm7-share-dialog');
  await ctx.close();
}

/* ── 3) Spenden-/Support-Dialog (jetzt lazy) ───────────────────────────── */
{
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load' });
  await wait(3500);
  const flow = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const btns = [...document.querySelectorAll('button')];
    const support = btns.find((b) => /support|unterstütz|trinkgeld|tip/i.test((b.getAttribute('aria-label') ?? '') + ' ' + (b.textContent ?? '')));
    if (!support) return { error: 'kein Support-Button', sample: btns.map((b) => (b.textContent ?? '').trim().slice(0, 18)).filter(Boolean).slice(0, 14) };
    support.click();
    const ddl = performance.now() + 3000;
    while (!document.querySelector('[role="dialog"]') && performance.now() < ddl) await sleep(25);
    return { dialog: !!document.querySelector('[role="dialog"]') };
  });
  check('Support-Dialog öffnet (lazy Chunk)', flow.dialog === true, JSON.stringify(flow));
  if (flow.dialog) await shot(page, 'm7-support-dialog');
  await ctx.close();
}
console.log(`\nErgebnis: ${ok} ok / ${bad} Befund(e)`);
await browser.close();
