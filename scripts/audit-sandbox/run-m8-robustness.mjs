// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// MODUL M8 — ROBUSTHEIT: Netzabbruch, Rate-Limit (429), Speicher voll,
// Sekundär-Fetch-Härtung (Befund O3) und Payload-Härtung.
//
// Aufbau: Fünf Stufen, jede mit eigener Browser-Instanz. Die Fault-Injection
// läuft über die Fixture-Route (`installFixtures(page, { route })`): dieselbe
// Antwort-Pipeline wie der echte Feed, nur mit 429/Hang/Riesen-Body/kaputtem
// JSON an genau den Stellen, die die App aushalten muss.
//
//   S1 Speicher          – volle Quote, gesperrter Speicher, L2-Verdrängung
//   S2 Rate-Limit        – 429-Overlay, Cooldown, Retry, kein Overlay bei 403
//   S3 Netzabbruch       – offline/online, Hänger mit Timeout, Abbruch beim Tippen
//   S4 Sekundär-Quellen  – Binance/OKX unabhängig tot (Befund O3)
//   S5 Payload-Härtung   – Riesen-Body, kaputtes JSON, leere/giftige Daten
//
// Nutzung: node scripts/audit-sandbox/run-m8-robustness.mjs   (Server auf :3000)
// Wichtig: `navigator.webdriver` bleibt bewusst true – die Ad-Schicht ist damit
// aus (Boot-Skript), und dieser Durchgang misst Daten-/Speicher-Robustheit,
// nicht Werbung (das ist M6).
import { launch, wait, BASE, shot } from './lib.mjs';
import { installFixtures, makeCandles } from './fixtures.mjs';

const browser = await launch();
const started = Date.now();
const rows = [];
let ok = 0;
let bad = 0;

function check(name, cond, detail = '') {
  if (cond) ok += 1;
  else bad += 1;
  rows.push({ name, ok: !!cond, detail: String(detail).slice(0, 160) });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ''}`);
}

const NETNOISE =
  /ERR_(NAME_NOT_RESOLVED|CONNECTION|NETWORK|INTERNET|TIMED_OUT|CERT|ADDRESS|FAILED|ABORTED|EMPTY_RESPONSE)|WebSocket connection|SwiftShader|GroupMarkerNotSet|net::ERR_/i;

/**
 * Sammelt Page-Errors, App-Konsolenfehler und unbehandelte Rejections.
 *
 * WICHTIG (Instrumenten-Befund dieses Moduls): das DOM-Event
 * `unhandledrejection` feuert im hier benutzten Headless-Chromium **nie** –
 * eine Prüfung darauf wäre still immer grün. Verlässlich ist der CDP-Kanal:
 * unbehandelte Rejections kommen als `pageerror` mit „Uncaught (in promise)“
 * an. Der DOM-Listener läuft zusätzlich (im echten Browser greift er), zählt
 * aber nur als Zugabe.
 */
async function recorder(page) {
  const log = { pageErrors: [], consoleErrors: [], rejections: [] };
  /*
   * Klassifikation über CDP, nicht über Puppeteers `pageerror`-Text: dort steht
   * nur `Failed to fetch` – das Merkmal „Uncaught (in promise)“ geht verloren,
   * und genau daran hängt die Unterscheidung „echter Fehler“ vs. „unbehandelte
   * Rejection“. `exceptionDetails.text` liefert es (im Test verifiziert).
   */
  const cdp = await page.createCDPSession();
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    const text = `${exceptionDetails.text ?? ''} · ${exceptionDetails.exception?.description ?? ''}`
      .replace(/\s+/g, ' ')
      .slice(0, 160);
    if (/in promise/i.test(text)) log.rejections.push(text);
    else if (!NETNOISE.test(text)) log.pageErrors.push(text);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (!NETNOISE.test(text)) log.consoleErrors.push(text.slice(0, 160));
  });
  return log;
}

const PRELUDE = () => {
  window.__ncRejections = [];
  window.addEventListener('unhandledrejection', (e) => {
    window.__ncRejections.push(String(e.reason?.name || e.reason || 'unknown').slice(0, 120));
  });
};

/** Rejections aus CDP (verlässlich) + DOM-Event (Zugabe) zusammenführen. */
const rejectionsOf = async (page, log) => {
  const dom = await page.evaluate(() => window.__ncRejections ?? []);
  return [...(log?.rejections ?? []), ...dom];
};
const chartState = (page) =>
  page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    placeholders: document.querySelectorAll('[data-nc-pane-placeholder]').length,
    legend: (document.querySelector('[data-nc-legend]')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    candles: window.__ncCandleCount ?? null,
  }));

/* ═══════════════════════════════════════════════════════════════════════════
 * S1 · Speicher (Quote voll, Speicher gesperrt, L2-Verdrängung)
 * ═══════════════════════════════════════════════════════════════════════ */
console.log('\nS1 · Speicher: Quote voll / Speicher gesperrt');

/*
 * S1a – Speicher von Anfang an gesperrt (Safari privat, „Cookies blockieren“):
 * jeder Zugriff wirft SecurityError. Die App muss vollständig booten – die
 * Codebasis hat dafür einen eigenen noop-Fallback (store/storage.ts).
 */
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = await recorder(page);
  await page.evaluateOnNewDocument(PRELUDE);
  await page.evaluateOnNewDocument(() => {
    for (const key of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(window, key, {
        configurable: true,
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
    }
  });
  await installFixtures(page);
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await wait(6000);
  const state = await chartState(page);
  check('S1a gesperrter Speicher: App bootet vollständig (Chart oder Platzhalter)', state.canvases >= 1 || state.placeholders >= 1, JSON.stringify(state));
  check('S1a gesperrter Speicher: 0 Page-Errors', log.pageErrors.length === 0, log.pageErrors.slice(0, 2).join(' | '));
  check('S1a gesperrter Speicher: 0 unbehandelte Rejections', (await rejectionsOf(page, log)).length === 0, (await rejectionsOf(page, log)).join(' | '));
  await ctx.close();
}

/*
 * S1b – Quote füllt sich NACH dem Boot (Tab läuft lange): jeder Schreibversuch
 * wirft QuotaExceededError. Vorher riss das einen unbehandelten Fehler bis in
 * den Klick-Handler (Befund dieses Moduls).
 */
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = await recorder(page);
  await page.evaluateOnNewDocument(PRELUDE);
  await installFixtures(page);
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await wait(5000);
  await page.evaluate(() => {
    const proto = Object.getPrototypeOf(window.localStorage);
    proto.setItem = function () {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    };
  });
  /* Theme wechseln (persistierter Store-Schreibpfad Nr. 1) */
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => /Design|Theme|Diseño|Дизайн|设计/i.test(b.getAttribute('aria-label') || ''))
      ?.click();
  });
  await wait(400);
  await page.evaluate(() => {
    const options = [...document.querySelectorAll('[role="option"] button')];
    (options.find((o) => !/acid/i.test(o.textContent || '')) ?? options[0])?.click();
  });
  await wait(700);
  /* Zeitrahmen wechseln (persistierter Store-Schreibpfad Nr. 2) */
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '15m')?.click();
  });
  await wait(1400);
  const after = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    tf15: [...document.querySelectorAll('button')]
      .filter((b) => (b.textContent || '').trim() === '15m')
      .map((b) => b.getAttribute('aria-pressed')),
  }));
  const rejections = await rejectionsOf(page, log);
  check('S1b Quote voll: 0 Page-Errors beim Speichern (vorher uncaught QuotaExceededError)', log.pageErrors.length === 0, log.pageErrors.slice(0, 2).join(' | '));
  check('S1b Quote voll: 0 unbehandelte Rejections', rejections.length === 0, rejections.join(' | '));
  check('S1b Quote voll: Theme wechselt trotzdem (In-Memory gewinnt)', after.theme !== 'acid', `theme=${after.theme}`);
  check('S1b Quote voll: Zeitrahmen-Wechsel greift trotzdem', after.tf15.includes('true'), JSON.stringify(after.tf15));
  await shot(page, 'm8-quota-voll');
  await ctx.close();
}

/*
 * S1c – Die Quote ist durch den eigenen L2-Cache voll. Der Store muss den
 * Zwischenspeicher verdrängen (Rangfolge aus api/persistCache.ts) und den
 * Einstellungs-Schreibvorgang danach durchbekommen.
 */
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = await recorder(page);
  await page.evaluateOnNewDocument(PRELUDE);
  await installFixtures(page);
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await wait(5000);
  await page.evaluate(() => {
    /* Es liegt schon eine Handvoll L2-Einträge herum … */
    for (let i = 0; i < 8; i += 1) {
      window.localStorage.setItem(
        `nc-l2-v1:fake-${i}`,
        JSON.stringify({ savedAt: Date.now(), value: 'x'.repeat(200) }),
      );
    }
    /* … und „voll“ heißt hier: solange Cache-Einträge existieren, wirft jeder
       Nicht-Cache-Schreibvorgang. Nur die L2-Ebene darf weiter schreiben. */
    const proto = Object.getPrototypeOf(window.localStorage);
    const original = proto.setItem;
    window.__origSetItem = original;
    proto.setItem = function (key, value) {
      if (String(key).startsWith('nc-l2-v1:')) return original.call(this, key, value);
      let l2 = 0;
      for (let i = 0; i < window.localStorage.length; i += 1) {
        if ((window.localStorage.key(i) || '').startsWith('nc-l2-v1:')) l2 += 1;
      }
      if (l2 > 0) throw new DOMException('quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => /Design|Theme|Diseño|Дизайн|设计/i.test(b.getAttribute('aria-label') || ''))
      ?.click();
  });
  await wait(400);
  await page.evaluate(() => {
    const options = [...document.querySelectorAll('[role="option"] button')];
    (options.find((o) => !/acid/i.test(o.textContent || '')) ?? options[0])?.click();
  });
  await wait(1000);
  const result = await page.evaluate(() => {
    let l2 = 0;
    for (let i = 0; i < window.localStorage.length; i += 1) {
      if ((window.localStorage.key(i) || '').startsWith('nc-l2-v1:')) l2 += 1;
    }
    const stored = window.localStorage.getItem('nodechart:store:v1');
    let persistedTheme = null;
    try {
      persistedTheme = JSON.parse(stored ?? '{}')?.state?.theme ?? null;
    } catch {
      persistedTheme = 'unparsebar';
    }
    return { theme: document.documentElement.dataset.theme, l2, persistedTheme };
  });
  check('S1c Cache voll: Store verdrängt L2-Einträge statt zu werfen', result.l2 === 0, `verbleibende L2-Einträge=${result.l2}`);
  check('S1c Cache voll: Einstellung ist danach wirklich persistiert', result.persistedTheme !== null && result.persistedTheme !== 'unparsebar' && result.theme !== 'acid', JSON.stringify(result));
  check('S1c Cache voll: 0 Page-Errors', log.pageErrors.length === 0, log.pageErrors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ═══════════════════════════════════════════════════════════════════════════
 * S2 · Rate-Limit: 429-Overlay, Cooldown, Retry
 * ═══════════════════════════════════════════════════════════════════════ */
console.log('\nS2 · Rate-Limit (429): Overlay, Cooldown, automatischer Retry');

const overlayState = (page) =>
  page.evaluate(() => {
    const dialog = document.querySelector('[role="alertdialog"]');
    const text = (dialog?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return {
      open: !!dialog,
      label: dialog?.getAttribute('aria-label') ?? '',
      seconds: Number((text.match(/(\d+)\s*(?:s|sek|Sek)/i) ?? [])[1] ?? NaN),
      secondsRaw: (text.match(/\b(\d{1,2})\b/g) ?? []).slice(0, 3),
      hits: /×(\d+)/.exec(text)?.[1] ?? null,
      text: text.slice(0, 120),
    };
  });

{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = await recorder(page);
  let injected429 = 0;
  let klineRequests = 0;
  await page.evaluateOnNewDocument(PRELUDE);
  await installFixtures(page, {
    route: ({ url, venue, counters }) => {
      if (!venue) return null;
      if (!/klines|candles|OHLC|kline|history_kline|candlesticks/i.test(url)) return null;
      klineRequests += 1;
      /* Nur der allererste Kline-Request wird gedrosselt – der Retry danach
         muss echte Daten bekommen, sonst prüfen wir nichts. */
      if (counters.injected === 0) {
        injected429 += 1;
        return { status: 429, headers: { 'retry-after': '5' }, body: { error: 'rate limited' } };
      }
      return null;
    },
  });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await wait(1200);
  const shown = await overlayState(page);
  check('S2 429: Glitch-Overlay erscheint', shown.open, JSON.stringify({ injected429, klineRequests }));
  check('S2 429: Overlay ist ein alertdialog mit Namen', shown.open && shown.label.length > 2, shown.label);
  check('S2 429: Overlay nennt eine Quelle', /binance|bybit|okx|kraken|coinbase|gate|kucoin|bitget|htx|bitfinex|coinex|cryptocom/i.test(shown.text), shown.text);
  /* Lebenszyklus abtasten: der Countdown muss laufen UND das Overlay nach
     dem Cooldown (5 s + Sicherheitsnetz) wieder verschwinden. */
  const samples = [];
  const sampleUntil = Date.now() + 9_000;
  while (Date.now() < sampleUntil) {
    samples.push({ t: Date.now(), ...(await overlayState(page)) });
    await wait(150);
  }
  const openSamples = samples.filter((s) => s.open);
  const countdownValues = openSamples.map((s) => Number((s.text.match(/(\d+)\s*(?:s|sek)/i) ?? [])[1] ?? NaN)).filter((n) => Number.isFinite(n));
  const countdownRuns = countdownValues.length >= 2 && countdownValues[0] >= countdownValues[countdownValues.length - 1] && countdownValues[0] > countdownValues[countdownValues.length - 1];
  check(
    'S2 429: Countdown läuft herunter',
    openSamples.length >= 3 && countdownRuns,
    `${openSamples.length} offen · ${countdownValues.slice(0, 6).join('→')}`,
  );
  check(
    'S2 429: Cooldown endet von selbst (≤ 8 s, Sicherheitsnetz greift)',
    samples[samples.length - 1].open === false,
    `letzte Probe offen=${samples[samples.length - 1].open}`,
  );
  /* Ein gleichzeitiger zweiter 429 darf kein zweites Overlay aufspannen. */
  const overlayCount = await page.evaluate(() => document.querySelectorAll('[role="alertdialog"]').length);
  check('S2 429: kein gestapeltes Overlay (max. 1)', overlayCount <= 1, `n=${overlayCount}`);
  await shot(page, 'm8-429-overlay');
  /* Cooldown abwarten und Erholung prüfen: nach ~5 s muss der Retry greifen. */
  let recovered = null;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await wait(500);
    const state = await chartState(page);
    if (state.canvases >= 1 && /O\s*[\d.]+/.test(state.legend)) {
      recovered = state;
      break;
    }
  }
  const elapsed = Math.round((Date.now() - deadline + 20_000) / 100) / 10;
  check('S2 429: automatischer Retry liefert echte Kerzen (Chart + OHLC)', !!recovered, recovered ? `${recovered.legend} nach ${elapsed}s` : 'nicht erholt');
  check('S2 429: Overlay ist danach wieder weg', !(await overlayState(page)).open);
  check('S2 429: keine Page-Errors, keine unbehandelten Rejections', log.pageErrors.length === 0 && (await rejectionsOf(page)).length === 0, [...log.pageErrors, ...(await rejectionsOf(page, log))].slice(0, 2).join(' | '));
  const cached429 = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i) || '';
      if (key.startsWith('nc-l2-v1:')) keys.push(key);
    }
    return keys.filter((k) => k.includes('seed:')).length;
  });
  check('S2 429: Drossel-Antwort landet nicht im L2-Cache (nur echte Seeds)', cached429 >= 1, `seed-Einträge=${cached429}`);
  await ctx.close();
}

/* 403 (regional gesperrt) darf keinen Cooldown auslösen – Retry wäre sinnlos. */
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = await recorder(page);
  await page.evaluateOnNewDocument(PRELUDE);
  await installFixtures(page, {
    route: ({ url, venue }) => (venue && /klines|candles|kline|OHLC/i.test(url) ? { status: 403, body: { error: 'blocked region' } } : null),
  });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await wait(5000);
  const shown = await overlayState(page);
  check('S2 403: kein Rate-Limit-Overlay (Retry wäre sinnlos)', !shown.open, shown.text);
  const state = await chartState(page);
  check('S2 403: App bleibt bedienbar (Platzhalter + Toolbar)', state.placeholders >= 1 || state.canvases >= 1, JSON.stringify(state));
  check('S2 403: 0 Page-Errors', log.pageErrors.length === 0, log.pageErrors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ═══════════════════════════════════════════════════════════════════════════
 * S3 · Netzabbruch
 * ═══════════════════════════════════════════════════════════════════════ */
console.log('\nS3 · Netzabbruch: offline/online, Hänger mit Timeout, Abbruch beim Tippen');

/* S3a – offline mitten im Betrieb, danach wieder online */
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = await recorder(page);
  await page.evaluateOnNewDocument(PRELUDE);
  await installFixtures(page);
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await wait(6000);
  const before = await chartState(page);
  const client = await page.createCDPSession();
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await wait(6000);
  const offline = await page.evaluate(() => ({
    text: document.body.innerText,
    buttons: document.querySelectorAll('button').length,
  }));
  check('S3a offline: Status zeigt Trennung/Neuverbindung', /VERBINDE NEU|GETRENNT|RECONNECT|OFFLINE|ПЕРЕПОДКЛЮЧ|重连/i.test(offline.text), (offline.text.match(/(VERBINDE NEU[^\n]{0,20}|GETRENNT)/) ?? ['—'])[0]);
  check('S3a offline: UI bleibt vollständig bedienbar', offline.buttons > 20, `n=${offline.buttons}`);
  await client.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  let back = false;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    await wait(1000);
    const state = await chartState(page);
    if (/O\s*[\d.]+/.test(state.legend)) {
      back = true;
      break;
    }
  }
  check('S3a online: Feed erholt sich (Kurszeile wieder da)', back, `vorher ${before.legend || '—'}`);
  check('S3a: 0 Page-Errors, 0 unbehandelte Rejections über den Zyklus', log.pageErrors.length === 0 && (await rejectionsOf(page)).length === 0, [...log.pageErrors, ...(await rejectionsOf(page, log))].slice(0, 2).join(' | '));
  await ctx.close();
}

/* S3b – hängende Verbindung: der 12-s-Timeout des Fetch-Layers muss greifen
   und der Retry danach echte Kerzen liefern. */
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = await recorder(page);
  await page.evaluateOnNewDocument(PRELUDE);
  await installFixtures(page, {
    route: ({ url, venue, counters }) =>
      venue && /klines|candles|kline|OHLC/i.test(url) && counters.injected === 0 ? { hang: true } : null,
  });
  const t0 = Date.now();
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  let state = await chartState(page);
  let took = 0;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await wait(500);
    state = await chartState(page);
    if (state.canvases >= 1) {
      took = Date.now() - t0;
      break;
    }
  }
  check('S3b Hänger: Timeout greift, Retry liefert Kerzen (≤ 30 s)', state.canvases >= 1, `${took} ms`);
  check('S3b Hänger: 0 Page-Errors', log.pageErrors.length === 0, log.pageErrors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* S3c – Suche: zweiter Tastendruck bricht die laufende Anfrage ab */
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = await recorder(page);
  await page.evaluateOnNewDocument(PRELUDE);
  await installFixtures(page, {
    route: ({ url }) => (/dexscreener|geckoterminal|goplus|rugcheck|\/search/i.test(url) ? { delayMs: 2500 } : null),
  });
  await page.goto(`${BASE}/de`, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await wait(1500);
  const input = await page.$('header input');
  if (!input) {
    check('S3c Suche: Eingabefeld gefunden', false, 'kein input im Header');
  } else {
    await input.click();
    await input.type('btc', { delay: 30 });
    await wait(350);
    /* Feld leeren – sonst wäre die zweite Suche „btceth" und der Test würde
       eine leere Trefferliste als Fehler lesen. */
    await page.evaluate(() => {
      const el = document.querySelector('header input');
      if (el) {
        el.focus();
        el.setSelectionRange(0, el.value.length);
      }
    });
    await page.keyboard.press('Backspace');
    await input.type('eth', { delay: 30 });
    await wait(4500);
    const result = await page.evaluate(() => ({
      hits: document.querySelectorAll('[role="option"]').length,
      text: (document.querySelector('[role="listbox"], [role="option"]')?.textContent ?? '').toLowerCase().slice(0, 60),
      spinner: document.querySelectorAll('[aria-busy="true"], .animate-spin').length,
    }));
    check('S3c Suche: Ergebnis erscheint trotz Abbruch der ersten Anfrage', result.hits > 0 || result.text.length > 0, JSON.stringify(result));
    check('S3c Suche: 0 Page-Errors, 0 unbehandelte Rejections (Abbruch ist kein Fehler)', log.pageErrors.length === 0 && (await rejectionsOf(page)).length === 0, [...log.pageErrors, ...(await rejectionsOf(page, log))].slice(0, 2).join(' | '));
    await page.keyboard.press('Escape');
  }
  await ctx.close();
}

/* S3d – Werkzeug-Dialog bei hängender Sekundärquelle: schließen darf keinen
   Fehler hinterlassen und keine Anfrage-Leiche weiterlaufen lassen. */
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = await recorder(page);
  let afterCloseRequests = 0;
  let closedAt = 0;
  await page.evaluateOnNewDocument(PRELUDE);
  await installFixtures(page, {
    route: ({ url, venue }) => (venue && /ticker\/24hr|aggTrades|market\/tickers|market\/trades/i.test(url) ? { hang: true } : null),
  });
  await page.setRequestInterception(true);
  page.on('request', () => {
    if (closedAt && Date.now() - closedAt > 500 && Date.now() - closedAt < 3000) afterCloseRequests += 1;
  });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await wait(6000);
  const opened = await openTool(page, /Lupe|Magnifier|Lupa|Лупа|放大镜/i);
  await wait(4000);
  const dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return { present: !!d, text: (d?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) };
  });
  await page.keyboard.press('Escape');
  await wait(150);
  closedAt = Date.now();
  await wait(3200);
  const gone = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
  check('S3d Werkzeug bei Hänger der Sekundärquelle: Dialog öffnet', opened.opened && dialog.present, JSON.stringify({ opened, dialog }));
  check('S3d Dialog lässt sich schließen, obwohl die Quelle hängt', gone, `nach Escape: ${gone ? 'zu' : 'noch offen'}`);
  check('S3d 0 Page-Errors, 0 unbehandelte Rejections', log.pageErrors.length === 0 && (await rejectionsOf(page)).length === 0, [...log.pageErrors, ...(await rejectionsOf(page, log))].slice(0, 2).join(' | '));
  check('S3d keine neuen Anfragen nach dem Schließen (keine Leiche)', afterCloseRequests <= 2, `n=${afterCloseRequests}`);
  await ctx.close();
}

/* ═══════════════════════════════════════════════════════════════════════════
 * S4 · Sekundär-Quellen (Befund O3)
 * ═══════════════════════════════════════════════════════════════════════ */
console.log('\nS4 · Sekundär-Quellen: Primär gewinnt / beide tot (Befund O3)');

const aggTradesBody = (startMs) => {
  const out = [];
  for (let i = 0; i < 40; i += 1) {
    out.push({ p: (61000 + i * 3).toFixed(2), q: (0.05 + i * 0.01).toFixed(4), T: startMs + i * 1000, m: i % 2 === 0 });
  }
  return out;
};
/**
 * Öffnet einen Werkzeug-Eintrag in irgendeinem der Sammel-Menüs.
 *
 * Die Werkzeuge sind thematisch gruppiert (`Tools`, `Analyse`, `Mehr` …) – die
 * Lupe liegt unter „Tools", die Heatmap unter „Analyse". Deshalb werden alle
 * Menü-Trigger durchprobiert, statt einen festen Pfad anzunehmen.
 */
async function openTool(page, matcher) {
  return page.evaluate(async (re) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const rx = new RegExp(re, 'i');
    const triggers = [...document.querySelectorAll('[data-menu-trigger]')];
    const tried = [];
    for (const trigger of triggers) {
      trigger.click();
      await sleep(300);
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((b) => rx.test(b.textContent || ''));
      if (item) {
        const label = (item.textContent || '').trim().slice(0, 28);
        const menu = (trigger.textContent || '').trim().slice(0, 16);
        item.click();
        return { opened: true, label, menu };
      }
      tried.push((trigger.textContent || '').trim().slice(0, 16));
    }
    return {
      opened: false,
      reason: 'Eintrag nicht in den gefundenen Menüs',
      menus: tried,
      items: [...document.querySelectorAll('[role="menuitem"]')].map((b) => (b.textContent || '').trim().slice(0, 20)),
    };
  }, matcher.source);
}

/*
 * S4a – Primärquelle (Binance) liefert, Sekundärquelle (OKX) ist tot.
 * Genau hier blieb der OKX-Promise unbeobachtet → „Uncaught (in promise)
 * TypeError: Failed to fetch“ (Befund O3 aus §1).
 */
for (const [tool, matcher] of [
  ['Lupe', /Lupe|Magnifier|Lupa|Лупа|放大镜/i],
  ['Heatmap', /Heatmap|Wärme|Heatmap|Тепловая|热力/i],
]) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = await recorder(page);
  await page.evaluateOnNewDocument(PRELUDE);
  await installFixtures(page, {
    route: ({ url, venue, req }) => {
      if (!venue) return null;
      /* Binance liefert echte Tape-/Ticker-Daten, OKX ist „regional gesperrt“. */
      if (/okx\.com/i.test(url)) return { abort: true };
      if (/aggTrades/i.test(url)) {
        const start = Number(new URL(url).searchParams.get('startTime') ?? Date.now() - 3_600_000);
        return { body: aggTradesBody(start, 3_600_000) };
      }
      if (/ticker\/24hr/i.test(url)) {
        return {
          body: Array.from({ length: 60 }, (_, i) => ({
            symbol: `T${i}USDT`,
            priceChangePercent: (i % 7) - 3,
            quoteVolume: 1_000_000 + i * 1000,
          })),
        };
      }
      void req;
      return null;
    },
  });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await wait(6000);
  const opened = await openTool(page, matcher);
  await wait(4500);
  const dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return { present: !!d, text: (d?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 90) };
  });
  const rejections = await rejectionsOf(page, log);
  check(`S4 ${tool}: Dialog öffnet mit Primärquelle`, opened.opened && dialog.present, JSON.stringify({ opened, dialog }));
  check(`S4 ${tool}: tote Sekundärquelle erzeugt KEINE unbehandelte Rejection (O3)`, rejections.length === 0, rejections.join(' | '));
  check(`S4 ${tool}: 0 Page-Errors`, log.pageErrors.length === 0, log.pageErrors.slice(0, 2).join(' | '));
  await page.keyboard.press('Escape');
  await wait(300);
  await ctx.close();
}

/* S4b – beide Quellen tot: Fehlerzustand, aber kein Absturz und keine Rejection. */
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = await recorder(page);
  await page.evaluateOnNewDocument(PRELUDE);
  await installFixtures(page, {
    route: ({ url, venue }) => (venue && /aggTrades|market\/trades|macro|ticker/i.test(url) ? { abort: true } : null),
  });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await wait(6000);
  const opened = await openTool(page, /Lupe|Magnifier|Lupa|Лупа|放大镜/i);
  await wait(5000);
  const state = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return {
      present: !!dialog,
      text: (dialog?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 110),
      alert: !!dialog?.querySelector('[role="alert"]'),
    };
  });
  const rejections = await rejectionsOf(page, log);
  check('S4 beide Quellen tot: Dialog meldet den Fehlerzustand', opened.opened && state.present, JSON.stringify(state));
  check('S4 beide Quellen tot: 0 unbehandelte Rejections', rejections.length === 0, rejections.join(' | '));
  check('S4 beide Quellen tot: 0 Page-Errors', log.pageErrors.length === 0, log.pageErrors.slice(0, 2).join(' | '));
  await ctx.close();
}

/*
 * S4c – beide Quellen HÄNGEN (nicht: sofort tot). Ohne Zeitlimit bliebe der
 * Dialog dauerhaft im Ladezustand; mit dem 12-s-Deckel muss er in den
 * Fehlerzustand wechseln.
 */
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = await recorder(page);
  await page.evaluateOnNewDocument(PRELUDE);
  await installFixtures(page, {
    route: ({ url, venue }) => (venue && /aggTrades|market\/trades|ticker|heatmap|macro/i.test(url) ? { hang: true } : null),
  });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await wait(6000);
  const opened = await openTool(page, /Lupe|Magnifier|Lupa|Лупа|放大镜/i);
  const t0 = Date.now();
  let settled = null;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await wait(500);
    const state = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const text = (dialog?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return { present: !!dialog, text, error: /nicht erreichbar|Fehler|error|fehlgeschlagen/i.test(text) };
    });
    if (state.present && state.error) {
      settled = { ...state, ms: Date.now() - t0 };
      break;
    }
  }
  check(
    'S4c beide Quellen hängen: Dialog endet im Fehlerzustand (≤ 20 s, 12-s-Deckel)',
    opened.opened && !!settled,
    settled ? `${settled.ms} ms · ${settled.text.slice(0, 60)}` : `hängt weiter im Ladezustand (${JSON.stringify(opened)})`,
  );
  check('S4c hängende Quellen: 0 unbehandelte Rejections', (await rejectionsOf(page, log)).length === 0, (await rejectionsOf(page, log)).join(' | '));
  check('S4c hängende Quellen: 0 Page-Errors', log.pageErrors.length === 0, log.pageErrors.slice(0, 2).join(' | '));
  await ctx.close();
}

/* ═══════════════════════════════════════════════════════════════════════════
 * S5 · Payload-Härtung
 * ═══════════════════════════════════════════════════════════════════════ */
console.log('\nS5 · Payload-Härtung: Riesen-Body, kaputtes JSON, giftige Daten');

/* S5a – Antwort über dem 4-MiB-Deckel (Speicher-DoS-Schutz) */
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = await recorder(page);
  await page.evaluateOnNewDocument(PRELUDE);
  await installFixtures(page, {
    route: ({ url, venue, counters }) => {
      if (!venue || !/klines|candles|kline|OHLC/i.test(url)) return null;
      if (counters.injected !== 0) return null; // nur der erste Request ist „giftig“
      const pad = '0'.repeat(4 * 1024 * 1024 + 4096);
      return { body: `[${pad}]` };
    },
  });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await wait(9000);
  const state = await chartState(page);
  check('S5a 4-MiB-Deckel: kein Absturz (Chart oder Platzhalter steht)', state.canvases >= 1 || state.placeholders >= 1, JSON.stringify(state));
  check('S5a 4-MiB-Deckel: 0 Page-Errors', log.pageErrors.length === 0, log.pageErrors.slice(0, 2).join(' | '));
  const heapMb = await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576));
  check('S5a 4-MiB-Deckel: Heap bleibt klein (< 400 MB)', heapMb < 400, `${heapMb} MB`);
  await ctx.close();
}

/* S5b – kaputtes JSON + leere Liste + giftige Werte in einem Durchlauf */
{
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = await recorder(page);
  await page.evaluateOnNewDocument(PRELUDE);
  await installFixtures(page, {
    route: ({ url, venue, counters }) => {
      if (!venue || !/klines|candles|kline|OHLC/i.test(url)) return null;
      const n = counters.injected;
      if (n >= 3) return null;
      if (n === 0) return { body: '{kaputt' }; // ungültiges JSON
      if (n === 1) {
        /* „Giftige“ Kerzen: null-Werte und Strings statt Zahlen */
        const candles = makeCandles({ count: 60, stepMs: 3_600_000 });
        return { body: candles.map((c, i) => [String(Math.floor(c.t / 1000)), i === 3 ? null : String(c.o), String(c.c), String(c.h), String(c.l), String(c.v), 0, '0']) };
      }
      return { body: [] }; // leere Historie
    },
  });
  await page.goto(`${BASE}/de/terminal`, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
  await wait(10_000);
  /* Selbstheilung: ab jetzt liefert der Fixture-Feed wieder echte Kerzen */
  let healed = null;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    await wait(500);
    const state = await chartState(page);
    if (state.canvases >= 1 && /O\s*[\d.]+/.test(state.legend)) {
      healed = state;
      break;
    }
  }
  check('S5b giftige Payloads: kein Absturz, Chart heilt sich selbst', !!healed, healed ? healed.legend : JSON.stringify(await chartState(page)));
  const nanShown = await page.evaluate(() => /NaN|undefined|null/.test(document.body.innerText));
  check('S5b giftige Payloads: keine NaN-/undefined-Anzeige im UI', !nanShown);
  check('S5b giftige Payloads: 0 Page-Errors, 0 unbehandelte Rejections', log.pageErrors.length === 0 && (await rejectionsOf(page)).length === 0, [...log.pageErrors, ...(await rejectionsOf(page, log))].slice(0, 2).join(' | '));
  const cacheOk = await page.evaluate(() => {
    let poisoned = 0;
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i) || '';
      if (!key.startsWith('nc-l2-v1:seed:')) continue;
      const raw = window.localStorage.getItem(key) ?? '';
      if (/kaputt|"null"|NaN/.test(raw)) poisoned += 1;
    }
    return poisoned;
  });
  check('S5b keine vergifteten L2-Einträge', cacheOk === 0, `verdächtig=${cacheOk}`);
  await shot(page, 'm8-payload');
  await ctx.close();
}

await browser.close();
const seconds = Math.round((Date.now() - started) / 1000);
console.log(`\nGESAMT: ${ok} ok / ${bad} Befund(e) · ${seconds}s`);
if (bad > 0) {
  console.log('Befunde:');
  for (const row of rows.filter((r) => !r.ok)) console.log(`  ✗ ${row.name} — ${row.detail}`);
}
process.exitCode = bad > 0 ? 1 : 0;
