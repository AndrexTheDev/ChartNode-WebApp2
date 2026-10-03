// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { create } from 'zustand';
import type { ExchangeId } from '@/websockets/types';

export interface WhaleTrade {
  id: string;
  exchange: ExchangeId;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  notional: number;
  ts: number;
}

const MAX_WHALES = 48;
const MAX_EXTREME_WHALES = 120;

interface WhaleState {
  trades: WhaleTrade[];
  /** Strict >$500k prints retained separately for the Pro candle overlay. */
  extremeTrades: WhaleTrade[];
  count: number;
  totalNotional: number;
  /** Stream on/off – controls whether trade channels are subscribed. */
  enabled: boolean;
  /** Minimum notional in USD for the general multi-exchange whale ticker. */
  thresholdUsd: number;
  /** Session count of Binance prints strictly above $100,000 USD. */
  largeBinanceCount: number;
}

interface WhaleActions {
  pushMany: (trades: WhaleTrade[]) => void;
  pushExtremeMany: (trades: WhaleTrade[]) => void;
  recordLargeBinanceTrades: (count: number) => void;
  setEnabled: (enabled: boolean) => void;
  setThreshold: (thresholdUsd: number) => void;
  clear: () => void;
}

export type WhaleStore = WhaleState & WhaleActions;

export const useWhaleStore = create<WhaleStore>()((set) => ({
  trades: [],
  extremeTrades: [],
  count: 0,
  totalNotional: 0,
  enabled: true,
  thresholdUsd: 10_000,
  largeBinanceCount: 0,

  pushMany: (incoming) =>
    set((state) => {
      if (incoming.length === 0) return state;
      const trades = [...incoming, ...state.trades].slice(0, MAX_WHALES);
      return {
        trades,
        count: state.count + incoming.length,
        totalNotional: state.totalNotional + incoming.reduce((sum, t) => sum + t.notional, 0),
      };
    }),

  pushExtremeMany: (incoming) =>
    set((state) => {
      if (incoming.length === 0) return state;
      const unique = new Map(state.extremeTrades.map((trade) => [trade.id, trade]));
      for (const trade of incoming) unique.set(trade.id, trade);
      return { extremeTrades: [...unique.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_EXTREME_WHALES) };
    }),

  recordLargeBinanceTrades: (count) => {
    if (count <= 0) return;
    set((state) => ({ largeBinanceCount: state.largeBinanceCount + count }));
  },
  setEnabled: (enabled) => set({ enabled }),
  setThreshold: (thresholdUsd) => set({ thresholdUsd }),
  clear: () => set({ trades: [], extremeTrades: [], count: 0, totalNotional: 0, largeBinanceCount: 0 }),
}));

export const selectWhaleTrades = (s: WhaleStore) => s.trades;
export const selectExtremeWhaleTrades = (s: WhaleStore) => s.extremeTrades;
export const selectWhaleEnabled = (s: WhaleStore) => s.enabled;
export const selectWhaleThreshold = (s: WhaleStore) => s.thresholdUsd;
export const selectLargeBinanceCount = (s: WhaleStore) => s.largeBinanceCount;
