// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// Sandbox-Fixture-Feed: Die Sandbox erreicht keine Börsen. Damit der Chart über
// den ECHTEN Pfad (Adapter → Parser → Store → Renderer) läuft, werden die
// Kline-Requests der 12 Venues im Browser abgefangen und im jeweiligen
// Wire-Format beantwortet – mit CORS-Headern, sonst blockt der Browser sie.
//
// Nicht abgedeckte Venue-Aufrufe antworten bewusst 503 (Region-Ranker fällt
// durch) – diese Meldungen sind erwartet und kein Defekt.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json',
  'x-nc-fixture': '1',
};

/** Deterministischer Zufallsgenerator (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Driftender Random-Walk mit Volatilitäts-Clustern, Dochten und Volumen. */
export function makeCandles({ count = 300, stepMs = 3_600_000, start = 60_000, seed = 7, endMs = Date.now() } = {}) {
  const rand = rng(seed);
  const out = [];
  let price = start;
  let vol = 0.006;
  const firstT = Math.floor(endMs / stepMs) * stepMs - (count - 1) * stepMs;
  for (let i = 0; i < count; i++) {
    vol = Math.max(0.002, Math.min(0.03, vol * (0.92 + rand() * 0.18)));
    const drift = (rand() - 0.48) * 0.0022;
    const open = price;
    const close = Math.max(1, open * (1 + drift + (rand() - 0.5) * vol));
    const high = Math.max(open, close) * (1 + rand() * vol * 0.5);
    const low = Math.min(open, close) * (1 - rand() * vol * 0.5);
    const volume = 40 + rand() * 900 * (1 + vol * 40);
    out.push({ t: firstT + i * stepMs, o: open, h: high, l: low, c: close, v: volume });
    price = close;
  }
  return out;
}

const n = (x, d = 2) => Number(x.toFixed(d));
const s = (x, d = 2) => String(n(x, d));

/** Antwort-Body je Venue im Original-Format (Sortierung wie im Live-API). */
const FORMATS = {
  binance: (cs) => cs.map((c) => [c.t, s(c.o), s(c.h), s(c.l), s(c.c), s(c.v, 3), c.t + 3_599_999, s(c.v * c.c, 3), 100, '0', '0', '0']),
  bybit: (cs) => ({ retCode: 0, retMsg: 'OK', result: { symbol: 'BTCUSDT', category: 'spot', list: [...cs].reverse().map((c) => [String(c.t), s(c.o), s(c.h), s(c.l), s(c.c), s(c.v, 3), s(c.v * c.c, 3)]) } }),
  okx: (cs) => ({ code: '0', msg: '', data: [...cs].reverse().map((c) => [String(c.t), s(c.o), s(c.h), s(c.l), s(c.c), s(c.v, 3), s(c.v, 3), s(c.v * c.c, 3), '1']) }),
  kraken: (cs) => ({ error: [], result: { XXBTZUSD: cs.map((c) => [Math.floor(c.t / 1000), s(c.o), s(c.h), s(c.l), s(c.c), s(c.c, 3), s(c.v, 3), 42]), last: String(cs[cs.length - 1].t) } }),
  coinbase: (cs) => [...cs].reverse().map((c) => [Math.floor(c.t / 1000), n(c.l), n(c.h), n(c.o), n(c.c), n(c.v, 3)]),
  gate: (cs) => cs.map((c) => [String(Math.floor(c.t / 1000)), s(c.v * c.c, 3), s(c.c), s(c.h), s(c.l), s(c.o), s(c.v, 3), 'true']),
  bitget: (cs) => ({ code: '00000', msg: 'success', requestTime: Date.now(), data: cs.map((c) => [String(c.t), s(c.o), s(c.h), s(c.l), s(c.c), s(c.v, 3), s(c.v * c.c, 3)]) }),
  coinex: (cs) => ({ code: 0, message: 'OK', data: [...cs].reverse().map((c) => [Math.floor(c.t / 1000), s(c.o), s(c.c), s(c.h), s(c.l), s(c.v, 3), s(c.v * c.c, 3)]) }),
  kucoin: (cs) => ({ code: '200000', data: [...cs].reverse().map((c) => [String(Math.floor(c.t / 1000)), s(c.o), s(c.c), s(c.h), s(c.l), s(c.v, 3), s(c.v * c.c, 3)]) }),
  htx: (cs) => ({ status: 'ok', ts: Date.now(), data: [...cs].reverse().map((c) => ({ id: Math.floor(c.t / 1000), open: n(c.o), close: n(c.c), low: n(c.l), high: n(c.h), amount: n(c.v, 3), vol: n(c.v * c.c, 3), count: 120 })) }),
  bitfinex: (cs) => [...cs].reverse().map((c) => [c.t, n(c.o), n(c.c), n(c.h), n(c.l), n(c.v, 3)]),
  cryptocom: () => ({ code: 0, method: 'public/get-candlestick', result: { data: [] } }),
};

/** Erkennt Kline-Requests und ordnet sie der Venue zu. */
const PATTERNS = [
  [/data-api\.binance\.vision\/api\/v3\/klines|api\.binance\.com\/api\/v3\/klines/, 'binance'],
  [/api\.bybit\.com\/v5\/market\/kline/, 'bybit'],
  [/okx\.com\/api\/v5\/market\/candles/, 'okx'],
  [/api\.kraken\.com\/0\/public\/OHLC/, 'kraken'],
  [/api\.exchange\.coinbase\.com\/products\/[^/]+\/candles/, 'coinbase'],
  [/api\.gateio\.ws\/api\/v4\/spot\/candlesticks/, 'gate'],
  [/api\.bitget\.com\/api\/v2\/spot\/market\/candles/, 'bitget'],
  [/api\.coinex\.com\/v1\/market\/kline/, 'coinex'],
  [/api\.kucoin\.com\/api\/v1\/market\/candles/, 'kucoin'],
  [/api\.huobi\.pro\/market\/history\/kline/, 'htx'],
  [/api-pub\.bitfinex\.com\/v2\/candles/, 'bitfinex'],
  [/api\.crypto\.com\/public\/get-candlestick/, 'cryptocom'],
];

const VENUE_HOST = /(binance|bybit|okx|kraken|coinbase|gateio|bitfinex|huobi|htx|bitget|kucoin|coinex|crypto\.com|dexscreener|geckoterminal)/i;

/** Timeframe-Hinweis aus der URL – grob an den Live-Response-Größen orientiert. */
function timeframeHint(url) {
  if (/granularity=60\b|interval=1m|bar=1m|1min|type=1min/.test(url)) return 60_000;
  if (/interval=15m|15min|bar=15m/.test(url)) return 900_000;
  if (/interval=5m|5min|bar=5m/.test(url)) return 300_000;
  if (/interval=4h|4hour|bar=4H/.test(url)) return 14_400_000;
  if (/interval=1d|1day|bar=1D|granularity=86400/.test(url)) return 86_400_000;
  if (/interval=1w|1week|bar=1W|granularity=604800/.test(url)) return 604_800_000;
  return 3_600_000;
}

/**
 * Fixtures installieren. Rückgabe zählt die Antworten.
 * @param {import('puppeteer').Page} page
 */
export async function installFixtures(page) {
  const counters = { served: 0, rejected: 0, passthrough: 0, byVenue: {} };
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (!VENUE_HOST.test(url)) {
      counters.passthrough += 1;
      req.continue().catch(() => {});
      return;
    }
    const hit = PATTERNS.find(([re]) => re.test(url));
    if (!hit) {
      counters.rejected += 1;
      req
        .respond({ status: 503, headers: CORS, body: JSON.stringify({ error: 'sandbox: venue call not covered by fixtures' }) })
        .catch(() => {});
      return;
    }
    const [, venue] = hit;
    const stepMs = timeframeHint(url);
    const candles = makeCandles({ count: 300, stepMs, seed: venue.length * 13 + 5 });
    counters.served += 1;
    counters.byVenue[venue] = (counters.byVenue[venue] ?? 0) + 1;
    req
      .respond({ status: 200, headers: CORS, body: JSON.stringify(FORMATS[venue](candles)) })
      .catch(() => {});
  });
  return counters;
}
