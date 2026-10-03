// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { fetchJson } from '@/api/http';
import { dexscreenerByToken } from '@/api/dexscreener';
import { fetchDexCandles } from '@/api/geckoterminal';
import { isCexExchange } from '@/store/useExchangeSelection';
import type { Token, Timeframe } from '@/store/types';
import type { Candle, ExchangeId } from '@/websockets/types';
import { fetchSeed } from '@/websockets/rest';

const DEFILLAMA = 'https://api.llama.fi';
const BINANCE_PUBLIC = 'https://data-api.binance.vision/api/v3';
const TREND_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];
const USD_QUOTES = ['FDUSD', 'USDT', 'USDC', 'BUSD', 'TUSD', 'USDP', 'DAI', 'USD'];

export interface VolumeComparison {
  dexVolumeUsd: number;
  binanceSpotVolumeUsd: number;
  dexToBinanceRatio: number;
  updatedAt: number;
  dexSource: 'DeFiLlama';
  cexSource: 'Binance Spot';
}

export type TrendDirection = 'bullish' | 'bearish' | 'mixed' | 'unavailable';

export interface TrendReading {
  timeframe: Timeframe;
  direction: TrendDirection;
  fastEma: number | null;
  slowEma: number | null;
  close: number | null;
  candleCount: number;
}

export interface ProtocolTvlPoint {
  date: number;
  value: number;
}

export interface ProtocolTvl {
  status: 'ok' | 'unmatched' | 'ambiguous';
  protocolName: string | null;
  protocolSlug: string | null;
  points: ProtocolTvlPoint[];
}

export interface CrossChainSpreadRow {
  chain: string;
  dex: string;
  pairAddress: string;
  priceUsd: number;
  cexPriceUsd: number;
  spreadPct: number;
  liquidityUsd: number;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  url: string | null;
}

export interface CrossChainSpread {
  cexPriceUsd: number | null;
  cexSource: string;
  rows: CrossChainSpreadRow[];
}

interface LlamaDexVolume {
  total24h?: number | null;
}

interface BinanceTicker24h {
  symbol?: string;
  quoteVolume?: string | number;
}

interface BinancePrice {
  price?: string;
}

interface LlamaProtocol {
  name?: string;
  slug?: string;
  symbol?: string;
  tvl?: number;
}

interface LlamaProtocolHistory {
  tvl?: { date?: number; totalLiquidityUSD?: number }[];
}

function finitePositive(value: unknown): number | null {
  const result = typeof value === 'string' ? Number(value) : value;
  return typeof result === 'number' && Number.isFinite(result) && result > 0 ? result : null;
}

export function marketCapToFdvPercent(marketCapUsd: unknown, fdvUsd: unknown): number | null {
  const marketCap = finitePositive(marketCapUsd);
  const fdv = finitePositive(fdvUsd);
  return marketCap != null && fdv != null && marketCap <= fdv ? (marketCap / fdv) * 100 : null;
}

export function isHighDilutionRisk(ratioPercent: number | null): boolean {
  return ratioPercent != null && Number.isFinite(ratioPercent) && ratioPercent < 50;
}

export async function fetchVolumeComparison(signal?: AbortSignal): Promise<VolumeComparison> {
  const [dex, tickers] = await Promise.all([
    fetchJson<LlamaDexVolume>(`${DEFILLAMA}/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`, {
      source: 'defillama:dex-volume', cacheTtlMs: 60_000, signal,
    }),
    fetchJson<BinanceTicker24h[]>(`${BINANCE_PUBLIC}/ticker/24hr`, {
      source: 'binance:spot-24h-volume', cacheTtlMs: 60_000, signal,
    }),
  ]);

  const dexVolumeUsd = finitePositive(dex.total24h);
  if (!dexVolumeUsd || !Array.isArray(tickers)) throw new Error('24-hour volume is unavailable.');

  // Sum only US-dollar-pegged quote assets. The result is explicitly Binance
  // Spot coverage, not a claim about total CEX volume across the market.
  const binanceSpotVolumeUsd = tickers.reduce((sum, ticker) => {
    const symbol = String(ticker.symbol ?? '').toUpperCase();
    const quote = USD_QUOTES.find((candidate) => symbol.endsWith(candidate) && symbol.length > candidate.length);
    const volume = finitePositive(ticker.quoteVolume);
    return quote && volume ? sum + volume : sum;
  }, 0);
  if (!Number.isFinite(binanceSpotVolumeUsd) || binanceSpotVolumeUsd <= 0) {
    throw new Error('Binance Spot volume is unavailable.');
  }

  return {
    dexVolumeUsd,
    binanceSpotVolumeUsd,
    dexToBinanceRatio: dexVolumeUsd / binanceSpotVolumeUsd,
    updatedAt: Date.now(),
    dexSource: 'DeFiLlama',
    cexSource: 'Binance Spot',
  };
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const alpha = 2 / (period + 1);
  let current = seed;
  for (let index = period; index < values.length; index += 1) {
    current = values[index]! * alpha + current * (1 - alpha);
  }
  return Number.isFinite(current) ? current : null;
}

function readTrend(timeframe: Timeframe, candles: Candle[]): TrendReading {
  const closes = candles.map((candle) => candle.c).filter((value) => Number.isFinite(value) && value > 0);
  const fastEma = ema(closes, 20);
  const slowEma = ema(closes, 50);
  const close = closes.at(-1) ?? null;
  if (fastEma == null || slowEma == null || close == null) {
    return { timeframe, direction: 'unavailable', fastEma, slowEma, close, candleCount: closes.length };
  }
  const direction = close > fastEma && fastEma > slowEma
    ? 'bullish'
    : close < fastEma && fastEma < slowEma
      ? 'bearish'
      : 'mixed';
  return { timeframe, direction, fastEma, slowEma, close, candleCount: closes.length };
}

async function fetchCexCandles(token: Token, timeframe: Timeframe, signal?: AbortSignal): Promise<Candle[]> {
  const preferred = isCexExchange(token.exchange) ? token.exchange : 'binance';
  const exchanges = [...new Set<ExchangeId>([preferred, 'binance', 'bybit', 'okx', 'gate'])];
  for (const exchange of exchanges) {
    try {
      const candles = await fetchSeed({ exchange, symbol: token.symbol, timeframe });
      if (candles.length >= 50) return candles;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return [];
}

async function candlesFor(token: Token, timeframe: Timeframe, signal?: AbortSignal): Promise<Candle[]> {
  if (token.venue === 'DEX' && token.chain && token.contract) {
    return await fetchDexCandles(token.chain as import('@/lib/chains').ChainId, token.contract, timeframe, signal) ?? [];
  }
  return fetchCexCandles(token, timeframe, signal);
}

export async function fetchTrendRadar(token: Token, signal?: AbortSignal): Promise<TrendReading[]> {
  return Promise.all(TREND_TIMEFRAMES.map(async (timeframe) => {
    try {
      return readTrend(timeframe, await candlesFor(token, timeframe, signal));
    } catch (error) {
      if (signal?.aborted) throw error;
      return readTrend(timeframe, []);
    }
  }));
}

export async function fetchProtocolTvl(symbol: string, signal?: AbortSignal): Promise<ProtocolTvl> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return { status: 'unmatched', protocolName: null, protocolSlug: null, points: [] };

  const protocols = await fetchJson<LlamaProtocol[]>(`${DEFILLAMA}/protocols`, {
    source: 'defillama:protocol-index', cacheTtlMs: 30 * 60_000, signal,
  });
  const matches = (Array.isArray(protocols) ? protocols : [])
    .filter((protocol) => protocol.symbol?.trim().toUpperCase() === normalized && typeof protocol.slug === 'string' && protocol.slug.length > 0);
  if (matches.length === 0) return { status: 'unmatched', protocolName: null, protocolSlug: null, points: [] };
  if (matches.length > 1) return { status: 'ambiguous', protocolName: null, protocolSlug: null, points: [] };

  const protocol = matches[0]!;
  const slug = protocol.slug!;
  const history = await fetchJson<LlamaProtocolHistory>(`${DEFILLAMA}/protocol/${encodeURIComponent(slug)}`, {
    source: `defillama:protocol-tvl:${slug}`, cacheTtlMs: 30 * 60_000, signal,
  });
  const cutoff = Math.floor(Date.now() / 1000) - 120 * 24 * 60 * 60;
  const points = (history.tvl ?? [])
    .map((point) => ({ date: Number(point.date), value: Number(point.totalLiquidityUSD) }))
    .filter((point) => Number.isFinite(point.date) && point.date >= cutoff && Number.isFinite(point.value) && point.value >= 0);
  return {
    status: points.length > 1 ? 'ok' : 'unmatched',
    protocolName: protocol.name ?? slug,
    protocolSlug: slug,
    points,
  };
}

async function fetchBinanceSpotPrice(base: string, signal?: AbortSignal): Promise<number | null> {
  const cleanBase = base.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleanBase) return null;
  for (const quote of ['USDT', 'USDC', 'FDUSD', 'USD']) {
    try {
      const result = await fetchJson<BinancePrice>(`${BINANCE_PUBLIC}/ticker/price?symbol=${cleanBase}${quote}`, {
        source: 'binance:spot-price', cacheTtlMs: 20_000, signal,
      });
      const price = finitePositive(result.price);
      if (price) return price;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return null;
}

export async function fetchCrossChainSpread(
  token: Token,
  fallbackCexPriceUsd?: number | null,
  signal?: AbortSignal,
): Promise<CrossChainSpread> {
  const cexPriceUsd = await fetchBinanceSpotPrice(token.base, signal).catch(() => null)
    ?? finitePositive(fallbackCexPriceUsd);
  if (!token.contract || !cexPriceUsd) return { cexPriceUsd, cexSource: 'Binance Spot', rows: [] };

  const pairs = await dexscreenerByToken([token.contract], signal);
  const bestByChain = new Map<string, (typeof pairs)[number]>();
  for (const pair of pairs) {
    if (pair.priceUsd == null || pair.priceUsd <= 0 || (pair.liquidityUsd ?? 0) < 10_000) continue;
    const current = bestByChain.get(pair.chain);
    if (!current || (pair.liquidityUsd ?? 0) > (current.liquidityUsd ?? 0)) bestByChain.set(pair.chain, pair);
  }
  const rows = [...bestByChain.values()]
    .map((pair) => ({
      chain: pair.chain,
      dex: pair.dex,
      pairAddress: pair.pairAddress,
      priceUsd: pair.priceUsd!,
      cexPriceUsd,
      spreadPct: ((pair.priceUsd! / cexPriceUsd) - 1) * 100,
      liquidityUsd: pair.liquidityUsd ?? 0,
      marketCapUsd: finitePositive(pair.marketCapUsd),
      fdvUsd: finitePositive(pair.fdvUsd),
      url: pair.url,
    }))
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd)
    .slice(0, 12);
  return { cexPriceUsd, cexSource: 'Binance Spot', rows };
}

export const SIGNAL_TIMEFRAMES = TREND_TIMEFRAMES;
