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

/*
 * Ticker-Fixtures (24-h-Übersicht).
 *
 * Ohne sie beantwortet dieser Harness JEDEN Nicht-Kline-Aufruf mit 503 – die
 * Heatmap blieb dadurch leer und ihre Prüfungen galten offline als „nicht
 * messbar". Genau so blieb ein echter Fehler unsichtbar: der Klick auf eine
 * Heatmap-Kachel wechselte das Paar nicht (`pickSymbol` kannte nur die fünf
 * Seed-Tokens), die CI mit Internet fand ihn, die Offline-Kette nicht.
 * Diese Fixtures liefern dieselben Formate wie die Börsen (Binance-Array,
 * OKX-`data`-Hülle, Gate-Array), damit der echte Parser-/Render-Pfad läuft.
 */
const TICKER_PATTERNS = [
  [/api\.binance\.com\/api\/v3\/ticker\/24hr/i, 'binance'],
  [/okx\.com\/api\/v5\/market\/tickers/i, 'okx'],
  [/api\.gateio\.ws\/api\/v4\/spot\/tickers/i, 'gate'],
];
/** Paare mit Volumen, damit Treemap/Sortierung realistisch arbeiten. */
const TICKER_PAIRS = [
  ['BTC', 61_000_000_000, 1.8], ['ETH', 24_000_000_000, -0.9], ['SOL', 9_000_000_000, 4.2],
  ['XRP', 4_100_000_000, -1.6], ['DOGE', 3_400_000_000, 6.1], ['ADA', 1_900_000_000, 0.4],
  ['AVAX', 1_500_000_000, -2.3], ['LINK', 1_300_000_000, 2.9], ['TON', 1_100_000_000, 1.1],
  ['DOT', 980_000_000, -0.6], ['MATIC', 900_000_000, 3.3], ['NEAR', 700_000_000, -4.1],
  ['ATOM', 620_000_000, 0.9], ['APT', 540_000_000, 5.2], ['ARB', 500_000_000, -1.2],
  ['OP', 460_000_000, 2.0], ['INJ', 420_000_000, 7.4], ['SUI', 380_000_000, -3.5],
  ['SEI', 320_000_000, 1.4], ['TIA', 300_000_000, -0.3], ['FIL', 280_000_000, 0.7],
  ['LTC', 260_000_000, -1.9], ['BCH', 240_000_000, 3.8], ['ETC', 200_000_000, 0.2],
  ['XLM', 180_000_000, -2.7], ['HBAR', 160_000_000, 4.6], ['RNDR', 150_000_000, 8.1],
  ['GRT', 140_000_000, -1.1], ['AAVE', 130_000_000, 2.4], ['UNI', 120_000_000, -0.8],
  ['MKR', 110_000_000, 1.6], ['CRV', 100_000_000, -5.2], ['ALGO', 95_000_000, 0.5],
  ['FTM', 90_000_000, 3.1], ['SAND', 85_000_000, -2.2], ['MANA', 80_000_000, 1.9],
  ['AXS', 75_000_000, -3.9], ['ROSE', 70_000_000, 6.7], ['KAVA', 65_000_000, -0.4],
  ['ZEC', 60_000_000, 2.6], ['DASH', 55_000_000, -1.5], ['IOTA', 50_000_000, 0.8],
];
const TICKER_PRICES = {
  BTC: 64_000, ETH: 3_100, SOL: 148, XRP: 0.62, DOGE: 0.158, ADA: 0.48, AVAX: 34.2,
  LINK: 17.4, TON: 7.2, DOT: 6.9, MATIC: 0.71, NEAR: 5.4, ATOM: 8.6, APT: 9.1, ARB: 1.12,
  OP: 2.35, INJ: 26.5, SUI: 1.62, SEI: 0.58, TIA: 9.8, FIL: 5.9, LTC: 82.4, BCH: 412,
  ETC: 26.8, XLM: 0.108, HBAR: 0.082, RNDR: 7.1, GRT: 0.26, AAVE: 92.5, UNI: 9.4,
  MKR: 2_460, CRV: 0.44, ALGO: 0.19, FTM: 0.72, SAND: 0.39, MANA: 0.44, AXS: 7.6,
  ROSE: 0.11, KAVA: 0.82, ZEC: 29.4, DASH: 31.2, IOTA: 0.22,
};
const tickerPrice = (base, changePct) => Number((TICKER_PRICES[base] ?? 1).toFixed(base === 'XLM' || base === 'HBAR' || base === 'ALGO' || base === 'IOTA' ? 3 : 2)) * (1 + changePct / 100);
function makeTickers(venue) {
  if (venue === 'okx') {
    return { code: '0', data: TICKER_PAIRS.map(([base, volume, change]) => ({
      instId: `${base}-USDT`,
      last: s(tickerPrice(base, change), 6),
      open24h: s(tickerPrice(base, 0), 6),
      volCcy24h: s(volume),
    })) };
  }
  return TICKER_PAIRS.map(([base, volume, change]) => ({
    symbol: `${base}USDT`,
    lastPrice: s(tickerPrice(base, change)),
    priceChangePercent: s(change),
    quoteVolume: s(volume),
  }));
}
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
 * Wendet eine von der Suite injizierte Antwort an (M8-Fault-Injection).
 *
 * Unterstützte Formen:
 *   { abort: true }                       – Request hart abbrechen (Netzabbruch)
 *   { hang: true }                        – nie antworten (hängende Verbindung)
 *   { delayMs, status, body, headers }    – verzögert/abweichend antworten
 * `body` darf Objekt (wird serialisiert) oder String (roh, z. B. kaputtes JSON)
 * sein. Die CORS-Header sind immer dabei, sonst blockt der Browser die Antwort.
 */
function respondInjected(req, verdict, counters) {
  counters.injected = (counters.injected ?? 0) + 1;
  if (verdict.abort) {
    req.abort('failed').catch(() => {});
    return;
  }
  if (verdict.hang) return; // bewusst keine Antwort
  const send = () => {
    const body =
      typeof verdict.body === 'string'
        ? verdict.body
        : verdict.body === undefined
          ? '{}'
          : JSON.stringify(verdict.body);
    req
      .respond({
        status: verdict.status ?? 200,
        headers: { ...CORS, ...(verdict.headers ?? {}) },
        body,
      })
      .catch(() => {});
  };
  if (verdict.delayMs) setTimeout(send, verdict.delayMs);
  else send();
}

/**
 * Fixtures installieren. Rückgabe zählt die Antworten.
 *
 * @param {import('puppeteer').Page} page
 * @param {{ route?: (ctx: { url: string, venue: string | null, counters: object, req: object }) => (object | null | undefined) }} [opts]
 *   `route` läuft VOR dem Standardverhalten und darf für einzelne Venue-Aufrufe
 *   eine eigene Antwort liefern (Fault-Injection: 429, Hang, Riesen-Body …).
 *   Ohne Rückgabe greift der normale Fixture-Feed.
 */
export async function installFixtures(page, opts = {}) {
  const { route } = opts;
  const counters = { served: 0, rejected: 0, passthrough: 0, byVenue: {}, injected: 0 };
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (!VENUE_HOST.test(url)) {
      counters.passthrough += 1;
      req.continue().catch(() => {});
      return;
    }
    const hit = PATTERNS.find(([re]) => re.test(url));
    /*
     * `venue` ist bewusst NICHT auf die Kline-Muster beschränkt: die
     * Fault-Injection der M8-Suite muss auch Tape-/Ticker-Aufrufe erwischen
     * (aggTrades, ticker/24hr, market/trades). Vorher blieb `venue` dort null,
     * die Route feuerte nie und die Prüfung war still immer grün.
     */
    const venue = hit ? hit[1] : ((url.match(VENUE_HOST)?.[1] ?? '').toLowerCase() || null);
    const routed = route?.({ url, venue, counters, req });
    if (routed) {
      respondInjected(req, routed, counters);
      return;
    }
    const tickerHit = TICKER_PATTERNS.find(([re]) => re.test(url));
    if (!hit && tickerHit) {
      counters.served += 1;
      counters.byVenue[tickerHit[1]] = (counters.byVenue[tickerHit[1]] ?? 0) + 1;
      req
        .respond({ status: 200, headers: CORS, body: JSON.stringify(makeTickers(tickerHit[1])) })
        .catch(() => {});
      return;
    }
    if (!hit) {
      counters.rejected += 1;
      req
        .respond({ status: 503, headers: CORS, body: JSON.stringify({ error: 'sandbox: venue call not covered by fixtures' }) })
        .catch(() => {});
      return;
    }
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
