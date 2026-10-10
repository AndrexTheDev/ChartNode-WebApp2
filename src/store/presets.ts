// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import type { ChartLayoutId, ChartType, Pane, ThemeId, Timeframe } from './types';

export interface LayoutPreset {
  id: ChartLayoutId;
  cols: number;
  rows: number;
  panes: number;
  /** Tailwind classes for the grid container (static => purge-safe). */
  gridClass: string;
  /** Recommended minimum chart height per row. */
  rowMinHeight: number;
}

/**
 * Grid presets for the terminal. `gridClass` strings are written out in full
 * so Tailwind's content scanner keeps them in the production bundle.
 *
 * Zero-overflow contract:
 *  · every track is `minmax(0, 1fr)` (auto-fit boundary at 0) so a long token
 *    inside a pane can never blow the grid track wider/taller than its cell;
 *  · below `md` the panes stack in *scrollable* rows with a per-pane minimum
 *    (the grid container scrolls, see ChartGrid) – on a 360 px phone nothing
 *    is clipped or unreachable;
 *  · from `md` up the grid fills its container exactly (1×1 / 1×2 / 2×2),
 *    and `2x2` flows to a 4-up strip on ultra-wide (≥1536 px) screens.
 */
export const CHART_LAYOUTS: Record<ChartLayoutId, LayoutPreset> = {
  '1x1': {
    id: '1x1',
    cols: 1,
    rows: 1,
    panes: 1,
    gridClass:
      'grid-cols-[minmax(0,1fr)] grid-rows-[minmax(320px,1fr)] ' +
      'md:grid-rows-[minmax(0,1fr)]',
    rowMinHeight: 420,
  },
  '2x1': {
    id: '2x1',
    cols: 2,
    rows: 1,
    panes: 2,
    gridClass:
      'grid-cols-[minmax(0,1fr)] grid-rows-[repeat(2,minmax(280px,1fr))] ' +
      'md:grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] md:grid-rows-[minmax(0,1fr)]',
    rowMinHeight: 420,
  },
  '2x2': {
    id: '2x2',
    cols: 2,
    rows: 2,
    panes: 4,
    gridClass:
      'grid-cols-[minmax(0,1fr)] grid-rows-[repeat(4,minmax(240px,1fr))] ' +
      'md:grid-cols-2 md:grid-rows-[repeat(2,minmax(0,1fr))] ' +
      '2xl:grid-cols-[repeat(4,minmax(0,1fr))] 2xl:grid-rows-[minmax(0,1fr)]',
    rowMinHeight: 300,
  },
};

export const LAYOUT_IDS = Object.keys(CHART_LAYOUTS) as ChartLayoutId[];

export const THEMES: ThemeId[] = ['acid', 'violet', 'light'];
/** Standard themes + share-composer-gated themes (picker order). */
export const ALL_THEMES: ThemeId[] = ['acid', 'violet', 'light', 'matrix', 'miami'];

/** Build (or rebuild) the pane array so it always matches the layout. */
export function buildPanes(layout: ChartLayoutId, previous: Pane[] = []): Pane[] {
  const count = CHART_LAYOUTS[layout].panes;
  return Array.from({ length: count }, (_, index) => {
    const id = `pane-${index + 1}`;
    const existing = previous.find((pane) => pane.id === id);
    return existing ?? { id, kind: 'chart', tokenId: null };
  });
}

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'] as const;
export const CHART_TYPES = ['candles', 'bars', 'line', 'area', 'heikinAshi', 'baseline', 'renko', 'lineBreak', 'kagi', 'pnf'] as const;

/*
 * Type guards for values that cross a trust boundary (URL params, localStorage
 * persistence, postMessage-free but user-editable storage). They replace
 * `includes(...)` + cast pairs: the guard narrows, so no cast is needed and an
 * invalid persisted value falls back to the default instead of poisoning the
 * store with an out-of-union string.
 */
export function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === 'string' && (TIMEFRAMES as readonly string[]).includes(value);
}

export function isChartType(value: unknown): value is ChartType {
  return typeof value === 'string' && (CHART_TYPES as readonly string[]).includes(value);
}

export function isChartLayoutId(value: unknown): value is ChartLayoutId {
  return typeof value === 'string' && (LAYOUT_IDS as string[]).includes(value);
}
