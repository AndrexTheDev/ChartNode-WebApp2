// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

/**
 * PriceChart – one lightweight-charts instance per grid pane.
 *
 * What lives in here:
 *   • main series (candles / bars / line / area / Heikin-Ashi) + volume overlay
 *   • indicator series – overlays in pane 0, oscillators each in their own pane
 *     (`addSeries(def, opts, paneIndex)`), computed by `lib/indicators`
 *   • the NodeChart watermark (`www.NodeChart.cc`) painted into the canvas below
 *     the series, so it is part of `takeScreenshot()` and cannot be cropped
 *   • drawing tools + the mirrored crosshair, both as canvas primitives
 *   • grid sync: publishes/accepts the visible logical range and the crosshair
 *
 * Client-only; loaded through `next/dynamic` (`ssr: false`) because
 * lightweight-charts needs a real DOM.
 */

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type LogicalRange,
  type HistogramData,
  type LineData,
  type SeriesDataItemTypeMap,
  type SeriesType,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from 'lightweight-charts';
import { Crosshair as CrosshairIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { RSI as RsiCalc } from 'technicalindicators';
import { readChartTheme, withAlpha, type ChartTheme } from '@/lib/chart-theme';
import { measureChartSize, observeChartSize } from '@/lib/chart-resize';
import { useIsTouchHost } from '@/lib/device';
import { crosshairBus, rangeBus, rangesEqual } from '@/lib/chart-sync';
import { hitTestDrawings, type XY } from '@/lib/drawings';
import { cn } from '@/lib/cn';
import { compactUsd, minMoveFor, pricePrecision, safeLocale } from '@/lib/format';
import {
  INDICATOR_LIBRARY,
  SERIES_COLORS,
  computeIndicator,
  heikinAshi,
  indicatorTitle,
  lastValue,
  type IndicatorValues,
} from '@/lib/indicators';
import {
  selectDrawings,
  selectIndicators,
  selectAlertArm,
  selectAlerts,
  selectAvwapAnchor,
  selectAvwapArm,
  selectAxisLog,
  selectAxisPct,
  selectBtMarkers,
  selectDivOn,
  selectSrOn,
  selectSyncCrosshair,
  selectSyncZoom,
  selectTool,
  selectVolume,
  selectVpOn,
  selectLiqMagnetsOn,
  useChartStore,
  type DrawingPoint,
} from '@/store/useChartStore';
import { useToastStore } from '@/store/useToastStore';
import { selectTheme, useAppStore } from '@/store/useAppStore';
import type { ChartType, Timeframe } from '@/store/types';
import { transformExotic, type ExoticType } from '@/lib/charttypes';
import { notifyAlert, beepAlert } from '@/lib/notifications';

const EXOTIC_TYPES: ChartType[] = ['renko', 'lineBreak', 'kagi', 'pnf'];
const PATTERN_TAG: Record<string, string> = {
  doubleTop: 'DT',
  doubleBottom: 'DB',
  headShoulders: 'H&S',
  invHeadShoulders: 'H&S+',
  triAsc: 'TRI+',
  triDesc: 'TRI-',
  flagBull: 'FLG+',
  flagBear: 'FLG-',
};
import type { Candle } from '@/websockets/types';
import {
  CrosshairPrimitive,
  DrawingPrimitive,
  SrLevelPrimitive,
  VolumeProfilePrimitive,
  LiqMagnetPrimitive,
  WatermarkPrimitive,
  WhaleBubblePrimitive,
  type CrosshairSource,
  type DraftShape,
  type WhaleBubbleTrade,
} from './primitives';
import { ValueLineSeriesView, type ValueLineOptions, type ValuePoint } from './line-series-view';
import type { ProtocolTvl } from '@/api/market-signals';
import { anchoredVwap, divergences, supportResistance, volumeProfile } from '@/lib/premium';
import { buildLiqMap } from '@/lib/liqradar';

type AnySeries = ISeriesApi<SeriesType, Time>;
/** v5 Custom Series (addCustomSeries) carrying `{ time, value }` points. */
type CustomLineSeries = ISeriesApi<'Custom', Time, ValuePoint | WhitespaceData<Time>, ValueLineOptions>;

export interface PriceChartHandle {
  /** PNG data URL of the canvas – watermark, drawings and crosshair included. */
  toPng: () => string | null;
  fit: () => void;
}

export interface PatternMark {
  time: number;
  price: number;
  kind: string;
  bias: 'bull' | 'bear';
  confidence: number;
}

export interface PriceChartProps {
  paneId: string;
  /** Unique per mounted chart – suppresses sync echoes. */
  chartId: string;
  symbol: string;
  /** Watermark ticker, e.g. `$SOL`. */
  ticker: string;
  venue: string;
  timeframe: Timeframe;
  candles: Candle[];
  chartType: ChartType;
  status: string;
  /** Wave-4 auto pattern marks (unix-ms times), drawn as bias arrows. */
  patterns?: PatternMark[];
  /** Override for the legend interval chip (custom intervals). */
  intervalLabel?: string | null;
  /** Optional compare overlay: normalized % line of another symbol. */
  compareCandles?: Candle[];
  compareTicker?: string;
  /** Verified-Pro overlays only: fresh >$500k prints for this exact CEX pair. */
  whaleTrades?: WhaleBubbleTrade[];
  /** Verified-Pro DeFiLlama protocol TVL strip shown below supported DEX token charts. */
  tvl?: ProtocolTvl | null;
  ref?: React.Ref<PriceChartHandle>;
}

interface ComputedIndicator {
  id: string;
  kind: keyof typeof INDICATOR_LIBRARY;
  title: string;
  values: IndicatorValues | null;
  /** CUSTOM scripts may choose the price pane instead of their own. */
  overlay?: boolean;
  colorIndex: number;
}

/** Bars shown when a fresh symbol/timeframe is loaded. */
const DEFAULT_VISIBLE_BARS = 140;

/* ------------------------- incremental series updates ----------------------- */

interface AppliedBars {
  /** Identity of what the painted bars belong to (feed, type, palette, …). */
  scope: string;
  len: number;
  lastT: number;
}

/*
 * Transport-Typ fuer Balkenpunkte: der volle Daten-Union von lightweight-charts
 * (Candlestick | Bar | Line | Area | Histogram | …). Frueher war das eine lose
 * Form (`{ time: number } & Record<string, unknown>`), die `as unknown as`-
 * Casts an jeder Series-Grenze erzwang. Mit dem echten Union typen
 * `update()`/`setData()` direkt durch – ohne Cast, ohne `any`.
 */
type BarPoint = SeriesDataItemTypeMap<Time>[SeriesType];

/**
 * 60 fps tail-apply for live feeds.
 *
 * A WebSocket tick mutates exactly one bar (the forming one) or appends one.
 * `ISeriesApi.update()` replaces/appends that single bar in O(1), while
 * `setData()` rebuilds the series' whole plot list and invalidates the entire
 * pane – with 4 panes × (candles + volume + N indicators) at several ticks per
 * second that is the difference between smooth and janky.
 *
 * Falls back to a full `setData()` whenever the structure genuinely changed:
 * new feed/symbol/timeframe, palette flip, shrunken history (Renko repaint,
 * re-seed) or a time gap between the old tail and the new prefix.
 */
function applyBars(
  series: AnySeries,
  points: BarPoint[],
  applied: AppliedBars | null,
  scope: string,
): AppliedBars | null {
  const last = points[points.length - 1];
  const lastT = last ? Number(last.time) : 0;
  const next: AppliedBars | null = points.length > 0 ? { scope, len: points.length, lastT } : null;

  const tailUsable =
    applied !== null &&
    applied.scope === scope &&
    points.length >= applied.len &&
    (applied.len === 0 || Number(points[applied.len - 1]?.time) === applied.lastT);

  if (tailUsable && applied) {
    // Equal length + equal tail time ⇒ the forming bar ticked: rewrite it.
    const start = points.length === applied.len && lastT === applied.lastT ? applied.len - 1 : applied.len;
    for (let i = Math.max(0, start); i < points.length; i += 1) {
      const point = points[i];
      if (point) series.update(point);
    }
    return next;
  }

  series.setData(points);
  return next;
}

/**
 * Same O(1) tail-apply strategy as `applyBars`, for v5 Custom Series
 * (`addCustomSeries`) that carry `{ time, value }` points (aVWAP, compare).
 */
function applyValuePoints(
  series: CustomLineSeries,
  points: ValuePoint[],
  applied: AppliedBars | null,
  scope: string,
): AppliedBars | null {
  const last = points[points.length - 1];
  const lastT = last ? Number(last.time) : 0;
  const next: AppliedBars | null = points.length > 0 ? { scope, len: points.length, lastT } : null;

  const tailUsable =
    applied !== null &&
    applied.scope === scope &&
    points.length >= applied.len &&
    (applied.len === 0 || Number(points[applied.len - 1]?.time) === applied.lastT);

  if (tailUsable && applied) {
    const start = points.length === applied.len && lastT === applied.lastT ? applied.len - 1 : applied.len;
    for (let i = Math.max(0, start); i < points.length; i += 1) {
      const point = points[i];
      if (point) series.update(point);
    }
    return next;
  }

  series.setData(points);
  return next;
}

/** Timeframe → milliseconds, for the bar-close countdown. */
const TF_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

/** Alert ids already toasted in this page session – panes share alerts. */
const announcedAlerts = new Set<string>();

export function PriceChart({
  paneId,
  chartId,
  symbol,
  timeframe,
  candles,
  chartType,
  patterns,
  intervalLabel,
  status,
  compareCandles,
  compareTicker,
  whaleTrades,
  tvl,
  ref,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  /*
   * lightweight-charts formatiert Achsen-Ticks intern mit
   * `Date.toLocaleString()` **ohne** Locale-Argument – also im Runtime-Default.
   * Ist der kaputt (POSIX-Tags wie `en-US@posix`), wirft jede Tick-Beschriftung
   * einen `RangeError`. Wir geben dem Chart deshalb explizit eine validierte
   * Locale: robust und zugleich korrekt lokalisiert.
   */
  const locale = safeLocale(useLocale());
  const localeRef = useRef(locale);
  const mainRef = useRef<AnySeries | null>(null);
  const volumeRef = useRef<AnySeries | null>(null);
  const indicatorSeriesRef = useRef<Map<string, AnySeries>>(new Map());
  const drawingPrimRef = useRef<DrawingPrimitive | null>(null);
  const crosshairPrimRef = useRef<CrosshairPrimitive | null>(null);
  const watermarkPrimRef = useRef<WatermarkPrimitive | null>(null);
  const vpPrimRef = useRef<VolumeProfilePrimitive | null>(null);
  const liqPrimRef = useRef<LiqMagnetPrimitive | null>(null);
  const whaleBubblePrimRef = useRef<WhaleBubblePrimitive | null>(null);
  const tvlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const avwapRef = useRef<CustomLineSeries | null>(null);
  const compareRef = useRef<CustomLineSeries | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const srPrimRef = useRef<SrLevelPrimitive | null>(null);
  const applyingRemoteRange = useRef(false);
  const rangedFor = useRef<string | null>(null);
  // Tail-apply bookkeeping (see `applyBars`): what each series currently paints.
  const mainAppliedRef = useRef<AppliedBars | null>(null);
  const volumeAppliedRef = useRef<AppliedBars | null>(null);
  const indicatorAppliedRef = useRef<Map<string, AppliedBars | null>>(new Map());
  const avwapAppliedRef = useRef<AppliedBars | null>(null);
  const compareAppliedRef = useRef<AppliedBars | null>(null);
  // Signatur-Guards: identische Analyse-Ergebnisse dürfen keine Series-API
  // aufrufen (createPriceLine/setMarkers invalidieren den Chart jedes Mal).
  const srSigRef = useRef<string | null>(null);
  const markerSigRef = useRef<string | null>(null);
  const baselineBaseRef = useRef<number | null>(null);
  // Timestamps der aktuell in der Main-Serie liegenden Bars (Sekunden). Marker
  // müssen exakt mit einem Datenpunkt zusammenfallen, sonst wirft
  // lightweight-charts bzw. zeichnet ins Leere.
  const seriesTimesRef = useRef<Set<number> | null>(null);

  const themeId = useAppStore(selectTheme);
  const chartTheme = useMemo(() => readChartTheme(themeId), [themeId]);

  /*
   * rAF-coalesced Analyse-Snapshot.
   *
   * WS-Ticks kommen bei BTC & Co. mehrfach pro Sekunde an; jeder erzeugt eine
   * neue `candles`-Identität. Die Haupt-/Volumen-Serien hängen direkt an
   * `candles` (O(1)-Tail-Update über `applyBars`, sofort sichtbar), aber alle
   * ABGELEITETEN Analysen (Indikatoren, Volume Profile, Liq Radar, S/R,
   * Divergenzen, aVWAP) rechnen auf diesem Snapshot: höchstens einmal pro
   * Frame, gebündelt über requestAnimationFrame – der 60-fps-Deckel für die
   * Mathe-Pipeline. Mehrere Ticks innerhalb eines Frames kosten so genau
   * einen Recompute.
   */
  const [analysisCandles, setAnalysisCandles] = useState(candles);
  useEffect(() => {
    if (candles === analysisCandles) return;
    const raf = requestAnimationFrame(() => setAnalysisCandles(candles));
    return () => cancelAnimationFrame(raf);
    // analysisCandles absichtlich nicht in den Deps: Der Effekt koalesziert
    // nur die eingehenden Prop-Wechsel (Standard-rAF-Throttle-Pattern).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);

  const indicators = useChartStore(selectIndicators(paneId));
  const drawings = useChartStore(selectDrawings(paneId));
  const tool = useChartStore(selectTool);
  const volumeOn = useChartStore(selectVolume);
  const vpOn = useChartStore(selectVpOn);
  const liqOn = useChartStore(selectLiqMagnetsOn);
  const avwapArm = useChartStore(selectAvwapArm);
  const avwapAnchor = useChartStore(selectAvwapAnchor(paneId));
  const setAvwapArm = useChartStore((s) => s.setAvwapArm);
  const setAvwapAnchor = useChartStore((s) => s.setAvwapAnchor);
  const srOn = useChartStore(selectSrOn);
  const divOn = useChartStore(selectDivOn);
  const axisLog = useChartStore(selectAxisLog);
  const axisPct = useChartStore(selectAxisPct);
  const btMarkers = useChartStore(selectBtMarkers(paneId));
  const alertArm = useChartStore(selectAlertArm);
  const alerts = useChartStore(selectAlerts);
  const addAlert = useChartStore((s) => s.addAlert);
  const fireAlert = useChartStore((s) => s.fireAlert);
  const syncCrosshair = useChartStore(selectSyncCrosshair);
  const syncZoom = useChartStore(selectSyncZoom);
  const selectedId = useChartStore((s) => s.selected[paneId] ?? null);
  const addDrawing = useChartStore((s) => s.addDrawing);
  const updateDrawing = useChartStore((s) => s.updateDrawing);
  const removeDrawing = useChartStore((s) => s.removeDrawing);
  const setSelected = useChartStore((s) => s.setSelected);
  const setTool = useChartStore((s) => s.setTool);

  const [draft, setDraft] = useState<DraftShape | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  // Bumps on every chart rebuild – re-runs effects that must re-apply state
  // to the fresh instance (pan lock, …).
  const [chartEpoch, setChartEpoch] = useState(0);
  const [remote, setRemote] = useState<{ time: number | null; price: number | null; symbol: string }>({
    time: null,
    price: null,
    symbol: '',
  });

  const dragRef = useRef<{
    mode: 'create' | 'move' | null;
    start: XY | null;
    drawingId: string | null;
    origin: [DrawingPoint, DrawingPoint] | null;
  }>({ mode: null, start: null, drawingId: null, origin: null });

  // Live values for callbacks registered once (avoids re-creating the chart).
  // Written from an effect – React forbids ref mutation during render.
  const candlesRef = useRef(candles);
  const symbolRef = useRef(symbol);
  const syncZoomRef = useRef(syncZoom);
  const feedKeyRef = useRef('');
  const feedKey = `${symbol}:${timeframe}`;

  useEffect(() => {
    candlesRef.current = candles;
    symbolRef.current = symbol;
    syncZoomRef.current = syncZoom;
    feedKeyRef.current = feedKey;
  });

  const digits = useMemo(() => pricePrecision(candles[candles.length - 1]?.c ?? null), [candles]);
  const lastCandle = candles[candles.length - 1] ?? null;
  const shown = hover ?? lastCandle;

  // Countdown based on the selected interval and latest candle timestamp.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const barCountdown = useMemo(() => {
    if (!lastCandle) return null;
    const span = TF_MS[timeframe];
    if (!span) return null;
    const left = Math.max(0, lastCandle.t + span - nowMs);
    const h = Math.floor(left / 3_600_000);
    const m = Math.floor((left % 3_600_000) / 60_000);
    const sec = Math.floor((left % 60_000) / 1000);
    const pad = (value: number) => String(value).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }, [lastCandle, nowMs, timeframe]);

  /* ---------------------------- indicator maths ---------------------------- */

  const computed = useMemo<ComputedIndicator[]>(() => {
    const counts = new Map<string, number>();
    return indicators
      .filter((entry) => entry.visible)
      .map((entry) => {
        const index = counts.get(entry.kind) ?? 0;
        counts.set(entry.kind, index + 1);
        return {
          id: entry.id,
          kind: entry.kind,
          title: indicatorTitle(entry.kind, entry.params),
          values: computeIndicator(entry.kind, analysisCandles, entry.params, entry.script),
          overlay: entry.kind === 'CUSTOM' && entry.params.overlay === 1,
          colorIndex: index,
        };
      });
  }, [indicators, analysisCandles]);

  /** Changing this string means series have to be created/removed. */
  const structureKey = useMemo(
    () =>
      indicators
        .filter((entry) => entry.visible)
        .map((entry) => `${entry.id}:${entry.kind}:${JSON.stringify(entry.params)}`)
        .join('|'),
    [indicators],
  );

  /* --------------------------------- mount --------------------------------- */

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const previousRange = chartRef.current?.timeScale().getVisibleLogicalRange() ?? null;
    const indicatorSeries = indicatorSeriesRef.current;
    rangedFor.current = null;

    const appliedMap = indicatorAppliedRef.current;
    // Explicit sizing (autoSize: false): our ResizeObserver wrapper
    // (lib/chart-resize) is the single source of truth for the canvas
    // geometry – one coalesced applyOptions per 16 ms frame boundary.
    const initial = measureChartSize(el);
    const chart = createChart(el, {
      autoSize: false,
      width: initial.width,
      height: initial.height,
      layout: {
        // Native color pipeline: sRGB source colors, Display-P3 canvas context
        // on capable panels (browser falls back to srgb otherwise).
        // Creation-time option – must not be changed via applyOptions.
        colorSpace: 'display-p3',
        background: { type: ColorType.Solid, color: chartTheme.bg },
        textColor: chartTheme.muted,
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
      grid: {
        vertLines: { color: withAlpha(chartTheme.grid, chartTheme.gridOpacity * 0.45) },
        horzLines: { color: withAlpha(chartTheme.grid, chartTheme.gridOpacity * 0.45) },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: chartTheme.accent, width: 1, style: LineStyle.Dashed, labelBackgroundColor: chartTheme.accent },
        horzLine: { color: chartTheme.accent, width: 1, style: LineStyle.Dashed, labelBackgroundColor: chartTheme.accent },
      },
      rightPriceScale: { borderColor: chartTheme.border, scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: chartTheme.border, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7 },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
      localization: { locale: safeLocale(localeRef.current) },
    });

    chartRef.current = chart;
    mainRef.current = createMainSeries(chart, chartType, chartTheme, digits, candlesRef.current[0]?.c ?? 1);

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'nc-volume',
      lastValueVisible: false,
      priceLineVisible: false,
    }) as AnySeries;
    chart.priceScale('nc-volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeRef.current = volume;

    /* ------------------------------- primitives ------------------------------ */
    const main = mainRef.current;

    const watermark = new WatermarkPrimitive();
    main.attachPrimitive(watermark);
    watermarkPrimRef.current = watermark;

    const drawingPrim = new DrawingPrimitive();
    main.attachPrimitive(drawingPrim);
    drawingPrimRef.current = drawingPrim;

    const crosshairPrim = new CrosshairPrimitive();
    main.attachPrimitive(crosshairPrim);
    crosshairPrimRef.current = crosshairPrim;

    // Volume Profile Visible Range – locally computed analytics, painted in-canvas.
    const vpPrim = new VolumeProfilePrimitive();
    main.attachPrimitive(vpPrim);
    vpPrimRef.current = vpPrim;

    // Wave-7 Liq Radar – liquidation-magnet bands, painted in-canvas.
    const liqPrim = new LiqMagnetPrimitive();
    main.attachPrimitive(liqPrim);
    liqPrimRef.current = liqPrim;

    const whaleBubbles = new WhaleBubblePrimitive();
    main.attachPrimitive(whaleBubbles);
    whaleBubblePrimRef.current = whaleBubbles;

    // Auto S/R levels + armed price alerts – one primitive instead of N price
    // lines (each of which invalidated the chart on create/remove).
    const srPrim = new SrLevelPrimitive();
    main.attachPrimitive(srPrim);
    srPrimRef.current = srPrim;

    // Frame-coalesced pane sizing (ResizeObserver → one applyOptions/frame).
    const stopResize = observeChartSize(chart, el);

    // A fresh chart starts unlocked – re-apply the drawing-tool lock state
    // synchronously (the epoch bump below re-runs the live effect as well).
    if (useChartStore.getState().tool !== 'none') {
      chart.applyOptions({ handleScroll: false, handleScale: false });
    }
    setChartEpoch((epoch) => epoch + 1);

    /* --------------------------------- syncing ------------------------------- */
    const timeScale = chart.timeScale();

    timeScale.subscribeVisibleLogicalRangeChange((range: LogicalRange | null) => {
      if (!range || applyingRemoteRange.current || !syncZoomRef.current) return;
      rangeBus.publish({ source: chartId, range: { from: range.from, to: range.to } });
    });

    chart.subscribeCrosshairMove((param) => {
      const logical = param.logical != null ? Number(param.logical) : null;
      const list = candlesRef.current;
      setHover(logical !== null && logical >= 0 && logical < list.length ? (list[logical] ?? null) : null);

      const price =
        param.point && mainRef.current ? Number(mainRef.current.coordinateToPrice(param.point.y)) : Number.NaN;
      crosshairBus.publish({
        source: chartId,
        time: param.time != null ? Number(param.time) : null,
        logical,
        price: Number.isFinite(price) ? price : null,
        paneIndex: param.paneIndex ?? 0,
        symbol: symbolRef.current,
      });
    });

    const offRange = rangeBus.subscribe((message) => {
      if (message.source === chartId || !syncZoomRef.current) return;
      const current = chart.timeScale().getVisibleLogicalRange();
      if (rangesEqual(current, message.range)) return;
      applyingRemoteRange.current = true;
      chart.timeScale().setVisibleLogicalRange({ from: message.range.from, to: message.range.to });
      applyingRemoteRange.current = false;
    });

    const offCrosshair = crosshairBus.subscribe((message) => {
      if (message.source === chartId) return;
      // In einem 2x2-Grid feuert jede Mausbewegung in EINEM Pane drei Bus-
      // Messages; identische Werte dürfen keinen Re-Render auslösen.
      setRemote((prev) =>
        prev.time === message.time && prev.price === message.price && prev.symbol === message.symbol
          ? prev
          : { time: message.time, price: message.price, symbol: message.symbol },
      );
    });

    // A chart mounted into an already-synced grid adopts the current view.
    if (previousRange) {
      timeScale.setVisibleLogicalRange(previousRange);
      rangedFor.current = feedKeyRef.current;
    } else {
      rangeBus.replay((message) => {
        if (message.source === chartId) return;
        applyingRemoteRange.current = true;
        timeScale.setVisibleLogicalRange({ from: message.range.from, to: message.range.to });
        applyingRemoteRange.current = false;
        rangedFor.current = feedKeyRef.current;
      }, chartId);
    }

    return () => {
      offRange();
      offCrosshair();
      stopResize();
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      volumeRef.current = null;
      indicatorSeries.clear();
      drawingPrimRef.current = null;
      crosshairPrimRef.current = null;
      watermarkPrimRef.current = null;
      vpPrimRef.current = null;
      liqPrimRef.current = null;
      whaleBubblePrimRef.current = null;
      srPrimRef.current = null;
      tvlCanvasRef.current = null;
      avwapRef.current = null;
      compareRef.current = null;
      markersRef.current = null;
      // Fresh series ⇒ forget what was painted, so the next effect re-seeds
      // with a full setData instead of tail-updating a dead series.
      mainAppliedRef.current = null;
      volumeAppliedRef.current = null;
      appliedMap.clear();
      avwapAppliedRef.current = null;
      compareAppliedRef.current = null;
      srSigRef.current = null;
      markerSigRef.current = null;
      baselineBaseRef.current = null;
    };
    // Rebuilt only when the series *type* changes – everything else is applied
    // incrementally below, so candle ticks never recreate the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType, chartId]);

  const drawingActive = tool !== 'none';

  /*
   * Touch/pointer pan lock while a drawing tool is selected.
   *
   * On a touch device the finger is the pen: with a tool armed, the chart must
   * NOT pan/zoom under the gesture (the browser-level guard is `touch-action:
   * none` on the pane, the library-level guard is handleScroll/handleScale).
   * Previously the lock only existed *during* an active drag, so the first
   * finger movement panned the chart instead of starting the drawing.
   * `chartEpoch` bumps on every chart rebuild (type/symbol switch), so a
   * fresh instance re-applies the lock instead of starting unlocked.
   */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({ handleScroll: !drawingActive, handleScale: !drawingActive });
  }, [drawingActive, chartEpoch]);

  /* ---------------------- Achsen-Locale im Theme-Update -------------------- */

  useEffect(() => {
    localeRef.current = locale;
    chartRef.current?.applyOptions({ localization: { locale } });
  }, [locale, chartEpoch]);

  /* --------------------------------- data ---------------------------------- */

  useEffect(() => {
    const main = mainRef.current;
    const chart = chartRef.current;
    if (!main || !chart) return;

    const source =
      chartType === 'heikinAshi'
        ? heikinAshi(candles)
        : EXOTIC_TYPES.includes(chartType)
          ? transformExotic(chartType as ExoticType, candles)
          : candles;
    const { bull, bear } = chartTheme;

    // Scope identity: any structural change (feed, chart type, palette flip)
    // forces a full repaint; plain ticks take the O(1) tail path.
    const scope = `${chartId}|${feedKey}|${chartType}|${bull}|${bear}`;

    if (chartType === 'line' || chartType === 'area' || chartType === 'baseline') {
      mainAppliedRef.current = applyBars(
        main,
        source.map((c) => ({ time: (c.t / 1000) as UTCTimestamp, value: c.c })),
        mainAppliedRef.current,
        scope,
      );
    } else {
      mainAppliedRef.current = applyBars(
        main,
        source.map((c) => ({
          time: (c.t / 1000) as UTCTimestamp,
          open: c.o,
          high: c.h,
          low: c.l,
          close: c.c,
          color: c.c >= c.o ? bull : bear,
        })),
        mainAppliedRef.current,
        scope,
      );
    }

    const times = new Set<number>(source.map((c) => c.t / 1000));
    seriesTimesRef.current = times;

    if (volumeRef.current) {
      volumeAppliedRef.current = applyBars(
        volumeRef.current,
        volumeOn
          ? (source.map((c) => ({
              time: (c.t / 1000) as UTCTimestamp,
              value: c.v,
              color: withAlpha(c.c >= c.o ? bull : bear, 0.35),
            })))
          : [],
        volumeAppliedRef.current,
        `${scope}|vol:${volumeOn ? 1 : 0}`,
      );
    } else {
      volumeAppliedRef.current = null;
    }

    // First paint of a new symbol/timeframe → show the most recent N bars.
    if (source.length > 0 && rangedFor.current !== feedKey) {
      rangedFor.current = feedKey;
      const to = source.length + 6;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, to - DEFAULT_VISIBLE_BARS), to });
    }
  }, [candles, chartType, chartTheme, volumeOn, feedKey, chartId]);

  /* ------------------------- indicator series structure ---------------------- */

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const series of indicatorSeriesRef.current.values()) {
      try {
        chart.removeSeries(series);
      } catch {
        // pane already gone
      }
    }
    indicatorSeriesRef.current.clear();
    for (let i = chart.panes().length - 1; i >= 1; i -= 1) chart.removePane(i);

    let paneCursor = 1;
    const paneOf = new Map<string, number>();

    for (const entry of computed) {
      const def = INDICATOR_LIBRARY[entry.kind];
      if (!def) continue;

      let paneIndex = 0;
      if (!entry.overlay && def.placement === 'pane') {
        const existing = paneOf.get(entry.id);
        if (existing === undefined) {
          paneOf.set(entry.id, paneCursor);
          paneIndex = paneCursor;
          paneCursor += 1;
        } else {
          paneIndex = existing;
        }
      }

      def.outputs.forEach((output, outputIndex) => {
        const color = SERIES_COLORS[(entry.colorIndex + outputIndex) % SERIES_COLORS.length] ?? output.color;
        const series =
          output.style === 'histogram'
            ? (chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, color }, paneIndex) as AnySeries)
            : (chart.addSeries(
                LineSeries,
                {
                  color,
                  lineWidth: (output.width ?? 1) as 1 | 2 | 3 | 4,
                  lineStyle: output.dashed ? LineStyle.Dashed : LineStyle.Solid,
                  crosshairMarkerVisible: false,
                  lastValueVisible: false,
                  priceLineVisible: false,
                },
                paneIndex,
              ) as AnySeries);

        indicatorSeriesRef.current.set(`${entry.id}:${output.key}`, series);

        if (def.placement === 'pane') {
          const pane = chart.panes()[paneIndex];
          pane?.setHeight(def.paneHeight ?? 130);
          if (def.scale) {
            const range = def.scale;
            series.applyOptions({
              autoscaleInfoProvider: () => ({ priceRange: { minValue: range.min, maxValue: range.max } }),
            });
          }
          for (const level of def.levels ?? []) {
            series.createPriceLine({
              price: level,
              color: withAlpha(chartTheme.faint, 0.7),
              lineWidth: 1,
              lineStyle: LineStyle.Dotted,
              axisLabelVisible: true,
              title: '',
            });
          }
        }
      });
    }
    /* Audit-Haken: Zahl der Chart-Panes (Haupt-Pane + je Oszillator-Pane).
       `data-nc-legend` markiert die Legende und zählt damit GRID-Zellen – nicht
       die inneren Panes von lightweight-charts. Ein Oszillator wie RSI legt
       seinen Pane innerhalb DESSELBEN Canvas an, war also über die Legende
       nicht nachweisbar (Audit-Suite meldete fälschlich „kein Pane"). */
    containerRef.current?.setAttribute('data-nc-panes', String(chart.panes().length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, chartType, chartId]);

  /* --------------------------- indicator series data ------------------------- */

  useEffect(() => {
    for (const entry of computed) {
      const def = INDICATOR_LIBRARY[entry.kind];
      if (!def || !entry.values) continue;
      def.outputs.forEach((output, outputIndex) => {
        const series = indicatorSeriesRef.current.get(`${entry.id}:${output.key}`);
        const values = entry.values?.[output.key];
        if (!series || !values) return;
        const color = SERIES_COLORS[(entry.colorIndex + outputIndex) % SERIES_COLORS.length] ?? output.color;
        const seriesKey = `${entry.id}:${output.key}`;
        indicatorAppliedRef.current.set(
          seriesKey,
          applyBars(
            series,
            mapSeries(analysisCandles, values, output.style, color),
            indicatorAppliedRef.current.get(seriesKey) ?? null,
            `${chartId}|${feedKey}|${seriesKey}|${color}`,
          ),
        );
      });
    }
  }, [computed, analysisCandles, chartId, feedKey, chartEpoch]);

  /* ------------------------------ drawing source ---------------------------- */

  useEffect(() => {
    drawingPrimRef.current?.setSource({
      drawings,
      draft,
      selectedId: tool === 'none' ? selectedId : null,
      theme: chartTheme,
      digits,
    });
  }, [drawings, draft, selectedId, tool, chartTheme, digits, chartEpoch]);

  /* --------------------- volume profile + anchored VWAP --------------------- */

  useEffect(() => {
    const prim = vpPrimRef.current;
    if (!prim) return;
    if (!vpOn) {
      prim.setSource(null);
      return;
    }
    const profile = volumeProfile(analysisCandles);
    if (!profile) {
      prim.setSource(null);
      return;
    }
    prim.setSource({
      ...profile,
      area: withAlpha(chartTheme.accent, 0.34),
      outside: withAlpha(chartTheme.secondary, 0.16),
      level: withAlpha(chartTheme.accent, 0.85),
    });
  }, [vpOn, analysisCandles, chartTheme, chartEpoch]);

  /* ------------------------- wave-7: liquidation magnets ------------------- */

  useEffect(() => {
    const prim = liqPrimRef.current;
    if (!prim) return;
    if (!liqOn) {
      prim.setSource(null);
      return;
    }
    const map = buildLiqMap(analysisCandles);
    if (!map) {
      prim.setSource(null);
      return;
    }
    prim.setSource({
      buckets: map.buckets,
      halfPct: 0.0012,
      longBase: chartTheme.bull,
      shortBase: chartTheme.bear,
      label: withAlpha(chartTheme.text, 0.72),
    });
  }, [liqOn, analysisCandles, chartTheme, chartEpoch]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (avwapAnchor == null) {
      if (avwapRef.current) {
        chart.removeSeries(avwapRef.current);
        avwapRef.current = null;
      }
      avwapAppliedRef.current = null;
      return;
    }
    if (!avwapRef.current) {
      // v5 Custom Series: the aVWAP polyline lives inside the canvas
      // (screenshot-safe, panes/zooms with the data).
      avwapRef.current = chart.addCustomSeries(
        new ValueLineSeriesView(),
        {
          color: chartTheme.warning,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'aVWAP',
        },
      );
    }
    const points = anchoredVwap(analysisCandles, avwapAnchor).map((point) => ({
      time: (point.time / 1000) as UTCTimestamp,
      value: point.value,
    }));
    avwapAppliedRef.current = applyValuePoints(
      avwapRef.current,
      points,
      avwapAppliedRef.current,
      `${chartId}|${feedKey}|avwap:${avwapAnchor}`,
    );
  }, [avwapAnchor, analysisCandles, chartId, feedKey, chartTheme, chartEpoch]);

  /* ------------------------- axis modes + bar countdown ---------------------- */

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale('right').applyOptions({
      // v5: percent axis is a scale MODE, not a flag – pct wins over log.
      mode: axisPct ? PriceScaleMode.Percentage : axisLog ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [axisLog, axisPct, chartEpoch]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main || chartType !== 'baseline') {
      baselineBaseRef.current = null;
      return;
    }
    const base = analysisCandles[0]?.c;
    // applyOptions invalidiert den Chart – nur bei echter Änderung aufrufen,
    // nicht pro Tick (der Basispreis ist die erste Kerze des Buffers).
    if (base != null && base > 0 && base !== baselineBaseRef.current) {
      baselineBaseRef.current = base;
      main.applyOptions({ baseValue: { type: 'price', price: base } } as never);
    }
  }, [chartType, analysisCandles]);

  /* -------------- auto support/resistance · price alerts (canvas) --------------
     One SrLevelPrimitive draws both: N × createPriceLine() was replaced by a
     single attached primitive – createPriceLine/removePriceLine each
     invalidated the whole chart, while the primitive fires one requestUpdate()
     per changed batch and survives takeScreenshot(). */

  const myAlerts = useMemo(() => alerts.filter((alert) => alert.symbol === symbol), [alerts, symbol]);

  useEffect(() => {
    const prim = srPrimRef.current;
    if (!prim) return;
    const levels = srOn
      ? supportResistance(analysisCandles).map((level) => ({
          price: level.price,
          kind: level.kind,
          touches: level.touches,
          color: level.kind === 'support' ? chartTheme.bull : chartTheme.bear,
          title: `${level.kind === 'support' ? 'S' : 'R'}×${level.touches}`,
        }))
      : [];
    // Critical alerts stay magenta (design contract: neon = active states,
    // trade execution points, critical alerts only).
    const alerts = myAlerts
      .filter((alert) => !alert.fired)
      .map((alert) => ({ price: alert.price, title: 'ALERT' }));
    // Identical content must not invalidate the canvas – signature first,
    // requestUpdate second (same guard as the old price-line batch).
    const signature =
      `${srOn}|` +
      levels.map((l) => `${l.kind}:${l.price.toFixed(6)}:${l.touches}`).join('|') +
      `|` +
      alerts.map((a) => a.price.toFixed(6)).join('|');
    if (signature === srSigRef.current) return;
    srSigRef.current = signature;
    prim.setSource({ levels, alerts, alertColor: chartTheme.danger, digits, theme: chartTheme });
  }, [srOn, myAlerts, analysisCandles, chartTheme, digits, chartEpoch]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    if (!markersRef.current) markersRef.current = createSeriesMarkers(main, []);

    const markers: SeriesMarker<Time>[] = [];

    // Divergenzen sind das einzige Marker-Signal hinter dem Divergenz-Toggle.
    // Patterns und Backtest-Fills gehören nicht dazu – die wurden bisher
    // mitgeklemmt, wenn `divOn` aus war.
    if (divOn && analysisCandles.length >= 30) {
      const rsiValues = RsiCalc.calculate({
        period: 14,
        values: analysisCandles.map((candle) => candle.c),
      });
      const offset = analysisCandles.length - rsiValues.length;
      const rsi: (number | undefined)[] = new Array(analysisCandles.length).fill(undefined);
      rsiValues.forEach((value, index) => {
        rsi[index + offset] = value;
      });
      const found = divergences(analysisCandles, rsi);
      for (const div of found) {
        markers.push({
          time: (analysisCandles[div.index]!.t / 1000) as UTCTimestamp,
          position: div.type === 'bullish' ? 'belowBar' : 'aboveBar',
          color: div.type === 'bullish' ? chartTheme.bull : chartTheme.bear,
          shape: div.type === 'bullish' ? 'arrowUp' : 'arrowDown',
          text: div.type === 'bullish' ? 'DIV+' : 'DIV−',
        });
      }
    }

    for (const pat of patterns ?? []) {
      markers.push({
        time: (pat.time / 1000) as UTCTimestamp,
        position: pat.bias === 'bull' ? 'belowBar' : 'aboveBar',
        color: pat.bias === 'bull' ? chartTheme.bull : chartTheme.bear,
        shape: pat.bias === 'bull' ? 'arrowUp' : 'arrowDown',
        text: PATTERN_TAG[pat.kind] ?? 'PAT',
      });
    }
    for (const mark of btMarkers ?? []) {
      markers.push({
        time: (mark.time / 1000) as UTCTimestamp,
        position: mark.side === 'buy' ? 'belowBar' : 'aboveBar',
        color: mark.side === 'buy' ? chartTheme.bull : '#ffb020',
        shape: mark.side === 'buy' ? 'arrowUp' : 'arrowDown',
        text: mark.side === 'buy' ? 'LONG' : 'EXIT',
      });
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    const times = seriesTimesRef.current;
    const usable = times ? markers.filter((m) => times.has(m.time as number)) : markers;

    // setMarkers() erzwingt einen vollen Marker-Repaint – identischer Inhalt
    // pro Tick war einer der größten vermeidbaren Costs im Live-Betrieb.
    const signature = usable.map((m) => `${m.time}:${m.position}:${m.text}:${m.color}`).join('|');
    if (signature === markerSigRef.current) return;
    markerSigRef.current = signature;
    markersRef.current.setMarkers(usable);
  }, [divOn, btMarkers, patterns, analysisCandles, chartTheme, chartType]);

  useEffect(() => {
    const last = candles[candles.length - 1]?.c;
    if (last == null) return;
    for (const alert of myAlerts) {
      if (alert.fired || announcedAlerts.has(alert.id)) continue;
      const c1 = alert.dir === 'above' ? last >= alert.price : last <= alert.price;
      const c2 =
        !alert.cond2 || (alert.cond2.dir === 'above' ? last >= alert.cond2.price : last <= alert.cond2.price);
      if (!(c1 && c2)) continue;
      announcedAlerts.add(alert.id);
      fireAlert(alert.id);
      notifyAlert(`${symbol} ALERT`, `${symbol} ${last.toFixed(digits)} · ${alert.note ?? alert.price.toFixed(digits)}`);
      beepAlert();
      useToastStore
        .getState()
        .push(
          `${symbol} hit ${alert.dir === 'above' ? '≥' : '≤'} ${alert.price.toFixed(digits)} (${last.toFixed(digits)})`,
          alert.dir === 'above' ? 'bull' : 'bear',
          10_000,
        );
    }
  }, [candles, myAlerts, fireAlert, symbol, digits]);

  /* ------------------------------ compare overlay --------------------------- */

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!compareTicker || !compareCandles || compareCandles.length < 2) {
      if (compareRef.current) {
        chart.removeSeries(compareRef.current);
        compareRef.current = null;
      }
      compareAppliedRef.current = null;
      return;
    }
    if (!compareRef.current) {
      // v5 Custom Series – same canvas-native treatment as aVWAP.
      compareRef.current = chart.addCustomSeries(
        new ValueLineSeriesView(),
        {
          color: chartTheme.secondary,
          lineWidth: 2,
          priceScaleId: 'compare',
          priceLineVisible: false,
          lastValueVisible: false,
          title: `${compareTicker} %`,
        },
      );
    }
    const base = compareCandles[0]!.c;
    compareAppliedRef.current = applyValuePoints(
      compareRef.current,
      compareCandles.map((candle) => ({
        time: (candle.t / 1000) as UTCTimestamp,
        value: base > 0 ? (candle.c / base - 1) * 100 : 0,
      })),
      compareAppliedRef.current,
      `${chartId}|cmp:${compareTicker}|${compareCandles[0]?.t ?? 0}`,
    );
  }, [compareTicker, compareCandles, chartId, chartTheme, chartEpoch]);

  /* -------------------------- >$500k whale bubbles -------------------------- */

  useEffect(() => {
    whaleBubblePrimRef.current?.setTrades(whaleTrades ?? []);
  }, [whaleTrades, chartId, chartEpoch]);

  /* -------------------------------- watermark ------------------------------- */

  useEffect(() => {
    watermarkPrimRef.current?.setSource({
      // Centre mark – the URL only, fitted to the pane to avoid the legend,
      // axes and pane chrome.
      ticker: 'www.NodeChart.cc',
      caption: '',
      primary: chartTheme.primary,
      accent: chartTheme.accent,
      alpha: 0.12,
    });
  }, [chartTheme, chartEpoch]);

  /* ------------------------------ theme updates ----------------------------- */

  useEffect(() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    if (!chart || !main) return;

    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.bg },
        textColor: chartTheme.muted,
      },
      grid: {
        vertLines: { color: withAlpha(chartTheme.grid, chartTheme.gridOpacity * 0.45) },
        horzLines: { color: withAlpha(chartTheme.grid, chartTheme.gridOpacity * 0.45) },
      },
      rightPriceScale: { borderColor: chartTheme.border },
      timeScale: { borderColor: chartTheme.border },
      crosshair: {
        vertLine: { color: chartTheme.accent, labelBackgroundColor: chartTheme.accent },
        horzLine: { color: chartTheme.accent, labelBackgroundColor: chartTheme.accent },
      },
    });
    applySeriesColors(main, chartType, chartTheme);
    // Custom Series (aVWAP / compare) follow the theme as well.
    avwapRef.current?.applyOptions({ color: chartTheme.warning });
    compareRef.current?.applyOptions({ color: chartTheme.secondary });
    // Whale bubbles: buy/sell prints are the trade execution points.
    whaleBubblePrimRef.current?.setColors({
      buy: chartTheme.bull,
      sell: chartTheme.bear,
      label: chartTheme.text,
    });
  }, [chartTheme, chartType]);

  /* ---------------------------- remote crosshair ---------------------------- */

  useEffect(() => {
    const source: CrosshairSource =
      !syncCrosshair || remote.time === null
        ? { time: null, price: null, sameSymbol: false, color: chartTheme.accent, digits, label: null }
        : {
            time: remote.time,
            price: remote.price,
            sameSymbol: remote.symbol === symbol,
            color: chartTheme.accent,
            digits,
            label: remote.symbol === symbol ? null : remote.symbol,
          };
    crosshairPrimRef.current?.setSource(source);
  }, [remote, syncCrosshair, chartTheme, digits, symbol, chartEpoch]);

  /* --------------------------- drawing interaction -------------------------- */

  const panePoint = useCallback((event: { clientX: number; clientY: number }): XY | null => {
    const paneEl = chartRef.current?.panes()[0]?.getHTMLElement();
    if (!paneEl) return null;
    const rect = paneEl.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const lockChart = useCallback((locked: boolean) => {
    chartRef.current?.applyOptions({ handleScroll: !locked, handleScale: !locked });
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const prim = drawingPrimRef.current;
      if (!prim) return;
      const at = panePoint(event);
      if (!at) return;

      // Price alert: while armed, a click drops an alert at that level.
      if (alertArm) {
        const point = prim.fromXY(at.x, at.y);
        if (point) {
          const last = candlesRef.current[candlesRef.current.length - 1]?.c ?? point.price;
          addAlert(symbolRef.current, point.price, last);
        }
        return;
      }

      // Anchored VWAP: while armed, a click drops the anchor instead of drawing.
      if (avwapArm) {
        const point = prim.fromXY(at.x, at.y);
        if (point) {
          setAvwapAnchor(paneId, Math.round(point.time * 1000));
          setAvwapArm(false);
        }
        return;
      }

      const hit = hitTestDrawings(drawings, prim.toXY, at);

      if (tool === 'eraser') {
        if (hit) removeDrawing(paneId, hit.id);
        return;
      }

      if (tool === 'none') {
        setSelected(paneId, hit?.id ?? null);
        if (hit) {
          dragRef.current = { mode: 'move', start: at, drawingId: hit.id, origin: hit.points };
          lockChart(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        return;
      }

      const point = prim.fromXY(at.x, at.y);
      if (!point) return;
      dragRef.current = { mode: 'create', start: at, drawingId: null, origin: null };
      lockChart(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraft({
        tool,
        points: [point, point],
        color: SERIES_COLORS[drawings.length % SERIES_COLORS.length] ?? SERIES_COLORS[0]!,
      });
    },
    [addAlert, alertArm, avwapArm, drawings, lockChart, paneId, panePoint, removeDrawing, setAvwapAnchor, setAvwapArm, setSelected, tool],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag.mode) return;
      const prim = drawingPrimRef.current;
      if (!prim) return;
      const at = panePoint(event);
      if (!at) return;

      if (drag.mode === 'create') {
        const point = prim.fromXY(at.x, at.y);
        if (!point) return;
        setDraft((current) => (current ? { ...current, points: [current.points[0], point] } : current));
        return;
      }

      if (drag.mode === 'move' && drag.drawingId && drag.origin && drag.start) {
        const from = prim.fromXY(drag.start.x, drag.start.y);
        const to = prim.fromXY(at.x, at.y);
        if (!from || !to) return;
        const dt = to.time - from.time;
        const dp = to.price - from.price;
        updateDrawing(paneId, drag.drawingId, [
          { time: drag.origin[0].time + dt, price: drag.origin[0].price + dp },
          { time: drag.origin[1].time + dt, price: drag.origin[1].price + dp },
        ]);
      }
    },
    [paneId, panePoint, updateDrawing],
  );

  const endDrag = useCallback(
    (event?: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag.mode === 'create' && draft) {
        const at = event ? panePoint(event) : null;
        // A click without movement would create a zero-length shape (useless for
        // everything except a horizontal price level, which only needs the y).
        const distance = at && drag.start ? Math.hypot(at.x - drag.start.x, at.y - drag.start.y) : 0;
        const farEnough = draft.tool === 'horizontal' || distance >= 4;
        if (farEnough) addDrawing(paneId, { tool: draft.tool, points: draft.points, color: draft.color });
      }

      setDraft(null);
      dragRef.current = { mode: null, start: null, drawingId: null, origin: null };
      // Unlock only for the "move an existing drawing" case (tool = none).
      // While a drawing tool is still armed the persistent lock
      // (drawingActive effect) must stay – releasing it here would let the
      // next finger movement pan the chart mid-session.
      if (useChartStore.getState().tool === 'none') lockChart(false);
      if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [addDrawing, draft, lockChart, paneId, panePoint],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDraft(null);
      dragRef.current = { mode: null, start: null, drawingId: null, origin: null };
      lockChart(false);
      setTool('none');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lockChart, setTool]);

  /* ------------------------- touch: crosshair handle ------------------------
     With a drawing tool armed on a touch device, the finger draws – the
     library's own crosshair gesture is unavailable (panning is locked by
     design). This dedicated handle is the escape hatch: drag it to move the
     crosshair (mirrored into the other grid panes via the crosshair bus and
     read into the OHLC legend) without touching a drawing. */

  const isTouch = useIsTouchHost();

  const onCrosshairTouch = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const prim = drawingPrimRef.current;
      const chart = chartRef.current;
      if (!prim || !chart) return;
      const at = panePoint(event);
      if (!at) return;
      const point = prim.fromXY(at.x, at.y);
      if (!point) return;

      // Legend OHLC: nearest bar to the handle's time.
      const list = candlesRef.current;
      let lo = 0;
      let hi = list.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const t = list[mid]?.t ?? 0;
        if (t / 1000 < point.time) lo = mid + 1;
        else hi = mid;
      }
      const candidates = [list[lo - 1], list[lo]].filter(
        (candle): candle is Candle => candle != null && Number.isFinite(candle.t),
      );
      const nearest =
        candidates.length === 0
          ? null
          : candidates.reduce((best, candle) =>
              Math.abs(candle.t / 1000 - point.time) < Math.abs(best.t / 1000 - point.time) ? candle : best,
            );
      setHover(nearest);

      const price = mainRef.current ? Number(mainRef.current.coordinateToPrice(at.y)) : Number.NaN;
      const logical = chart.timeScale().coordinateToLogical(at.x);
      crosshairBus.publish({
        source: chartId,
        time: point.time,
        logical: logical == null ? null : Number(logical),
        price: Number.isFinite(price) ? price : null,
        paneIndex: 0,
        symbol: symbolRef.current,
      });
    },
    [chartId, panePoint],
  );

  /* ----------------------- protocol TVL mini-chart ------------------------- */

  useEffect(() => {
    const canvas = tvlCanvasRef.current;
    if (!canvas || tvl?.status !== 'ok' || tvl.points.length < 2) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      context.fillStyle = chartTheme.bg;
      context.fillRect(0, 0, rect.width, rect.height);

      const values = tvl.points.map((point) => point.value).filter((value) => Number.isFinite(value) && value >= 0);
      if (values.length < 2) return;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = Math.max(1, max - min);
      const left = 112;
      const right = Math.max(left + 20, rect.width - 80);
      const top = 13;
      const bottom = rect.height - 4;
      const points = tvl.points.map((point, index) => ({
        x: left + (right - left) * index / Math.max(1, tvl.points.length - 1),
        y: bottom - ((point.value - min) / range) * (bottom - top),
      }));
      const accent = chartTheme.accent;
      context.save();
      context.strokeStyle = withAlpha(chartTheme.grid, 0.4);
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(left, bottom + 0.5);
      context.lineTo(right, bottom + 0.5);
      context.stroke();
      const fill = context.createLinearGradient(0, top, 0, bottom);
      fill.addColorStop(0, withAlpha(accent, 0.2));
      fill.addColorStop(1, withAlpha(accent, 0));
      context.beginPath();
      context.moveTo(points[0]!.x, bottom);
      for (const point of points) context.lineTo(point.x, point.y);
      context.lineTo(points[points.length - 1]!.x, bottom);
      context.closePath();
      context.fillStyle = fill;
      context.fill();
      context.beginPath();
      points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
      context.strokeStyle = accent;
      context.lineWidth = 1.5;
      context.shadowColor = accent;
      context.shadowBlur = 4;
      context.stroke();
      context.shadowBlur = 0;
      context.font = '600 8px ui-monospace, SFMono-Regular, Menlo, monospace';
      context.textBaseline = 'middle';
      context.textAlign = 'left';
      context.fillStyle = chartTheme.muted;
      context.fillText(`TVL · ${(tvl.protocolName ?? symbol).toUpperCase()}`, 8, 11, left - 12);
      context.textAlign = 'right';
      context.fillStyle = chartTheme.text;
      context.fillText(compactUsd(tvl.points.at(-1)?.value ?? null), rect.width - 8, 11);
      context.restore();
    };

    draw();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [tvl, chartTheme, symbol]);

  /* -------------------------------- handle --------------------------------- */

  useImperativeHandle(
    ref,
    () => ({
      toPng: () => {
        const chart = chartRef.current;
        if (!chart) return null;
        try {
          const chartCanvas = chart.takeScreenshot(true, true);
          const tvlCanvas = tvlCanvasRef.current;
          if (!tvlCanvas || tvlCanvas.width <= 0 || tvlCanvas.height <= 0) return chartCanvas.toDataURL('image/png');
          const output = document.createElement('canvas');
          const tvlHeight = Math.round(tvlCanvas.height * chartCanvas.width / Math.max(1, tvlCanvas.width));
          output.width = chartCanvas.width;
          output.height = chartCanvas.height + tvlHeight;
          const context = output.getContext('2d');
          if (!context) return chartCanvas.toDataURL('image/png');
          context.drawImage(chartCanvas, 0, 0);
          context.drawImage(tvlCanvas, 0, chartCanvas.height, output.width, tvlHeight);
          return output.toDataURL('image/png');
        } catch {
          return null;
        }
      },
      fit: () => chartRef.current?.timeScale().fitContent(),
    }),
    [],
  );

  /* --------------------------------- render -------------------------------- */

  return (
    <div
      className="relative h-full w-full"
      data-watermark="www.NodeChart.cc"
      data-liq-radar={liqOn ? 'on' : 'off'}
    >
      <div
        ref={containerRef}
        className={cn('absolute inset-x-0 top-0', tvl?.status === 'ok' && 'bottom-10', tvl?.status !== 'ok' && 'bottom-0', drawingActive && 'cursor-crosshair')}
        style={{ touchAction: drawingActive ? 'none' : 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      {/* Dedicated touch handle: moves the crosshair while a drawing tool is
          armed (the finger itself is reserved for drawing). Sits above the
          TVL strip when that strip is present. */}
      {isTouch && drawingActive && (
        <CrosshairTouchHandle
          className={cn('absolute right-16 z-20', tvl?.status === 'ok' ? 'bottom-12' : 'bottom-3')}
          onMove={onCrosshairTouch}
        />
      )}
      {tvl?.status === 'ok' && (
        <div className="absolute inset-x-0 bottom-0 h-10 border-t border-line/60 bg-bg/90" data-tvl-strip="">
          <canvas
            ref={tvlCanvasRef}
            className="block h-full w-full"
            role="img"
            aria-label={`DeFiLlama protocol TVL history for ${tvl.protocolName ?? symbol}`}
            data-testid="protocol-tvl-strip"
          />
        </div>
      )}

      {/* legend – DOM on purpose: selectable, translatable, screen-reader friendly */}
      <div data-nc-legend="" className="pointer-events-none absolute left-2 top-1.5 z-10 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-micro-10 leading-tight">
        <span className="text-fg">{symbol}</span>
        <span className="text-faint">{intervalLabel ?? timeframe}</span>
        {shown && (
          <span data-nc-legend-ohlc="" className="text-muted">
            O <span className="text-fg">{shown.o.toFixed(digits)}</span> H{' '}
            <span className="text-fg">{shown.h.toFixed(digits)}</span> L{' '}
            <span className="text-fg">{shown.l.toFixed(digits)}</span> C{' '}
            <span className={shown.c >= shown.o ? 'text-bull' : 'text-bear'}>{shown.c.toFixed(digits)}</span>
            {barCountdown && !hover && (
              <span className="ml-2 tabular-nums text-warning" title="bar close">⏳{barCountdown}</span>
            )}
          </span>
        )}
        {computed.map((entry) => {
          const def = INDICATOR_LIBRARY[entry.kind];
          const key = def.outputs[0]?.key ?? '';
          const value = lastValue(entry.values?.[key]);
          const osc = def.placement === 'pane';
          return (
            <span key={entry.id} className="text-faint">
              {entry.title}{' '}
              <span className="text-muted">{value === undefined ? '–' : value.toFixed(osc ? 2 : digits)}</span>
            </span>
          );
        })}
      </div>

      {status !== 'open' && (
        <div className={cn('pointer-events-none absolute bottom-1.5 left-2 z-10 font-mono text-micro-10 uppercase tracking-cyber text-faint', tvl?.status === 'ok' && 'bottom-11')}>
          {status}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- helpers --------------------------------- */

function createMainSeries(
  chart: IChartApi,
  chartType: ChartType,
  theme: ChartTheme,
  digits: number,
  basePrice: number,
): AnySeries {
  const priceFormat = { type: 'price' as const, precision: digits, minMove: minMoveFor(digits) };

  switch (chartType) {
    case 'bars':
      return chart.addSeries(BarSeries, { upColor: theme.bull, downColor: theme.bear, priceFormat }) as AnySeries;
    case 'line':
      return chart.addSeries(LineSeries, {
        color: theme.primary,
        lineWidth: 2,
        priceFormat,
      }) as AnySeries;
    case 'baseline':
      return chart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: basePrice },
        topLineColor: theme.bull,
        topFillColor1: withAlpha(theme.bull, 0.28),
        topFillColor2: withAlpha(theme.bull, 0.04),
        bottomLineColor: theme.bear,
        bottomFillColor1: withAlpha(theme.bear, 0.04),
        bottomFillColor2: withAlpha(theme.bear, 0.28),
        lineWidth: 2,
        priceFormat,
      }) as AnySeries;
    case 'area':
      return chart.addSeries(AreaSeries, {
        lineColor: theme.primary,
        topColor: withAlpha(theme.primary, 0.35),
        bottomColor: withAlpha(theme.primary, 0.02),
        lineWidth: 2,
        priceFormat,
      }) as AnySeries;
    case 'heikinAshi':
    case 'candles':
    default:
      return chart.addSeries(CandlestickSeries, {
        upColor: theme.bull,
        downColor: theme.bear,
        wickUpColor: theme.bull,
        wickDownColor: theme.bear,
        borderUpColor: theme.bull,
        borderDownColor: theme.bear,
        priceFormat,
      }) as AnySeries;
  }
}

function applySeriesColors(main: AnySeries, chartType: ChartType, theme: ChartTheme): void {
  if (chartType === 'line') {
    main.applyOptions({ color: theme.primary } as never);
    return;
  }
  if (chartType === 'area') {
    main.applyOptions({
      lineColor: theme.primary,
      topColor: withAlpha(theme.primary, 0.35),
      bottomColor: withAlpha(theme.primary, 0.02),
    } as never);
    return;
  }
  if (chartType === 'bars') {
    main.applyOptions({ upColor: theme.bull, downColor: theme.bear } as never);
    return;
  }
  if (chartType === 'baseline') {
    main.applyOptions({
      topLineColor: theme.bull,
      topFillColor1: withAlpha(theme.bull, 0.28),
      topFillColor2: withAlpha(theme.bull, 0.04),
      bottomLineColor: theme.bear,
      bottomFillColor1: withAlpha(theme.bear, 0.04),
      bottomFillColor2: withAlpha(theme.bear, 0.28),
    } as never);
    return;
  }
  main.applyOptions({
    upColor: theme.bull,
    downColor: theme.bear,
    wickUpColor: theme.bull,
    wickDownColor: theme.bear,
    borderUpColor: theme.bull,
    borderDownColor: theme.bear,
  } as never);
}

/**
 * Drag handle for the crosshair on touch devices (see `onCrosshairTouch`).
 * 44 px hit target (WCAG 2.5.8), pointer-captured so the drag keeps working
 * even when the finger leaves the button, and visually "engaged" while held.
 */
function CrosshairTouchHandle({
  className,
  onMove,
}: {
  className?: string;
  onMove: (event: { clientX: number; clientY: number }) => void;
}) {
  const t = useTranslations('chart');
  const [dragging, setDragging] = useState(false);

  return (
    <button
      type="button"
      aria-label={t('crosshairHandle')}
      title={t('crosshairHandle')}
      data-nc-crosshair-handle=""
      className={cn(
        'flex size-11 items-center justify-center rounded-full border backdrop-blur-sm',
        className,
        dragging
          ? 'border-primary/80 bg-primary/14 text-primary shadow-neon-sm'
          : 'border-line bg-bg/90 text-muted',
      )}
      onPointerDown={(event) => {
        // Never let the container's drawing handlers see this gesture.
        event.stopPropagation();
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        onMove(event);
      }}
      onPointerMove={(event) => {
        if (dragging) onMove(event);
      }}
      onPointerUp={(event) => {
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => setDragging(false)}
    >
      <CrosshairIcon className="size-4" aria-hidden />
    </button>
  );
}

/** Candles + computed values → lightweight-charts series data (gaps skipped). */
function mapSeries(
  candles: Candle[],
  values: (number | undefined)[],
  style: 'line' | 'histogram' | 'band',
  color: string,
): (LineData<Time> | HistogramData<Time>)[] {
  const out: (LineData<Time> | HistogramData<Time>)[] = [];
  for (let i = 0; i < candles.length; i += 1) {
    const value = values[i];
    const candle = candles[i];
    if (value === undefined || candle === undefined) continue;
    const time = (candle.t / 1000) as UTCTimestamp;
    if (style === 'histogram') out.push({ time, value, color: value >= 0 ? color : withAlpha(color, 0.45) });
    else out.push({ time, value });
  }
  return out;
}
