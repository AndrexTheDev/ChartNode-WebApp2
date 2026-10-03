# NodeChart

> **NodeChart — Browser charts and market research for selected crypto venues.**

A browser-based charting and research workspace for selected centralized-exchange markets and decentralized-exchange pools. Core charting is available without an account or recurring subscription; third-party ads and sponsored links may appear. Two themes unlock when a prepared share composer opens (publication is not verified), while selected Pro features require qualifying support verified on supported networks.

The project configures 12 CEX adapter identifiers and mappings for 33 chain IDs; this does not guarantee that every pair, endpoint, history range, or region is covered. Market requests may go directly to providers or through allowlisted Next.js serverless proxy routes. No separately operated backend or paid API is required by the current design; hosting plans, provider terms, rate limits, and availability can change.

Next.js App Router · Tailwind design system · Zustand · next-intl (5 locales) · Cloudflare OpenNext deployment.

---

## 1. Tech stack & architectural decisions

| Concern | Decision | Why |
| --- | --- | --- |
| Framework | **Next.js 16** (App Router) | Webpack production build (`next build --webpack`), `proxy.ts`, and static generation where configured |
| Deployment adapter | **`@opennextjs/cloudflare`** | The app uses the Cloudflare OpenNext adapter and Node.js-compatible Worker routes. Confirm current platform quotas, plan terms, and costs before deployment. |
| i18n | **next-intl** | `localePrefix: 'always'` serves `/en /de /es /zh /ru` paths with locale-aware metadata and language links. |
| Language auto-detection | **`proxy.ts`** (Accept-Language / NEXT_LOCALE cookie) + client `navigator.languages` banner as fallback | Server routing handles the initial request; the optional banner can suggest a browser language. |
| State | **Zustand** (`useAppStore`) with `persist` + `skipHydration` | Selector-scoped subscriptions ⇒ no re-render storms; persisted to localStorage |
| Styling | **Tailwind CSS 3** with a CSS-variable theme layer | Swapping `<html data-theme>` re-skins the whole app without re-rendering React |
| Charts (landing/terminal preview) | deterministic inline-SVG `MockChart` → `LiveCandles` when a supported feed returns candles | The seeded preview is stable between server and client renders and does not require a separate chart image. |
| CEX market data | **WebSockets** (Binance · Bybit · OKX and other configured adapters) | Browser streams and REST history are provider-dependent; selected REST/API requests use the first-party serverless relay. |
| DEX market data | **DexScreener + GeckoTerminal REST**, merged and deduplicated | Network mappings are configured in the app; provider listings, pair coverage, quotas, and regional access vary. |
| Token risk indicators | **RugCheck** (Solana) + **GoPlus** (EVM), with selected simulation checks | Third-party flags and simulations cover supported networks only. “No flags” is not proof of safety; unavailable checks are shown as unknown. |
| Rate limiting | global 429 cooldown (`beginCooldown` → overlay → retry) | A provider 429 can pause shared requests briefly before the client retries; repeated limits and failures remain possible. |
| Trade-size stream | trade channels on shared sockets, ≥ $10,000 notional | Reuses configured exchange connections where the venue exposes the required trade channel. |

### Why `proxy.ts` and not `middleware.ts`?
Next.js 16 renamed the file convention (`middleware.ts` → `proxy.ts`, `middleware()` → `proxy()`).
next-intl's `createMiddleware` is used unchanged; only the file name/export contract changed.

### Why a `/terminal` route?
The Part-1 brief requires a working **"Launch Terminal"** CTA — a CTA that 404s is a defect. The
route includes a chart workspace, drawing tools, multi-pane layouts, indicators, scripts,
replay/backtest, screener, risk calculations, and additional research tools. Live feeds depend on
provider, symbol, interval, region, browser connectivity, and current endpoint availability; derived
or locally calculated values can differ from exchange data.
It is **indexable** and listed in `sitemap.xml` like every other locale page; only shared parameter
variants (`?ticker=…&price=…`) stay `noindex` so they cannot compete with the canonical terminal URL.

---

## 2. Repository layout

```
nodechart/
├── messages/                     # 5 locale bundles (en = reference, checked by scripts/check-i18n.mjs)
│   ├── en.json  de.json  es.json  zh.json  ru.json
├── scripts/
│   ├── check-i18n.mjs            # key + ICU-placeholder parity check across locales
│   ├── run-harness.mjs           # esbuild runner for the smoke-test entries
│   ├── ws-smoke.entry.ts         # configured adapter fixtures + CandleDeriver checks
│   ├── api-smoke.entry.ts        # provider client, parsing and venue-selection checks
│   ├── chart-smoke.entry.ts      # indicator math, sync bus, drawings, precision, persistence
│   └── browser-check.mjs         # Puppeteer browser checks; a compatible browser binary is required
├── public/
│   ├── og.png                    # social card
│   └── brand/                    # optimized WebP variants from nodechart_logo.png
├── src/
│   ├── proxy.ts                  # edge locale detection + routing (Next 16 proxy convention)
│   ├── i18n/
│   │   ├── routing.ts            # locales, defaultLocale, prefix strategy  (source of truth)
│   │   ├── navigation.ts         # locale-aware Link / useRouter / usePathname
│   │   └── request.ts            # per-request message + locale resolution (must return `locale`)
│   ├── app/
│   │   ├── sitemap.ts  robots.ts  manifest.ts  icon.png  apple-icon.png
│   │   └── [locale]/
│   │       ├── layout.tsx        # <html lang>, fonts, metadata, providers, boot script
│   │       ├── page.tsx          # landing
│   │       ├── not-found.tsx
│   │       ├── help/page.tsx     # static localized Help content
│   │       ├── terminal/page.tsx # workspace shell + dynamic OG metadata
│   │       ├── cluster/page.tsx  # standalone NodeCluster tool
│   │       └── legal/[doc]/page.tsx # terms | disclaimer | privacy by locale
│   │   └── api/
│   │       ├── og/route.ts       # social card (SVG 1200×630, sanitized)
│   │       ├── proxy/[provider]/route.ts # allowlisted serverless provider proxy
│   │       └── verify-donation/route.ts # qualifying on-chain verification
│   ├── api/                      # ── provider client/data layer ─────────────
│   │   ├── http.ts               # the ONLY fetch entry point (timeout, 429, cache, dedupe)
│   │   ├── rateLimit.ts          # global cooldown controller (5 s) driving the overlay
│   │   ├── dexscreener.ts        # /latest/dex/search + /tokens/{addr}
│   │   ├── geckoterminal.ts      # /search/pools + /networks/{n}/tokens/{addr}/pools
│   │   ├── security.ts           # GoPlus + honeypot.is (EVM) / RugCheck (Solana) → verdict
│   │   ├── exchangeProbe.ts      # samples endpoint/handshake reachability for configured venues
│   │   ├── search.ts             # smartSearch(): CEX universe ∥ DEX aggregators
│   │   └── types.ts              # DexPair · SecurityAudit · SearchHit · AuditProvider
│   ├── websockets/               # ── Part 2: CEX streaming layer ─────────────
│   │   ├── manager.ts            # one socket per (exchange, endpoint), ref-counted channels
│   │   ├── socket.ts             # ManagedSocket: reconnect, backoff+jitter, heartbeat, watchdog
│   │   ├── backoff.ts            # exponential backoff with jitter
│   │   ├── rest.ts               # initial candle history (seed) per exchange
│   │   ├── derive.ts             # CandleDeriver: trades → OHLCV (Coinbase/KuCoin/CoinEx)
│   │   ├── registry.ts           # ADAPTERS + EXCHANGE_PREFERENCE (liquidity order)
│   │   ├── whale.ts              # ≥ $10 000 trade filter, batched flush (400 ms)
│   │   ├── types.ts              # Candle · FeedKey · FeedEvent · ExchangeAdapter · ExchangeId
│   │   └── adapters/             # binance · bybit · okx · kraken · coinbase · gate · bitfinex ·
│   │                             #   cryptocom · htx · bitget · kucoin · coinex (+ shared)
│   ├── components/
│   │   ├── ads/       AdManager (social bar + soft-wall host) · AdRail (native
│   │   │              banner) · SupportModal (donations + clipboard)
│   │   ├── share/     ShareModal (X/Telegram intents + theme unlock)
│   │   ├── ui/        NeonButton · NeonPanel · Dropdown · GlitchText · GridBackdrop ·
│   │   │              Kbd · StatusLed · SectionHeading · MockChart · FeatureIcon · Modal
│   │   ├── layout/    SiteHeader · SiteFooter · LocaleSwitcher · ThemeSwitcher ·
│   │   │              CommandPalette · GlobalShortcuts · StoreBridge · ThemeBootScript ·
│   │   │              LocaleDetectBanner · Logo
│   │   ├── landing/   Hero · Ticker · FeatureGrid · LayoutShowcase · CtaSection
│   │   ├── help/      HelpExplorer
│   │   ├── legal/     LegalDocument
│   │   ├── search/    SmartSearch (top-nav bar + dropdown) · SecurityBadge
│   │   ├── whales/    WhaleTicker (sticky bottom stream)
│   │   ├── overlays/  RateLimitOverlay (CSS glitch + 5 s countdown)
│   │   ├── chart/     PriceChart (lightweight-charts wrapper) · ChartGrid (1x1/2x1/2x2) ·
│   │   │              IndicatorModal (editable indicator instances and parameters) ·
│   │   │              DrawingToolbar (tools + mobile gate) · primitives (watermark, drawings)
│   │   ├── market/    MarketDataProvider (mounts feeds, reroutes, renders nothing)
│   │   └── terminal/  TerminalShell · LiveCandles · ExchangePicker (venue dropdown)
│   ├── store/
│   │   ├── types.ts              # Token / Pane / layout / theme domain types
│   │   ├── presets.ts            # 1x1 · 2x1 · 2x2 grid presets, timeframes, chart types
│   │   ├── storage.ts            # SSR-safe persist storage (critical, see file comment)
│   │   ├── useAppStore.ts        # THE global store + selectors + actions
│   │   ├── useMarketStore.ts     # candles · feed status · DEX quotes (Part 2)
│   │   ├── useWhaleStore.ts      # whale ring buffer (48) · threshold · enabled
│   │   ├── useRateLimitStore.ts  # overlay state (active · source · deadline · hits)
│   │   ├── useExchangeStore.ts   # reach/latency · country · unsupported pairs · preferences
│   │   ├── useExchangeSelection.ts  # hook: ranked venues + active feed + reroute notices
│   │   ├── useChartStore.ts      # Part 4: indicators · drawings · sync flags · mobile gate
│   │   ├── useViralStore.ts      # supporter · wall cooldown · share unlock (persisted)
│   │   └── useHydrated.ts        # hydration gate for persisted state
│   ├── lib/           ads/ (adsterra loader · adblock bait · config) · viral
│   │                  (share texts/intents/urls) · og (edge card builder) ·
│   │                  cn · constants · locales · locale-param · seo · theme · format ·
│   │                  address (EVM/Move/TON/Solana CA detection) · chains (33 chains × 4
│   │                  provider mappings) · cex-universe · exchanges (venue metadata) ·
│   │                  region (geo-blocks + detection) · exchange-select (ranking) ·
│   │                  indicators (technicalindicators wrappers) · drawings (data-space
│   │                  geometry) · chart-sync (range/crosshair bus) · device (touch gate) ·
│   │                  chart-theme (3 themes → lightweight-charts options)
│   └── styles/globals.css        # design tokens (3 themes), components, utilities
├── tailwind.config.js            # cyberpunk design system (asked-for deliverable)
├── next.config.mjs               # next-intl plugin + optional CF bindings for dev
├── open-next.config.ts
├── wrangler.jsonc
└── eslint.config.mjs
```

---

## 3. Local development

```bash
npm install            # local dev works on Node >= 20.9
npm run dev            # http://localhost:3000  (Turbopack)
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | local dev server on `0.0.0.0:3000` |

> **Node version:** local `dev`/`build` run on Node ≥ 20.9 (Next's floor). The Cloudflare CI and
> all `cf:*` scripts need **Node 22** (wrangler/miniflare) — the committed `.nvmrc` pins that.
| `npm run build` | `next build --webpack` (prerenders all 5 locales; same build path the audit and `cf:build` use) |
| `npm start` | serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint flat config (`next lint` was removed in Next 16) |
| `npm run check:i18n` | locale bundle parity (keys + `{placeholders}`) |
| `npm run smoke` | live proof: WS adapters + DEX/audit layer (see §6) |
| `npm run ws:smoke` | adapter fixtures + real Binance/Bybit/OKX sockets |
| `npm run api:smoke` | real DexScreener/GeckoTerminal/GoPlus/RugCheck calls + rate-limit + whale filter |
| `npm run cf:build` | `opennextjs-cloudflare build` → `.open-next/` |
| `npm run cf:preview` | build + `wrangler dev` (local Cloudflare runtime) |
| `npm run cf:deploy` | build + `wrangler deploy` |
| `CF_LOCAL_BINDINGS=1 npm run dev` | boot miniflare so KV/D1 bindings exist in dev |

---

## 4. Deploy: GitHub → Cloudflare Workers

> **Deployment guide (German):** [`VEROEFFENTLICHEN.md`](VEROEFFENTLICHEN.md)

1. Push this repository to GitHub. The optional `.github/workflows/deploy.yml` workflow requires GitHub Actions to be enabled and the documented Cloudflare secrets to be configured (`VEROEFFENTLICHEN.md` §3b).
2. Cloudflare dashboard → **Workers & Pages** → **Create** → connect the repo.
3. Build settings:

   | Field | Value |
   | --- | --- |
   | Build command | `npm run cf:build` |
   | Deploy command | `npx wrangler deploy` |
   | Node version | `22` (or rely on the committed `.nvmrc`) |
   | Env var | `NEXT_PUBLIC_SITE_URL=https://nodechart.cc` |

   Cloudflare runs the build in its own CI, executes `opennextjs-cloudflare build`
   (which runs `next build --webpack` + converts `.next/` → `.open-next/worker.js` + static
   assets) and
   publishes a Worker with static assets on `workers.dev`.

4. Connect `nodechart.cc` to the Worker through the dashboard, then follow the DNS/certificate status and any steps shown there. Propagation and certificate timing depend on the domain configuration and platform.
5. Landing, Help, and Legal routes are generated where configured; terminal and allowlisted API
   routes may use request-time Worker compute. Current platform quotas and costs depend on the plan.

> `wrangler.jsonc` already contains the correct `main`, `assets`, `compatibility_flags`
> (`nodejs_compat`) and commented-out KV/D1 bindings for Part 2. Committing it prevents Wrangler
> from re-auto-configuring your project on deploy.

---

## 5. i18n & SEO implementation notes

* **5 locales** — `en de es zh ru`, with message-key and ICU-placeholder parity checked by `npm run check:i18n`; that command reports the current key count.
* **Rendering** — Landing, Help, and Legal pages are generated for the five locales; the terminal and API routes may render or fetch at request time. Sitemap, robots, manifest, icons, and `llms.txt` are also generated.
* **`<html lang>`** — exact BCP-47 tags: `en`, `de-DE`, `es-ES`, `zh-Hans`, `ru-RU`.
* **hreflang** — `x-default` + all 5 languages on every page and in `sitemap.xml`.
* **canonical / og:url / og:locale** — per-locale, absolute, derived from `NEXT_PUBLIC_SITE_URL`.
* **Fonts** — self-hosted via `next/font` (Exo 2 + Manrope + JetBrains Mono cover Latin & Cyrillic;
  CJK falls back to system fonts to avoid shipping megabytes).
* **robots/sitemap/manifest/icons** — generated from the configured routes/locales; localized sitemap entries carry `hreflang` + `x-default`, and `robots.txt` links to the sitemap. Route and locale counts can change with configuration.

---

## 6. Live data layer (Parts 2–3)

Chart interaction and many calculations run in the browser. Public data is fetched directly where supported or through allowlisted Next.js serverless routes for selected APIs and RPC methods. No separate backend service or paid API is required by this design; provider quotas, platform costs, regional access, and endpoint behavior still apply.

### 6.1 Configured public endpoints

Provider documentation and availability can change. A successful probe or cached response is a point-in-time observation, not a coverage or uptime guarantee.

| Feed | Endpoint | Notes |
| --- | --- | --- |
| DEX search | `api.dexscreener.com/latest/dex/search`, `/tokens/{addr}` | Public provider endpoint; documented limits, caching, supported networks, and returned pairs may change. |
| DEX search | `api.geckoterminal.com/api/v2/search/pools`, `/networks/{n}/tokens/{addr}/pools` | Provider limits and network coverage vary; the app maps provider network identifiers to supported chains. |
| EVM audit | `api.gopluslabs.io/api/v1/token_security/{chainId}` | every flag is a **string** (`"1"`/`"0"`); 19 EVM chains (list verified via `/supported_chains`) |
| EVM risk simulation | `api.honeypot.is/v2/IsHoneypot?address=…&chainID=…` | A provider simulation on selected chains; it is a snapshot and does not guarantee future trade behavior. |
| Solana audit | `api.rugcheck.xyz/v1/tokens/{mint}/report/summary` | `score_normalised` 0–100, **higher = riskier** |
| CEX candle seed | see §6.3 per venue | Requests a venue-specific amount of history and normalizes returned rows; depth and intervals vary. |
| KuCoin socket URL | `api.kucoin.com/api/v1/bullet-public` | token + `instanceServers[0].endpoint`, POST, no auth |

The manager opens **one socket per (exchange, endpoint)** and reference-counts channels, so
`MarketDataProvider` can add/remove watchlist symbols at runtime without reconnecting, and two
panes on the same pair share one subscription. `urlFor(channel)` in the adapter interface is what
lets OKX use two endpoints transparently.

### 6.2 Resilience

* **Reconnect** — exponential backoff 800 ms → 30 s with jitter, max 12 attempts, full resubscribe on open.
* **Watchdog** — no message for 45 s ⇒ socket is considered dead and recycled (the classic
  "TCP alive but exchange silent" failure).
* **Region blocks** — HTTP 401/403/451 are *not* retried; the venue is marked `blocked` and the
  selection layer reroutes to the next-ranked exchange (§6.4). The feed chip shows `feed.region`.
* **Pair not listed** — an empty/404 seed marks that symbol as unsupported on that venue
  (`unsupported[exchange]`), and the picker skips it for this pair only.
* **Rate limits** — a 429 can activate `useRateLimitStore` and the cooldown overlay. Requests may
  retry after the cooldown; providers can continue to reject, delay, or omit data. The timer is a
  client-side retry aid, not a promise that an endpoint will recover.

### 6.3 Configured CEX adapters — 12 identifiers

The adapters target public endpoints and include recorded fixtures for `npm run ws:smoke`. Live
reachability, symbols, intervals, rate limits, and regional access vary and can change; a past smoke
run is not a current availability guarantee.

| Venue | WebSocket | Candles | Trades | Implementation note (earlier probe) |
| --- | --- | --- | --- | --- |
| Binance | `wss://data-stream.binance.vision/ws` | `<pair>@kline_1m` | `@aggTrade` | market-data mirror — `stream.binance.com` answers **HTTP 451** for many regions |
| OKX | `wss://ws.okx.com:8443/ws/v5/{business\|public}` | `candle1m` | `trades` | `candle*` on the *public* endpoint answers `error 60018` |
| Bybit | `wss://stream.bybit.com/v5/public/spot` | `kline.1.BTCUSDT` | `publicTrade.*` | ping ≤ 20 s (18 s used); REST is 403 from some IPs |
| Coinbase | `wss://ws-feed.exchange.coinbase.com` | **derived** from `matches` | `matches` | no candle channel; maker side must be inverted; granularities stop at 1d; REST needs a `User-Agent` |
| Kraken | `wss://ws.kraken.com` | `ohlc` (interval in **minutes**) | `trade` | `XBT`→BTC, `XDG`→DOGE; v2 endpoints behave differently, v1 used |
| Gate.io | `wss://api.gateio.ws/ws/v4/` | `spot.candlesticks` | `spot.trades` | candle payload is a **flat** `["1m","BTC_USDT"]` (nested arrays silently stream nothing); server `spot.ping` → `spot.pong`; `create_time_ms` has microseconds |
| Bitfinex | `wss://api-pub.bitfinex.com/ws/2` | `trade:1m:tBTCUST` | `trades` | USDT is spelled **`UST`** (`tBTCUSDT` returns `[]`); `AMOUNT < 0` = sell; chanId map; **no 4h** bucket |
| Crypto.com | `wss://stream.crypto.com/exchange/v1/market` | `candlestick.1m.*` | `trade.*` | no REST seed reachable ⇒ `seedsViaSocket` (the subscribe answer carries history) |
| HTX | `wss://api.huobi.pro/ws` | `market.<sym>.kline.1min` | `…trade.detail` | frames are **gzip-compressed binary**; server `ping` must be answered with `pong` |
| Bitget | `wss://ws.bitget.com/v2/ws/public` | `candle1m` (`instType: SPOT`) | `trade` | v1 `SPBL` answers `30016`; heartbeat is the literal string `ping` |
| KuCoin | token URL from `bullet-public` | **derived** from `/market/match` | `/market/match` | both kline topics answer `404 topic does not exist`; ns timestamps; ping every 18 s |
| CoinEx | `wss://socket.coinex.com/` | **derived** from `deals.update` | `deals.subscribe` | v2 `candlesticks.subscribe` = "method not found"; REST klines are **v1** (`/v1/market/kline`) |

**Derived candles** — Coinbase, KuCoin, and CoinEx adapters construct OHLCV candles from returned
trade messages where configured candle channels are unavailable. Trade gaps, delayed messages,
provider history, and bucket boundaries can make derived candles incomplete or different from a
venue-native candle. The smoke test covers rollover and seed-continuation logic.

**Not configured as adapters in the current registry:** MEXC, Bitstamp, AscendEX, and Upbit. The
connection/protocol notes above reflect earlier probes and can become stale if providers change.

### 6.4 Region-aware routing

```
proxy.ts  →  cf-ipcountry header mirrored into the nc_country cookie (7 d, lax)
           ↘ fallback in the browser: Intl.DateTimeFormat().resolvedOptions().timeZone
```

`detectRegion()` returns `{ country, source }` (`edge` or `timezone`). `isRestrictedIn()` applies
an in-code list of known restrictions, which may not match a provider's current terms. The venue
probe observes a reachable REST endpoint or WebSocket handshake where possible and caches the
result; it is a client-side sample, not guaranteed execution latency or service availability.

Ranking (`exchange-select.ts`) — lower observed score wins; scores are a routing heuristic, not an execution-quality guarantee:

| Contribution | Value |
| --- | --- |
| measured reachable (`ok`) | `0` |
| measured slow (`slow`) | `0.5` |
| unknown / stale | `1` |
| measured unreachable (`blocked`, `error`) | `2` |
| geo-restricted for this country | `+1` |
| latency | `+0 … +0.4` (capped at 1500 ms) |
| liquidity preference rank | `+0.05` per step (binance → okx → bybit → …) |

Liquidity rank and sampled latency contribute to the score; those inputs do not establish actual
book depth or execution quality. A manual venue selection is retained unless the app marks that
venue unavailable for the selected pair or interval, in which case the picker can report a reroute.
A listed venue may still fail to provide data in a particular region or session.

### 6.5 DEX network mappings — 33 configured chain IDs

`src/lib/chains.ts` holds provider/network mapping tables. Their identifiers describe configured
lookups, not guaranteed token or pool availability:
`GECKO_NETWORK_TO_CHAIN` (80 slugs, incl. `avax`/`xdai`/`sei-network`/`sui-network`),
`CHAIN_TO_GECKO_NETWORK`, `GOPLUS_CHAIN_ID` (19 EVM chains), `HONEYPOT_CHAIN_ID` (5), and
`DEXSCREENER_TO_CHAIN` (34 ids — note Sei is `seiv2`).

Search classification (`src/lib/address.ts`) routes pasted contracts straight to the CA pipeline:
EVM (`0x` + 40 hex), **Sui/Aptos/raw TON** (`0x` + 64 hex, optional `::module::Type` suffix), TON
friendly (`EQ…`/`UQ…`) and Solana (base58). Anything else is a symbol/name search across the CEX
universe (~50 instruments) plus both DEX aggregators.

### 6.6 Security verdicts (`src/api/security.ts`)

| Verdict | Rule |
| --- | --- |
| `danger` (red, pulsing skull) | GoPlus: `is_honeypot`, `cannot_buy`, `cannot_sell_all`, `can_take_back_ownership`, `hidden_owner` = `"1"` or tax > 5 % · honeypot.is: `isHoneypot` or buy/sell tax > 5 % · RugCheck: any risk `level === 'danger'` or `score_normalised > 60` |
| `warn` (amber) | tax > 0, mintable, proxy, not open-source, < 50 holders · RugCheck `score_normalised > 25` or `level === 'warn'` |
| `safe` (green glow) | no configured risk flags returned by the selected provider checks; this is not proof of safety or a complete audit |
| `unknown` (muted) | audit failed / chain not supported — never blocks the search |

Pipeline per supported chain: **GoPlus** returns provider-supplied flags; selected EVM checks may
also call **honeypot.is** for a buy/sell simulation. Solana uses **RugCheck** where supported. The
merge favors the higher reported risk; simulations and static flags can miss behaviors, change over
time, or be unavailable. `provider` records the source, and unsupported or failed checks remain
unknown rather than being presented as a clean assessment.

Results are cached for a limited period and duplicate requests are deduplicated. Provider errors
remain possible and do not establish that a token is safe or unsafe.

### 6.7 Whale tracker

Trade channels are multiplexed onto the same sockets (no extra connections). `whale.ts` keeps only
trades with `price × qty ≥ 10 000 USD`, buffers them and flushes at most every 400 ms (newest first)
into a 48-entry ring buffer. Neon green = buy, neon red = sell; the ticker also shows count and total
notional, and the `Waves` button in the terminal toolbar unsubscribes the streams entirely.

### 6.8 Smoke tests

```bash
npm run smoke        # ws + api
```

`ws:smoke` replays recorded wire payloads for all 12 adapters, unit-tests `CandleDeriver` and the
HTX gzip path, and can open public sockets for a time-limited reachability check. The transcript
below is an earlier sample run only; current endpoints may behave differently:

```
— live public streams (12 venues) —
  PASS  binance    live: 20 candles / 248 trades (last sell @ 78126.23)
  PASS  coinbase   live: 0 candles / 134 trades → 134 derived (last sell @ 78099.89)
  PASS  kucoin     live: 0 candles / 128 trades → 128 derived (last sell @ 78133.7)
  PASS  coinex     live: 0 candles / 103 trades → 24 derived (last buy @ 78124)
  … 12/12 venues streaming
```

`api:smoke` exercises the search, audit, rate-limit, whale, region, and ranking code paths. Where
network access is available it also probes selected public providers and configured venues; those
results describe the test environment and time only. The harnesses bundle the production TypeScript
sources with esbuild and are dev-only.

---

## 7. Chart engine (Part 4)

The terminal at `/terminal` renders returned market candles with
[`lightweight-charts`](https://github.com/tradingview/lightweight-charts) v5. Indicator
mathematics uses [`technicalindicators`](https://www.npmjs.com/package/technicalindicators);
series are calculated in the browser from the loaded candle buffer. Feeds and calculations can be
incomplete, delayed, or unavailable, and the browser client is user-modifiable.

### 7.1 Canvas-integrated watermark

A `www.NodeChart.cc` text watermark is drawn by a custom `IPrimitivePaneView` into the chart
canvas. The position, size, and visibility vary with pane dimensions. App-generated screenshots
and exports may include it, and pane hosts expose `data-watermark="www.NodeChart.cc"` for tests.
Because this is client-side rendering, it is not tamper-proof or DRM; users can modify the page or
exported image.

### 7.2 Indicators — editable, multi-pane

* Indicator instances can be added per pane within the app's state and rendering constraints,
  each with its own parameters; instances can render as overlay lines or in an oscillator pane.
  parameters; instances render as overlay lines (EMA/SMA/Bollinger/VWAP…) or in their own
  oscillator pane (RSI/MACD/Stochastic/ATR/Williams %R/AO/ROC) — `chart.addSeries(def, opts,
  paneIndex)` keeps time scale and crosshair shared with the price pane.
* `src/lib/indicators.ts` wraps the `technicalindicators` classes, validates parameters and
  aligns outputs to candle timestamps. `scripts/chart-smoke.entry.ts` proves the math against
  independently computed references (including two library quirks: RSI rounds its output to
  2 dp, ATR seeds its first value at input index `period`).
* Parameters are edited in `IndicatorModal` (slider + numeric input, live preview, per-instance
  colour) and persisted with the workspace.

### 7.3 Grid views & sync (1x1 · 2x1 · 2x2)

* Layouts come from `CHART_LAYOUTS`; every pane has its own token and (optional) timeframe
  override, otherwise the global timeframe applies.
* `src/lib/chart-sync.ts` is a module-singleton bus: visible-range and crosshair events are
  re-broadcast to all mounted charts with a source tag so echoes terminate (no feedback loops).
  Toggles: `syncZoom`, `syncCrosshair`, `syncTimeframe`.
* Crosshair sync uses synthetic `subscribeCrosshairMove` primitives because v5 removed
  `setCrosshairPosition`; zoom sync uses `setVisibleLogicalRange`.

### 7.4 Drawing tools

Trend line · ray · segment · horizontal line · Fibonacci retracement · rectangle/support zone.
Drawings are stored in **data space** (timestamp + price, never pixels) in
`localStorage['nc-chart-v1']`, survive zoom/pan/reload and are rendered by an
`ISeriesPrimitive` pane view attached to the price series. PNG export includes them.

### 7.5 Mobile gate

`src/lib/device.ts` detects touch hosts (pointer/coarse media queries + UA + viewport). On touch
devices the toolbar shows the warning *"Complex drawing is not recommended on touch screens"*,
the tools stay hidden/locked until **Force enable** is pressed (both the warning dismissal and
the force flag persist per device).

### 7.6 Browser seeding & the CORS reality

Browsers enforce CORS on `fetch`, while WebSocket connections follow different browser rules.
Some configured CEX history endpoints have returned no `Access-Control-Allow-Origin` header in
prior probes; CORS behavior can change. The first-party proxy is allowlisted for selected public
APIs and does not make every exchange history endpoint readable.

1. `exchangeProbe` treats a CORS rejection as inconclusive and can fall back to a WebSocket
   handshake probe. That result indicates connection reachability at probe time, not data quality
   or execution latency.
2. `CexSocketManager.seedWithFallback()` can use a configured CORS-friendly venue to seed history
   when the selected venue's REST history is unavailable in the browser. If the chosen venue's
   WebSocket connects, later updates come from that stream; the status chip reports a substitute
   seed where one was used. Both the seed and live feed can still fail or differ.

Channels added to an already-open socket are seeded explicitly because they do not receive that
socket's initial open callback.

### 7.7 Verification

* `npm run smoke` → `chart-smoke` (85 assertions): indicator math vs references, alignment,
  Heikin-Ashi, precision bands, sync bus echo-guard, drawing geometry + persistence, device gate.
* `node scripts/ad-slots-check.mjs` (dev-only): builds with the `public/ads-dev/*`
fixture scripts and proves both containers per device – desktop rail filled +
mobile hidden, mobile strip filled + desktop hidden, per-device social bar and
popunder, and the lazy injection after crossing the breakpoint.
* `node scripts/browser-check.mjs` (dev-only, headless Chrome): canvases mount, live candles
  arrive, watermark pixels present in-canvas, indicator modal adds EMA/RSI/MACD with editable
  parameters, oscillator panes spawn, trend line drag persists, 2x2 grid + zoom/timeframe sync,
  mobile warning + force-enable, reload persistence, CORS inventory. Screenshots in `artifacts/`.

---

## 8. On-chain signals from public providers

Toolbar toggle **ON-CHAIN** (Radar icon) docks a right-hand panel with provider-supplied network,
market, and token data. Selected requests use direct provider endpoints or the first-party
serverless proxy. The panel refreshes while open; refresh intervals below are targets, not freshness
or availability guarantees. When a request fails, a group can show an offline state or a prior
reading, so check its status and timestamp.

| Group | Source | Signals | Refresh |
| --- | --- | --- | --- |
| Bitcoin | `mempool.space` | unconfirmed tx, mempool size, fee estimates (express/30 min/economy sat/vB), difficulty adjustment Δ, avg block time | 60 s |
| EVM networks | `eth/base/arbitrum/polygon.blockscout.com` | gas slow→fast (gwei), block utilisation, tx today, avg block time, coin price Δ24h, chain TVL (Base) | 60 s |
| Solana | `solana-rpc.publicnode.com` (batched JSON-RPC) | slot, total TPS, non-vote (user) TPS | 45 s |
| DeFi capital | `api.llama.fi` + `stablecoins.llama.fi` | total TVL + 24 h Δ, global stablecoin supply, top-6 chains by TVL | 5 min |
| DEX heat | `api.geckoterminal.com` + `api.dexscreener.com` | trending pools (eth/solana/base/bsc, h24 Δ + volume), top boosted tokens | 2 min |
| Token forensics | `api.gopluslabs.io` | holder count, buy/sell tax, top-10 holder share, locked LP share, mintable/honeypot badge — for the active DEX token | 10 min |

Implementation notes: `src/api/onchain.ts`, `src/store/useOnChainStore.ts`, and
`src/components/onchain/OnChainPanel.tsx`. Selected public API and RPC requests use the bounded,
allowlisted route in `src/app/api/proxy/[provider]/route.ts`; other public feeds may be requested
directly. Route timeouts and response-size limits reduce exposure but do not guarantee provider
availability or freshness. Public provider limits can change.

---

## 9. Market metrics and locally calculated chart tools

The **PRO** panel presents selected provider metrics when available. Some Pro features require
qualifying on-chain support verified on supported networks; core charting has no recurring
subscription. Provider outages, caching, regional restrictions, pair support, and endpoint limits
can affect data. Ratios, snapshots, model outputs, and chart simulations are descriptive or
heuristic and are not financial advice or a guarantee of future results.

| Group | Source | Signals | Refresh |
| --- | --- | --- | --- |
| Derivatives | `api.gateio.ws` + `www.okx.com` | funding rate (+ annualised), **next-funding countdown**, mark/index + premium %, open interest (USD), long/short (accounts / taker / top traders), liquidations per 5 m (long vs short), **OI / L-S-taker / funding-history sparklines** (30 × 5 m stats + 24 × 8 h settled funding) | 60 s |
| Order flow | `api.gateio.ws` book + **live tape** | best bid/ask, spread (bps), book imbalance (top 50 levels), **cumulative depth chart** (±0.5 % around mid, SVG), session **CVD** + Δ60 s from the whale trade stream (throttled 600 ms) | 15 s |
| Market breadth | Gate, with OKX fallback | Advancers/decliners and median 24 h change across pairs returned by the selected provider; returned coverage varies. | 5 min target |
| Global market | `api.coingecko.com` + `api.alternative.me` | total market cap + 24 h Δ, volume, BTC/ETH dominance, coin count, Fear & Greed + 14-day sparkline | 5 min |
| Heatmap | `api.gateio.ws` spot tickers | top-28 USDT pairs as intensity tiles (change × volume) | 5 min |
| Options & IV | `www.deribit.com` | Provider-reported volatility and option fields; max-pain, smile, and term-structure values are computed from returned instruments and model assumptions. Coverage can be partial. | 10 min target |

Implementation: `src/api/prometrics.ts`, `src/store/useProStore.ts` (same
open-only-fetch lifecycle as the on-chain panel), `src/components/pro/ProMetricsPanel.tsx`.
CVD uses `tradeBus` in `src/websockets/manager.ts` rather than a separate HTTP request; it depends on an active trade feed and its coverage.

### Additional chart tools (computed locally where applicable)

* **Volume Profile Visible Range** – chip `VP`: estimates volume by price from the loaded
  candle data in the visible range, with POC and 70% value-area levels. It is not a full
  trade-by-trade volume profile.
* **Anchored VWAP** – chip `aVWAP`: arm, click a candle, get the session VWAP
  from that anchor (click chip cycles arm → anchored → cleared).
* **Indicator library + Script Lab** (instance limits depend on the workspace): the 7 classic kinds plus
  Supertrend, Keltner, Donchian, Parabolic SAR, StochRSI, OBV, MFI, CCI,
  ADX/DMI, TRIX, PPO, DPO, Bollinger %B, Aroon – wave 2: **Ichimoku Cloud,
  VWAP, Williams %R, Hull MA, TEMA, DEMA, Guppy MMA (6-EMA ribbon), TTM
  Squeeze, TD Sequential, Chaikin Money Flow, Ease of Movement, Ultimate
  Oscillator** – and wave 5: **CUSTOM (Script Lab formulas)** – all with
  parameter modals, all computed locally.
* **Script Lab** – toolbar chip `Skripte` (or the CUSTOM tile in the indicator
  modal): write per-candle formulas (`o h l c v` plus `ema sma rsi atr stoch
  vwap highest lowest change` + math helpers), test them against the loaded
  buffer (last/min/max), save up to 50 locally, import from HTTPS raw URLs that
  permit browser CORS access – `github.com/…/blob/…` and gist links are rewritten to their raw
  hosts automatically (≤20 KB) – and plot the result as its own pane or as a
  price overlay. Engine: `src/lib/scripts.ts` (`new Function` sandbox without
  DOM/network bindings, 4000-char cap, memoised helper series); UI:
  `src/components/tools/ScriptLabModal.tsx`. Script formulas are user-provided code executed in a
  browser-side sandbox; the sandbox is best-effort isolation, not a security boundary.
* **Auto support/resistance** – chip `S/R Auto`: clusters pivot points from loaded candles using
  configured rules and displays historical levels and touch counts. Levels can fail and are not
  guaranteed support or resistance.
* **RSI divergence markers** – chip `Divergenzen`: compares price and RSI(14) pivots in loaded
  candles and renders heuristic markers. A divergence may persist and does not confirm a reversal.
* **Price alerts** – chip `Alert`: client-side alert lines and notifications while the terminal is
  open and receiving updates. Feed delays, browser suspension, or a closed tab can delay or prevent
  an alert. Alerts are session-only.
* **Compare overlay** – `Vergleich` select: a supported CEX symbol can be shown as a normalized
  percentage line when its feed is available.
* **Session strip** – today's UTC change %, range-position marker and
  annualized **realized volatility** straight from the candle buffer
  (`sessionStats()` / `realizedVolPct()`).
* **Bar replay** – chip `Replay`: steps through candles already loaded in the chart buffer and
  recomputes enabled indicators and overlays on the visible slice. It does not fetch missing history.
* **Strategy lab (backtester)** – chip `Backtest`: six candle-based strategy simulations with
  configured fees and summary statistics. Results use simplified fills and omit factors such as
  slippage, funding, liquidity, and real execution; historical simulations do not predict results.
* **Market screener** – chip `Screener`: filters and sorts returned Gate USDT spot rows (up to
  150 shown by the interface). Pair coverage, refresh success, and chart history depend on the
  provider and selected instrument.
* **Watchlist** – chip `Watchlist`: saves supported symbols locally and reuses available market
  feeds. Quote freshness, saved-item limits, and provider availability depend on the current app
  configuration and browser storage.
* **Risk & position calculator** – chip `Risk`: derives size, notional, margin, R:R, and account
  impact from user inputs (`src/lib/risk.ts`). This is a calculator, not an execution estimate or
  financial recommendation; actual fills, fees, and losses may differ.
* **Chart controls** – log and percent price scales, an estimated bar-close countdown, a baseline
  chart type, and OHLCV CSV export per pane.
* **DEX candles** – supported DEX tokens can use GeckoTerminal OHLCV history. Pool coverage,
  available intervals, history depth, rate limits, and refresh timing depend on the provider.

---

## 10. Keyboard map

| Keys | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` | command palette (navigation, layout, theme, language, actions) |
| `1` `2` `3` | chart layout 1x1 / 2x1 / 2x2 |
| `?` | help center |
| `/` | focus help search |
| `Esc` | close any overlay |

---

## 11. Access, advertising, and support

Core charting is available without an account or recurring subscription. Third-party ads and
sponsored links may appear on designated surfaces and may lead to external sites with their own
content and terms. Two themes unlock when a prepared X or Telegram composer opens; the app does not
verify that a post is published. Selected Pro features require a qualifying on-chain support
transaction verified on supported networks. A self-reported support badge is cosmetic and does not
verify payment or unlock Pro. Local JavaScript and browser storage can be inspected or modified, so
local export markers are best-effort deterrence, not secure DRM. Provider, hosting, and ad-network
availability and terms can change.

### 11.1 Third-party ads (AdManager)

Environment variables in `.env.example` can override ad placements. Several delivery URLs are
also bundled as source defaults, so an empty deployment environment does not necessarily disable
third-party requests. Check the production build configuration before launch.

The UI separates mobile and desktop ad containers where configured; a specific device placement can
be supplied for each slot, with supported shared/default fallbacks:

| Container / format | Desktop (≥ lg) | Mobile (< lg) |
| --- | --- | --- |
| Native Banner | right rail beside the grid (`data-ad-slot="desktop"`) | horizontal strip between toolbar and grid (`data-ad-slot="mobile"`) |
| Social Bar | `NEXT_PUBLIC_ADSTERRA_SOCIALBAR_DESKTOP` | `…_SOCIALBAR_MOBILE` |
| Popunder (2x1/2x2 gesture) | `NEXT_PUBLIC_ADSTERRA_POPUNDER_DESKTOP` | `…_POPUNDER_MOBILE` |
| Native placement | `NEXT_PUBLIC_ADSTERRA_NATIVE_DESKTOP` | `NEXT_PUBLIC_ADSTERRA_NATIVE_MOBILE` |

Visibility is pure CSS (`hidden lg:block` / `lg:hidden`), so rotation and
resize flip instantly; the *injection* follows the same breakpoint via
`matchMedia` and lazy-loads the other placement when a visitor crosses it
(proven by `scripts/ad-slots-check.mjs`, incl. the resize flip). The legacy
single-value variables (`…_NATIVE`, `…_SOCIALBAR`, `…_POPUNDER`) still work as
fallback for both devices. `NEXT_PUBLIC_*` values are inlined at build time –
set them in the Cloudflare dashboard **before** building.

`src/lib/ads/adsterra.ts` injects configured scripts from client-side effects; third-party scripts
may change the DOM or fail to load, so test the deployed page. Containers track their placement to
avoid duplicate injection during breakpoint changes. Unfilled slots can retain a visible sponsored
label. The popunder is attempted from configured user interactions and is subject to browser and
provider behavior. Current source defaults include Adsterra delivery URLs; use build-time overrides
or change the defaults if a deployment should not request those third parties.

### 11.2 Ad-block prompt and support

`src/lib/ads/adblock.ts` checks for blocked ad resources and may show a support prompt after the
initial render. Detection can be imperfect; dismissing the prompt or making a self-reported support
claim is not on-chain verification. The prompt is separate from core chart access and from the Pro
support-verification flow.

* A self-reported support choice sets a local cosmetic badge and reminder cooldown. It does not
  verify a transaction and does not grant Pro access. The separate donation-verification route
  checks supported public-chain transactions against configured recipients and confirmation rules;
  availability and provider responses can affect verification.
* **Dismiss** → 7-day cooldown (`wallDismissedAt`).
* Three donation wallets (SOL / BTC / ETH) with copy-to-clipboard (Clipboard API
  + `execCommand` fallback) and neon "Copied!" feedback.
* `?adwall=1` force-opens the wall (used by the browser proof and for demos).

### 11.3 Share-composer theme unlock

The **Share** modal prepares localized text and a deep link for X or Telegram. When the user opens
either composer, the browser unlocks Matrix Green and Miami Vice locally. NodeChart does not check
whether the user publishes a post, and local browser state can be edited or cleared. Shared links
may include a ticker and a price snapshot from the time of sharing; the value can become stale and
is not a current quote.

### 11.4 Themes

`[data-theme='matrix']` (phosphor CRT, heavy scanlines) and
`[data-theme='miami']` (sunset noir pink/cyan) are full token sets in
`globals.css`; `chart-theme.ts` derives the lightweight-charts options from the
same CSS variables, so candles, watermark and drawings recolour instantly.

### 11.5 Open-Graph card (`/api/og`)

`generateMetadata` on `/terminal` points social metadata at `/api/og`. The serverless handler
renders a 1200×630 SVG from sanitized ticker/price parameters. A displayed price is explicitly
labelled as a share-time snapshot; feed availability and social-platform rendering vary.

### 11.6 Verification

`chart-smoke` covers share text, intent URLs, OG sanitization, theme gating, and the local unlock
state. Browser checks exercise the prompt, share composer, and social card when their test setup is
available; those checks do not validate provider uptime or whether a user publishes a post.

---

## 12. Security hardening & test matrix

Hardening pass (audited + fixed, all gates re-run green):

| Area | Measure |
| --- | --- |
| Network | `boundedJson()` in `src/api/http.ts` caps every JSON response at **4 MiB** (content-length pre-check + streaming `TextDecoder` guard → `HttpError(413)` on overflow). Timeouts were already in place. |
| localStorage | All three zustand persist stores (`useAppStore`, `useChartStore`, `useViralStore`) have `merge` **sanitizers**: hostile/corrupted payloads (bad theme, layout, timeframe, panes, indicators, drawings, flags) are field-validated against the real enums/validators and fall back to safe values instead of crashing or injecting state. |
| Theme boot | `ThemeBootScript.tsx` re-validates the persisted theme against an allowlist regex before touching `documentElement` (no injection via storage). |
| Headers | `next.config.mjs` sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a restrictive `Permissions-Policy`. **No `X-Frame-Options`/`frame-ancestors`** on purpose: the terminal is meant to be embeddable (previews/widgets). Add them if you deploy a hardened instance. |
| Public dir | Ad test fixtures live in `scripts/fixtures/ads-dev/` (never shipped). `ad-slots-check.mjs` copies them into `public/` only for the proof run. Note: `next start` snapshots `public/` at boot — copy fixtures **before** starting the server. |
| Sharing | Share modal encodes tweet/URL (`encodeURIComponent`), popups use `noopener`; clipboard via in-page stub in tests. |
| Deps | `npm audit --omit=dev`: **0 vulnerabilities**. The 3 dev-only highs sit in `sharp` under `miniflare` ← `wrangler` (local Cloudflare emulator, never shipped, never processes untrusted input). Not force-fixed: `audit fix --force` would pull `wrangler` outside the range supported by `@opennextjs/cloudflare` 1.20.6. |

Historical test counts below are from an earlier audit snapshot, not this accuracy-copy revision.
Run the listed checks against the current checkout before release; a prior PASS does not validate
current copy, provider availability, or deployment configuration.

Test matrix (historical snapshot):

| Gate | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | 0 errors |
| Lint | `npx eslint src` | 0 errors |
| i18n parity | `node scripts/check-i18n.mjs` | 1098 keys × 5 locales |
| Unit/smoke (Node) | `npm run smoke` | ws + api + chart smoke ✔ (**211 chart checks** incl. all 34 indicator kinds, wave-2 oscillator maths, S/R clustering, divergence scanner, realized vol, session stats, alert store, **backtester fee/equity/marker proofs for all 6 strategies, risk maths**, **wave-5 script engine: helper maths vs references, error taxonomy, GitHub/gist raw-URL rewriting, script storage cap, CUSTOM store flow, hostile-persist script healing**; 7 live on-chain sources; live PRO-metric checks; **wave-7 edge-smoke: 41 checks** over Liq Radar bucket maths/placement, lead-lag lag+beta+pending pulse, regime classification/drivers/history, seasonality significance gates, edge store flags + persistence) |
| Browser E2E | `node scripts/browser-check.mjs` | **169/169** (on-chain panel, PRO panel incl. countdown/sparklines/depth/breadth/smile/term, VP/aVWAP, S/R + divergence + alert + compare chips, session strip, 12 wave-2 indicators in the modal, replay transport + stepping + playback, strategy lab + markers, 150-row screener, risk calculator, watchlist popover, log/% axes, bar countdown, tip jar + celebration ribbon + usage nudge, wave-4 tools: pattern scanner + marker toggle, ratings matrix, heatmap treemap + tile-load, journal entry + stats, bar magnifier, alert create/persist, Renko & P&F switches, custom 7m legend, **wave-5: `www.NodeChart.cc` watermark attribute, Script Lab open/test/syntax-error/apply → CUSTOM legend chip, CUSTOM tile → lab routing, help center 34 indicator + 42 metric + 3 script docs with badges & search**, **wave-6: toolbar dropdown menus (role=menu, escape/outside close, aria-pressed toggles) + menu-routed tool flows**, **wave-7: Edge menu with all four engines, Liq Radar modal + `data-liq-radar` canvas flag toggle, Lag Oracle live stats + CEX leader select, Regime Compass readout, Clock Edge heatmaps, help Edge-Suite category (4 topics)**, landing survival section + wave-4/5/7 feature grids, DEX candles) |
| SEO audit (2. Sicht) | `node scripts/seo-audit.mjs` | **90/90** (fetch-basiert, unabhängig von `seo-check.mjs`: Titel-/Description-Länge, Canonical, hreflang-Netz 5+x-default, OG + Locale-Alternates, Twitter-Card, robots-Meta, JSON-LD-Typen, eine h1, interne Links; Hilfe: FAQPage+DefinedTermSet+BreadcrumbList; Legal-Breadcrumbs; Terminal indexierbar; robots.txt, Sitemap 30 URLs + Alternates, llms.txt) |
| Ad containers | `node scripts/ad-slots-check.mjs` (fixture build :3001) | 13/13 |
| Wave-7 QA (modular) | `npm run edge:smoke` + `node scripts/qa-edge-visual.mjs <step>` + `node scripts/qa-i18n-usage.mjs` | **steps 1–10 green (series complete; Step-Protokoll in der Git-Historie)**: Liq Radar 22 engine + 22 browser checks (pixel proof of magnet bands + leverage tags, modal DOM, persistence, sanitizer); Lag Oracle 20 engine + 16 browser checks (beta/hit-rate reconstruction, pulse gates, kline-subscribe lifecycle: leader feed only while the modal is open, unsubscribe on switch/close); Regime Compass 19 engine + 10 browser checks (precedence rules, boundary 80, history windowing, recommendation buttons proven to flip real tool toggles); Clock Edge 16 engine + 11 browser checks (bucket accounting, t-gate positive+negative, now-ring uniqueness, computed tint proof); Edge menu/toolbar 17 browser checks (ARIA semantics, engaged neon lifecycle, viral nudge, 1280/1024/768 layout integrity after a pre-existing header-wrap fix); primitive lifecycle 9 browser checks (setSource(null) clears every band row, theme-palette tint fingerprint acid→matrix→acid, 2x2 all-pane painting, chart-type re-attach, resize); i18n browser sweep 40/40 (5 locales × menu, four modals, help category, landing feature, zero intl errors); mobile & graceful failure 13/13 (390px gate + four modals fit/scroll, total feed outage via patched fetch/WebSocket → pane placeholder + need-hints in all four modals, armed magnets paint nothing, zero crashes); full regression sweep green (tsc, eslint, i18n parity 1098×5, production build, ws/api/chart/edge smoke, beta 30/30, browser-check 169, seo audit); docs & artifacts audit green (feature matrix, 4×5 edge help topics, screenshot inventory, donation-doctrine consistency); 62/62 edge i18n keys ×5 |
| Beta journeys | `npm run beta` (fresh profiles: 5 locales × 4 routes, desktop/mobile newcomer, on-chain + PRO panels incl. wave-2 cards, S/R + divergence + alert tools, ad-block soft-wall, share-unlock, deep link + OG, 404/unknown-locale/hostile-param) | **30/30** |

---

## 13. SEO programme (systematic, audited)

These are implementation notes, not promises of search ranking or rich-result display. Re-run the
SEO checks against the current production build after copy or metadata changes.

1. **Language metadata** – routes emit canonical and `hreflang` alternates for the configured
   locales; the presence of these tags does not guarantee indexing or ranking. Social metadata
   includes locale fields where configured.
2. **Metadata** – per-locale titles, descriptions, robots directives, Twitter cards, and the
   dynamic `/api/og` route are implemented. Search engines may rewrite snippets or choose not to
   index a route; terminal parameter variants have separate indexing rules.
3. **Structured data** (`src/lib/jsonld.ts` + `<JsonLd/>`): localized Organization, WebSite, and
   SoftwareApplication descriptions; the landing feature list includes the implemented access
   details. Help and legal routes include FAQ, glossary, and breadcrumb entities. Markup describes
   page content but does not guarantee a rich result.
4. **Visible content** – localized landing copy and a static Help centre describe access, provider
   coverage, tools, and limitations. Structured data is generated from visible localized content
   where applicable; no competitor pricing comparison is used as a feature claim.
5. **Crawler configuration** – `robots.ts`, `sitemap.ts`, semantic landmarks, localized page
   metadata, and `llms.txt` provide site information. Crawlers and answer engines decide how to
   use it; no citation, indexing, or performance outcome is guaranteed.
6. **Rendering and third parties** – static generation is used where configured; terminal/API
   routes may use serverless compute. Third-party ad and data-provider requests can occur on
   designated surfaces and are subject to their own behavior.

## 14. Edge Suite (wave 7) — locally calculated research tools

These tools calculate heuristic outputs from loaded candles and, where enabled, provider metrics.
They do not use exchange liquidation-position data and do not forecast or guarantee market moves.
Source feeds can be delayed, incomplete, or unavailable.

| Engine | What it does | Where |
| --- | --- | --- |
| **Liq Radar** | Estimates hypothetical liquidation-price bands from recent loaded candles and volume for configured leverage settings. The bands are a model, not reported exchange positions or verified liquidation levels. | `src/lib/liqradar.ts`, `LiqMagnetPrimitive` in `primitives.ts` |
| **Lag Oracle** | Compares a chart with an available leader feed to calculate sample lag, correlation, beta, and threshold events. The pulse is a heuristic based on past candle relationships, not a forecast of a follower's price. | `src/lib/leadlag.ts` |
| **Regime Compass** | Combines candle-derived indicators and available provider metrics into one of five heuristic regimes with drivers, a history strip, and tool suggestions. Scores are not probabilities or safety assessments. | `src/lib/regime.ts` |
| **Clock Edge** | Groups loaded candles by UTC hour and weekday and summarizes historical returns with configured sample-size/statistic filters. Historical patterns can be noisy and do not predict future performance. | `src/lib/seasonality.ts` |

All four live behind the neon **Edge** dropdown in the toolbar row
(`ToolMenu id="edge"`), are documented in the help center (category
"Edge Suite", 4 topics × 5 locales) and smoke-tested by
`scripts/edge-smoke.entry.ts` (41 offline checks, part of `npm run smoke`).

---

## 15. Roadmap (next parts)

* **Part 2 ✅ shipped** — CEX WebSocket manager (Binance/Bybit/OKX + reconnect + seeding),
  DEX REST aggregator (DexScreener + GeckoTerminal), Smart Search with security audits,
  rate-limit glitch overlay, whale ticker, `useMarketStore` / `useWhaleStore` / `useRateLimitStore`.
* **Part 3 ✅ shipped** — coverage explosion: **12 CEX adapters** (incl. derived candles for
  Coinbase/KuCoin/CoinEx), REST seeds for all of them, 33-chain DEX registry, honeypot.is as a second
  audit opinion, region-aware venue ranking + live latency probe + `<ExchangePicker/>`,
  `useExchangeStore` / `useExchangeSelection`, `proxy.ts` country cookie, 96 smoke assertions.
* **Wave 3 ✅ shipped** – bar replay, a strategy-lab simulation, a provider-fed screener (up to
  150 rows shown), watchlist, risk calculator, CSV export, log/% axes, and bar-close countdown;
  plus support prompts and a cosmetic self-reported badge – see §9 and `src/components/support/`.
* **Wave 4 ✅ shipped** – additional chart types, heuristic pattern markers, a multi-timeframe
  technical summary, a market heatmap, trade-tape view where provider history is available,
  browser-side alerts, a local trade journal, custom intervals, regional source fallbacks, and
  support prompts – see §9, §11 and `src/components/tools/`.
* **Wave 5 ✅ shipped (scripting & docs)** – canvas-integrated `www.NodeChart.cc` watermark
  (`data-watermark` is a test hook, not DRM), the **Script Lab** for per-candle formulas, HTTPS
  raw imports where browser CORS permits, local storage, and CUSTOM overlays; plus localized Help
  entries for the configured indicator and market-metric set, plus the lab – see §7.1, §9 and
  `src/lib/scripts.ts`, `src/components/tools/ScriptLabModal.tsx`, `src/components/help/`.
* **Wave 7 ✅ shipped (Edge Suite)** – four in-house heuristic research views from loaded candles
  and available provider data: **Liq Radar** (modelled liquidation-price bands, not exchange
  positions), **Lag Oracle** (sampled leader/follower statistics), **Regime Compass** (rule-based
  market labels and tool suggestions), and **Clock Edge** (historical hour/weekday summaries).
  Outputs are not forecasts or guarantees; see §14.
* **Wave 6 ✅ shipped (navigation and metadata)** – the terminal toolbar uses accessible dropdown
  menus (`ToolMenu`, `role="menu"`, keyboard dismissal, and pressed states) and the site includes
  localized metadata, JSON-LD, Help content, breadcrumbs, and `llms.txt`. QA scripts cover these
  structures; they do not guarantee indexing, rankings, rich results, or citations – see §13.
* **Part 4 ✅ shipped (chart engine)** — `lightweight-charts` canvas terminal with a chart watermark,
  editable indicators (technicalindicators) including oscillator panes, 1x1/2x1/2x2
  grid with zoom/crosshair/timeframe sync, data-space drawing tools with persistence, mobile
  force-enable gate, CORS-aware browser seeding; browser-verified via Puppeteer (§7).
* **Monetization ✅ shipped** — third-party Adsterra ad placements and sponsored links, an
  ad-block prompt, donation wallets, composer-triggered theme unlocks, and the share card (§11).
  Bundled ad defaults and external-provider behavior are described above.
* **Part 5 (planned)** — order book + depth ladder, optional KV-backed watchlist sync (subject to
  platform availability and plan limits), and other research features.

---

## 16. License — All Rights Reserved (proprietär)

NodeChart ist **keine** Open-Source-Software. Copyright © 2026 AndrexTheDev,
**alle Rechte vorbehalten** (`LICENSE.md`, `package.json: "license":
"UNLICENSED"`, Copyright-Header in jeder Quelldatei):

* Der Code ist auf GitHub **einsehbar** (Transparenz ist Projektdoktrin) —
  darüber hinaus wird **kein Nutzungsrecht** eingeräumt: kein Kopieren, kein
  Modifizieren, keine Derivate, keine Weiterverbreitung, **kein Betreiben
  eigener Instanzen oder SaaS-Klone** ohne schriftliche Genehmigung.
* Namen/Logo/„www.NodeChart.cc"-Wasserzeichen sind markenrechtlich geschützt
  und dürfen nicht entfernt oder geändert werden.
* Verbaute Third-Party-Bibliotheken (Next.js, React, Tailwind, lightweight-charts,
  …) bleiben unter ihren Original-Lizenzen (MIT/Apache-2.0/…) — die Vorbehalte
  gelten ausschließlich für den Eigencode dieses Repos.
* Lizenzanfragen: hippie.highho@gmail.com

## Contact

**AndrexTheDev** — [hippie.highho@gmail.com](mailto:hippie.highho@gmail.com)
