// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useWhaleStore, type WhaleTrade } from '@/store/useWhaleStore';
import type { RawTrade } from './types';

/**
 * Whale filter on top of the raw trade streams.
 *
 * Trades can arrive in bursts (hundreds/second on BTC), so matches are
 * buffered and flushed to the store at most every FLUSH_MS – the ticker
 * animates in batches instead of re-rendering per tick.
 */
const FLUSH_MS = 400;
const LARGE_BINANCE_USD = 100_000;
const EXTREME_WHALE_USD = 500_000;
const USD_QUOTES = new Set(['USD', 'USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'USDP', 'DAI']);

let whaleSeq = 0;

class WhaleTracker {
  private pending: WhaleTrade[] = [];
  private pendingExtreme: WhaleTrade[] = [];
  private pendingLargeBinance = 0;
  private timer: number | null = null;

  observe(trade: RawTrade): void {
    const { enabled, thresholdUsd } = useWhaleStore.getState();
    if (!enabled) return;

    const notional = trade.price * trade.qty;
    if (!Number.isFinite(notional)) return;

    // This dedicated counter has a fixed, strict $100k threshold on USD-quoted
    // Binance pairs, independent of the general ticker's configurable threshold.
    const quote = trade.symbol.split('/')[1]?.toUpperCase();
    if (trade.exchange === 'binance' && quote && USD_QUOTES.has(quote) && notional > LARGE_BINANCE_USD) {
      this.pendingLargeBinance += 1;
      this.scheduleFlush();
    }

    if (notional > EXTREME_WHALE_USD) {
      whaleSeq += 1;
      this.pendingExtreme.push({
        id: `${trade.exchange}-${trade.ts}-${whaleSeq}`,
        exchange: trade.exchange,
        symbol: trade.symbol,
        side: trade.side,
        price: trade.price,
        qty: trade.qty,
        notional,
        ts: trade.ts,
      });
      this.scheduleFlush();
    }

    if (notional < thresholdUsd) return;
    whaleSeq += 1;
    this.pending.push({
      id: `${trade.exchange}-${trade.ts}-${whaleSeq}`,
      exchange: trade.exchange,
      symbol: trade.symbol,
      side: trade.side,
      price: trade.price,
      qty: trade.qty,
      notional,
      ts: trade.ts,
    });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer === null) {
      this.timer = window.setTimeout(() => this.flush(), FLUSH_MS);
    }
  }

  private flush(): void {
    this.timer = null;
    const largeBinance = this.pendingLargeBinance;
    this.pendingLargeBinance = 0;
    if (largeBinance > 0) {
      useWhaleStore.getState().recordLargeBinanceTrades(largeBinance);
    }
    if (this.pendingExtreme.length > 0) {
      useWhaleStore.getState().pushExtremeMany([...this.pendingExtreme].sort((a, b) => b.ts - a.ts));
      this.pendingExtreme = [];
    }
    if (this.pending.length === 0) return;
    // Newest first: batches are prepended to the store, so a burst that spans
    // a few hundred ms still reads like a live ticker.
    const batch = [...this.pending].sort((a, b) => b.ts - a.ts);
    this.pending = [];
    useWhaleStore.getState().pushMany(batch);
  }

  /** Drop buffered trades (e.g. when the stream is disabled). */
  drain(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = [];
    this.pendingExtreme = [];
    this.pendingLargeBinance = 0;
  }
}

export const whaleTracker = new WhaleTracker();
