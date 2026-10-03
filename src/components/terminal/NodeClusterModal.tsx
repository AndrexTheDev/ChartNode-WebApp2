// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Script from 'next/script';
import { Activity, Building2, Download, ExternalLink, EyeOff, Info, Network, ShieldAlert, Waves, X, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { MediumRectangleBanner } from '@/components/ads/MediumRectangleBanner';
import { trapTabKey } from '@/lib/focus-trap';
import type { Token } from '@/store/types';
import { selectProUnlocked, useProAccessStore } from '@/store/useProAccessStore';

interface NodeClusterModalProps {
  token: Token;
  open: boolean;
  onClose: () => void;
  /** Render in the terminal's tab/page flow instead of as a modal overlay. */
  mode?: 'modal' | 'inline';
  /** Show standalone-page 300×250 banner placements (not in terminal tabs). */
  showAds?: boolean;
}

interface LayerSettings {
  highlightWhales: boolean;
  showDevRisks: boolean;
  mevOverlay: boolean;
  hideCex: boolean;
  liquidationHeatmap: boolean;
}

const INITIAL_LAYERS: LayerSettings = {
  highlightWhales: true,
  showDevRisks: true,
  mevOverlay: true,
  hideCex: false,
  liquidationHeatmap: false,
};

interface SelectedShard {
  address: string;
  label: string;
  sharePct: number;
  venue: string;
  classification: string;
  confidence: string;
  risk: boolean;
  isMintable: boolean;
  isHoneypot: boolean;
  isUnlocked: boolean;
  isInsider: boolean;
  riskReasons: string[];
  tags: string[];
  chain: string | null;
}

interface NodeClusterExportOptions {
  scale?: number;
  watermark?: boolean;
  brandText?: string;
}

interface NodeClusterRuntimeApi {
  exportPng: (options?: NodeClusterExportOptions) => Promise<string | null>;
}

const EVM_EXPLORERS: Record<string, string> = {
  ethereum: 'https://etherscan.io/address/',
  base: 'https://basescan.org/address/',
  arbitrum: 'https://arbiscan.io/address/',
  polygon: 'https://polygonscan.com/address/',
  bsc: 'https://bscscan.com/address/',
  optimism: 'https://optimistic.etherscan.io/address/',
  avalanche: 'https://snowtrace.io/address/',
  fantom: 'https://ftmscan.com/address/',
  gnosis: 'https://gnosisscan.io/address/',
  celo: 'https://celoscan.io/address/',
  cronos: 'https://cronoscan.com/address/',
};

function shardExplorer(chain: string | null, address: string): string | null {
  if (chain === 'solana' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return `https://solscan.io/account/${encodeURIComponent(address)}`;
  }
  if (!/^0x[\da-f]{40}$/i.test(address)) return null;
  const base = chain ? EVM_EXPLORERS[chain.toLowerCase()] : null;
  return base ? `${base}${encodeURIComponent(address)}` : null;
}

const LAYER_CONTROLS = [
  { key: 'highlightWhales', icon: Waves, translation: 'highlightWhales' },
  { key: 'showDevRisks', icon: ShieldAlert, translation: 'showDevRisks' },
  { key: 'mevOverlay', icon: Zap, translation: 'mevOverlay' },
  { key: 'hideCex', icon: EyeOff, translation: 'hideCex' },
  { key: 'liquidationHeatmap', icon: Activity, translation: 'liquidationHeatmap' },
] as const;

/** Full-screen UI shell and event bridge for the standalone NodeCluster renderer. */
export function NodeClusterModal({ token, open, onClose, mode = 'modal', showAds = false }: NodeClusterModalProps) {
  const t = useTranslations('nodecluster');
  const isInline = mode === 'inline';
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);
  const wasOpenRef = useRef(open);
  const openSessionRef = useRef(open ? 1 : 0);
  const lastMountKeyRef = useRef<string | null>(null);
  const runtimeLoadedRef = useRef(false);
  const rendererPayloadRef = useRef({ token, layers: INITIAL_LAYERS });
  const [present, setPresent] = useState(open);
  const [layers, setLayers] = useState<LayerSettings>(INITIAL_LAYERS);
  const [rendererReady, setRendererReady] = useState(false);
  const [liquidationInfoOpen, setLiquidationInfoOpen] = useState(false);
  const [selectedShard, setSelectedShard] = useState<SelectedShard | null>(null);
  const selectedShardRef = useRef<SelectedShard | null>(null);
  const proUnlocked = useProAccessStore(selectProUnlocked);
  const [exportOpen, setExportOpen] = useState(false);
  const exportOpenRef = useRef(false);
  const [exportScale, setExportScale] = useState<2 | 3>(3);
  const [brandText, setBrandText] = useState('NodeChart');
  const [includeWatermark, setIncludeWatermark] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const handleClose = useCallback(() => {
    setSelectedShard(null);
    setLiquidationInfoOpen(false);
    setExportOpen(false);
    setExportError(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    openRef.current = open;
    if (open && !wasOpenRef.current) {
      openSessionRef.current += 1;
      lastMountKeyRef.current = null;
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    rendererPayloadRef.current = { token, layers };
  }, [token, layers]);

  useEffect(() => {
    selectedShardRef.current = selectedShard;
  }, [selectedShard]);

  useEffect(() => {
    exportOpenRef.current = exportOpen;
  }, [exportOpen]);

  useEffect(() => {
    const onShardSelect = (event: Event) => {
      const detail = (event as CustomEvent<SelectedShard>).detail;
      if (!detail || typeof detail.address !== 'string') return;
      setSelectedShard({
        ...detail,
        sharePct: Number.isFinite(detail.sharePct) ? detail.sharePct : 0,
        tags: Array.isArray(detail.tags) ? detail.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        riskReasons: Array.isArray(detail.riskReasons) ? detail.riskReasons.filter((reason): reason is string => typeof reason === 'string') : [],
      });
    };
    window.addEventListener('nodecluster:shard-select', onShardSelect);
    return () => window.removeEventListener('nodecluster:shard-select', onShardSelect);
  }, []);

  useEffect(() => {
    const onReady = () => setRendererReady(true);
    const onUnmount = () => setRendererReady(false);
    window.addEventListener('nodecluster:visualization-ready', onReady);
    window.addEventListener('nodecluster:unmount', onUnmount);
    return () => {
      window.removeEventListener('nodecluster:visualization-ready', onReady);
      window.removeEventListener('nodecluster:unmount', onUnmount);
    };
  }, []);

  useEffect(() => {
    if (open) {
      if (present) return;
      const frame = window.requestAnimationFrame(() => setPresent(true));
      return () => window.cancelAnimationFrame(frame);
    }
    if (!present) return;
    const timer = window.setTimeout(() => setPresent(false), 240);
    return () => window.clearTimeout(timer);
  }, [open, present]);

  useEffect(() => {
    if (!open || !present) return;
    if (!isInline) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (exportOpenRef.current) {
          setExportOpen(false);
          setExportError(null);
          return;
        }
        if (selectedShardRef.current) {
          setSelectedShard(null);
          return;
        }
        handleClose();
        return;
      }
      if (!isInline && event.key === 'Tab' && panelRef.current) trapTabKey(event, panelRef.current);
    };

    const previousBodyOverflow = document.body.style.overflow;
    document.addEventListener('keydown', onKey, true);
    if (!isInline) document.body.classList.add('nc-modal-open');
    let focusTimer = 0;
    if (!isInline) {
      document.body.style.overflow = 'hidden';
      focusTimer = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>('button')?.focus(), 0);
    }
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (!isInline) document.body.classList.remove('nc-modal-open');
      if (!isInline) {
        document.body.style.overflow = previousBodyOverflow;
        restoreFocusRef.current?.focus();
      }
      window.clearTimeout(focusTimer);
    };
  }, [open, present, isInline, handleClose]);

  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent('nodecluster:token-change', { detail: { token } }));
    window.dispatchEvent(new CustomEvent('nodecluster:layers-change', { detail: { token, layers } }));
  }, [open, token, layers]);

  useEffect(() => {
    if (!open) return;
    const tokenId = token.id;
    return () => {
      window.dispatchEvent(new CustomEvent('nodecluster:unmount', { detail: { tokenId } }));
    };
  }, [open, token.id]);

  const dispatchMount = useCallback(() => {
    if (!openRef.current || !canvasRef.current) return;
    const { token: currentToken, layers: currentLayers } = rendererPayloadRef.current;
    const mountKey = `${openSessionRef.current}:${currentToken.id}`;
    if (lastMountKeyRef.current === mountKey) return;
    lastMountKeyRef.current = mountKey;
    window.dispatchEvent(new CustomEvent('nodecluster:mount', {
      detail: { canvas: canvasRef.current, token: currentToken, layers: currentLayers },
    }));
  }, []);

  const handleRuntimeReady = useCallback(() => {
    if (runtimeLoadedRef.current) return;
    runtimeLoadedRef.current = true;
    dispatchMount();
  }, [dispatchMount]);

  useEffect(() => {
    if (!open || !present || !runtimeLoadedRef.current) return;
    const frame = window.requestAnimationFrame(dispatchMount);
    return () => window.cancelAnimationFrame(frame);
  }, [open, present, token.id, dispatchMount]);

  const toggleLayer = (key: keyof LayerSettings) => {
    setLayers((previous) => ({ ...previous, [key]: !previous[key] }));
  };

  const downloadMap = async (options: NodeClusterExportOptions) => {
    setExporting(true);
    setExportError(null);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      const runtime = (window as unknown as { NodeCluster?: NodeClusterRuntimeApi }).NodeCluster;
      const dataUrl = await runtime?.exportPng(options);
      if (!dataUrl) throw new Error('PNG export failed.');
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `nodechart-${token.symbol.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-map.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setExportOpen(false);
    } catch {
      setExportError(t('export.error'));
    } finally {
      setExporting(false);
    }
  };

  const openExport = () => {
    setExportError(null);
    if (proUnlocked) setExportOpen(true);
    else void downloadMap({ scale: 1, watermark: true });
  };

  if (!present) return null;

  const tokenName = token.base || token.symbol.split('/')[0] || token.symbol;
  const shardUrl = selectedShard ? shardExplorer(selectedShard.chain, selectedShard.address) : null;
  const shardRisk = Boolean(selectedShard?.risk || selectedShard?.isMintable || selectedShard?.isHoneypot
    || selectedShard?.isUnlocked || selectedShard?.isInsider);
  const shardSecurity = !selectedShard || selectedShard.confidence === 'unverified'
    ? t('shard.securityUnverified')
    : shardRisk ? t('shard.securityFlagged') : t('shard.securityNoFlags');

  return (
    <div
      className={cn(
        isInline
          ? 'relative z-0 flex min-h-0 w-full flex-1 items-stretch justify-center bg-slate-950'
          : 'fixed inset-0 z-[100] flex items-stretch justify-center bg-black/75 p-0 backdrop-blur-xl transition-opacity duration-200 ease-out',
        !isInline && (open ? 'opacity-100' : 'pointer-events-none opacity-0'),
      )}
      aria-hidden={!open}
      onMouseDown={!isInline ? (event) => {
        if (event.target === event.currentTarget) handleClose();
      } : undefined}
    >
      <section
        ref={panelRef}
        role={isInline ? undefined : 'dialog'}
        aria-modal={isInline ? undefined : true}
        aria-labelledby={isInline ? undefined : titleId}
        aria-hidden={!open}
        inert={!open}
        id={isInline ? 'nodecluster-inline' : 'nodecluster-modal'}
        data-testid={isInline ? 'nodecluster-inline' : 'nodecluster-modal'}
        className={cn(
          'relative flex w-full flex-col overflow-hidden border border-slate-700/70 bg-slate-950/95 text-slate-100',
          isInline ? 'h-full min-h-0 flex-1' : 'h-[100dvh] shadow-[0_0_80px_-24px_rgba(34,211,238,0.24)] transition-[transform,opacity] duration-200 ease-out',
          !isInline && (open ? 'translate-y-0 scale-100 opacity-100 animate-fade-up' : 'translate-y-3 scale-[0.99] opacity-90'),
        )}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.10),transparent_44%),linear-gradient(rgba(148,163,184,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.035)_1px,transparent_1px)] bg-[size:auto,36px_36px,36px_36px]" />

        <header className="relative z-10 flex min-h-16 shrink-0 items-center gap-3 border-b border-slate-700/70 bg-slate-950/75 px-3 py-2 backdrop-blur-xl sm:px-5">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-cyan-300 shadow-[0_0_22px_-8px_rgba(34,211,238,0.75)]">
            <Network className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            {isInline ? (
              <h2 className="truncate font-display text-sm font-bold uppercase tracking-[0.18em] text-slate-100 sm:text-base">
                {t('title')}
              </h2>
            ) : (
              <h1 id={titleId} className="truncate font-display text-sm font-bold uppercase tracking-[0.18em] text-slate-100 sm:text-base">
                {t('title')}
              </h1>
            )}
            <div className="mt-0.5 flex min-w-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">
              <span className="shrink-0 text-slate-500">{t('token')}</span>
              <span className="truncate font-semibold text-cyan-200">{tokenName}</span>
              <span className="truncate rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-slate-300">{token.symbol}</span>
            </div>
          </div>
          {rendererReady && (
            <span className="hidden items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/5 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.15em] text-emerald-300/80 lg:inline-flex">
              <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" aria-hidden />
              {t('canvasReady')}
            </span>
          )}
          <button
            type="button"
            onClick={openExport}
            aria-label={t('downloadMap')}
            title={t('downloadMap')}
            data-testid="nodecluster-download-map"
            disabled={!rendererReady || exporting}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-cyan-400/35 bg-cyan-400/10 px-2.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-cyan-200 transition-colors hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
          >
            <Download className="size-3.5" aria-hidden />
            <span className="hidden sm:inline">{t('downloadMap')}</span>
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('close')}
            title={t('close')}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/70 text-slate-300 transition-colors hover:border-rose-400/60 hover:bg-rose-400/10 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <nav aria-label={t('layerTitle')} className="relative z-10 flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800/90 bg-slate-950/60 px-3 py-2.5 backdrop-blur-xl sm:px-5">
          <span className="mr-1 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">{t('layerTitle')}</span>
          {LAYER_CONTROLS.map(({ key, icon: Icon, translation }) => {
            const active = layers[key];
            const control = (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                data-nodecluster-layer={key}
                data-active={active ? 'true' : 'false'}
                onClick={() => toggleLayer(key)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400',
                  active
                    ? 'border-cyan-400/45 bg-cyan-400/10 text-cyan-200 shadow-[0_0_18px_-10px_rgba(34,211,238,0.8)] hover:bg-cyan-400/15'
                    : 'border-slate-700/80 bg-slate-900/60 text-slate-500 hover:border-slate-500 hover:text-slate-300',
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                <span>{t(translation)}</span>
                <span aria-hidden className={cn('ml-1 h-1.5 w-1.5 rounded-full', active ? 'bg-cyan-300' : 'bg-slate-600')} />
              </button>
            );
            if (key !== 'liquidationHeatmap') return control;
            return (
              <div key={key} className="relative inline-flex items-center gap-1">
                {control}
                <button
                  type="button"
                  aria-label={t('liquidationInfoLabel')}
                  aria-expanded={liquidationInfoOpen}
                  aria-controls="nodecluster-liquidation-info"
                  aria-describedby={liquidationInfoOpen ? 'nodecluster-liquidation-info' : undefined}
                  onClick={() => setLiquidationInfoOpen((value) => !value)}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-700/80 bg-slate-900/60 text-slate-400 transition-colors hover:border-cyan-300/40 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                >
                  <Info className="size-3.5" aria-hidden />
                </button>
                {liquidationInfoOpen && (
                  <span id="nodecluster-liquidation-info" role="tooltip" className="absolute left-0 top-full z-50 mt-1 w-64 max-w-[85vw] rounded-md border border-indigo-300/25 bg-slate-950/95 px-3 py-2 font-mono text-[9px] leading-relaxed text-slate-200 shadow-xl">
                    {t('liquidationInfo')}
                  </span>
                )}
              </div>
            );
          })}
          <span className="basis-full rounded border border-amber-200/10 bg-amber-200/[0.025] px-2 py-1 font-mono text-[8px] leading-relaxed text-amber-100/60 sm:ml-auto sm:basis-auto">
            {t('dataTransparency')}
          </span>
        </nav>

        <div className="relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-950/70 xl:flex-row">
          <main className="relative z-0 order-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-950/70 xl:order-2">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(15,23,42,0.12),rgba(2,6,23,0.6))]" />
            {/* NodeCluster owns backing-store DPR and its ResizeObserver so adaptive quality stays authoritative. */}
            <canvas
              ref={canvasRef}
              id="nodecluster-canvas"
              data-nodecluster-canvas=""
              data-token-id={token.id}
              data-token-symbol={token.symbol}
              data-highlight-whales={layers.highlightWhales ? 'true' : 'false'}
              data-show-dev-risks={layers.showDevRisks ? 'true' : 'false'}
              data-mev-overlay={layers.mevOverlay ? 'true' : 'false'}
              data-hide-cex={layers.hideCex ? 'true' : 'false'}
              data-liquidation-heatmap={layers.liquidationHeatmap ? 'true' : 'false'}
              role="img"
              aria-label={`${t('canvasLabel')}. ${t('canvasControls')}`}
              data-testid="nodecluster-canvas"
              className="absolute inset-0 size-full"
            />
            <div
              aria-hidden={rendererReady}
              className={cn(
                'pointer-events-none absolute inset-x-0 top-1/2 z-10 mx-auto flex max-w-lg -translate-y-1/2 flex-col items-center px-6 text-center transition-opacity duration-300',
                rendererReady ? 'opacity-0' : 'opacity-100',
              )}
            >
              <span className="mb-3 inline-flex size-12 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/5 text-cyan-300/70">
                <Network className="size-5" aria-hidden />
              </span>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t('canvasReady')}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">{t('canvasHint')}</p>
            </div>
            <div aria-hidden className="pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[90%] -translate-x-1/2 rounded border border-slate-700/70 bg-slate-950/75 px-2.5 py-1.5 text-center font-mono text-[8px] uppercase tracking-[0.1em] text-slate-400 backdrop-blur-sm sm:text-[9px]">
              {t('canvasControls')}
            </div>

            {selectedShard && (
              <>
                <button
                  type="button"
                  aria-label={t('shard.close')}
                  onClick={() => setSelectedShard(null)}
                  className="absolute inset-0 z-20 bg-slate-950/25 backdrop-blur-[1px]"
                />
                <aside
                  role="dialog"
                  aria-modal="false"
                  aria-label={t('shard.title')}
                  data-testid="nodecluster-shard-drawer"
                  className="absolute inset-x-0 bottom-0 z-30 flex max-h-[76%] flex-col rounded-t-2xl border border-cyan-300/25 bg-slate-950/80 text-slate-100 shadow-[0_-18px_70px_-25px_rgba(34,211,238,0.4)] backdrop-blur-2xl md:inset-y-0 md:left-auto md:right-0 md:h-full md:max-h-none md:w-[22rem] md:rounded-none md:rounded-l-2xl"
                >
                  <header className="flex shrink-0 items-center gap-3 border-b border-slate-700/70 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">{t('shard.title')}</h2>
                      <p className="mt-1 truncate font-display text-sm font-semibold text-slate-100">{selectedShard.label}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedShard(null)}
                      aria-label={t('shard.close')}
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900/80 text-slate-300 hover:border-cyan-300/50 hover:text-cyan-100"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </header>
                  <div className="flex-1 space-y-3 overflow-y-auto p-4">
                    <section className="rounded-lg border border-slate-700/80 bg-slate-900/65 p-3">
                      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">{t('shard.address')}</p>
                      <code className="mt-2 block break-all font-mono text-[11px] leading-relaxed text-slate-200">{selectedShard.address}</code>
                    </section>
                    <div className="grid grid-cols-2 gap-3">
                      <section className="rounded-lg border border-slate-700/80 bg-slate-900/65 p-3">
                        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">{t('shard.share')}</p>
                        <p className="mt-2 font-mono text-lg font-bold tabular-nums text-cyan-200">{selectedShard.sharePct.toFixed(2)}%</p>
                      </section>
                      <section className="rounded-lg border border-slate-700/80 bg-slate-900/65 p-3">
                        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">{t('shard.walletTag')}</p>
                        <p className="mt-2 break-words font-mono text-[10px] font-semibold uppercase text-slate-200">
                          {selectedShard.tags.length ? selectedShard.tags.join(' · ') : selectedShard.classification || selectedShard.venue || t('shard.unknown')}
                        </p>
                      </section>
                    </div>
                    <section className={cn(
                      'rounded-lg border p-3',
                      shardRisk ? 'border-rose-400/35 bg-rose-400/5' : 'border-amber-300/25 bg-amber-300/5',
                    )}>
                      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">{t('shard.security')}</p>
                      <p className={cn('mt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]', shardRisk ? 'text-rose-200' : 'text-amber-100')}>
                        {shardSecurity}
                      </p>
                      {selectedShard.riskReasons.length > 0 && (
                        <ul className="mt-2 list-inside list-disc space-y-1 text-[10px] leading-relaxed text-slate-400">
                          {selectedShard.riskReasons.map((reason) => <li key={reason}>{reason}</li>)}
                        </ul>
                      )}
                      <p className="mt-2 text-[9px] leading-relaxed text-slate-500">{t('shard.securityNote')}</p>
                    </section>
                    {shardUrl ? (
                      <a
                        href={shardUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-cyan-300/35 bg-cyan-300/10 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-cyan-100 transition-colors hover:bg-cyan-300/20"
                      >
                        <ExternalLink className="size-3.5" aria-hidden />
                        {t('shard.explorer')}
                      </a>
                    ) : (
                      <p className="rounded-lg border border-slate-700/70 bg-slate-900/50 p-3 font-mono text-[9px] leading-relaxed text-slate-500">{t('shard.explorerUnavailable')}</p>
                    )}
                  </div>
                </aside>
              </>
            )}
          </main>
          {showAds && (
            <div
              role="group"
              aria-label={t('adLabel')}
              data-testid="nodecluster-ad-layout"
              className="relative z-20 order-2 flex min-h-[250px] shrink-0 gap-3 overflow-x-auto border-t border-slate-800 bg-slate-950 xl:contents"
            >
              <aside
                aria-label={t('adLabel')}
                data-testid="nodecluster-left-ad-drawer"
                className="relative flex h-[250px] w-[300px] shrink-0 flex-col items-center justify-center xl:order-1 xl:h-auto xl:w-[320px] xl:justify-start xl:gap-3 xl:overflow-y-auto xl:border-r xl:border-slate-800 xl:bg-slate-950/90 xl:p-2"
              >
                <div className="hidden w-full items-center justify-between gap-2 border-b border-slate-800 px-1 pb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500 xl:flex">
                  <span>{t('adLabel')}</span>
                  <span className="shrink-0 tabular-nums">{t('adSize')}</span>
                </div>
                <MediumRectangleBanner slot="left" className="self-center" />
              </aside>
              <div className="relative h-[250px] w-[300px] shrink-0 xl:absolute xl:bottom-3 xl:right-3 xl:z-20">
                <MediumRectangleBanner slot="right" className="pointer-events-auto" />
              </div>
            </div>
          )}
        </div>

        <div className="relative z-10 flex min-h-8 shrink-0 items-center justify-between gap-3 border-t border-slate-800/80 bg-slate-950/90 px-3 py-1.5 font-mono text-[9px] text-slate-500 sm:px-5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 md:flex-row md:items-center md:gap-3">
            <span className="truncate">{t('disclaimer')}</span>
            <span className="truncate text-amber-200/60" title={t('dataCaveat')}>{t('dataCaveat')}</span>
          </div>
          <span className="hidden shrink-0 items-center gap-1.5 uppercase tracking-[0.12em] md:inline-flex">
            <Building2 className="size-3" aria-hidden />
            NodeCluster
          </span>
        </div>

        {exportOpen && (
          <div className="absolute inset-0 z-[80] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-md" data-testid="nodecluster-export-dialog">
            <button
              type="button"
              aria-label={t('export.cancel')}
              onClick={() => setExportOpen(false)}
              className="absolute inset-0 cursor-default"
            />
            <section role="dialog" aria-modal="true" aria-labelledby="nodecluster-export-title" className="relative z-10 w-full max-w-md rounded-xl border border-cyan-300/25 bg-slate-950/95 p-4 shadow-[0_0_60px_-20px_rgba(34,211,238,0.5)] sm:p-5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 id="nodecluster-export-title" className="font-display text-sm font-bold uppercase tracking-[0.12em] text-cyan-100">{t('export.title')}</h2>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{t('export.proHint')}</p>
                </div>
                <button type="button" onClick={() => setExportOpen(false)} aria-label={t('export.cancel')} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-400 hover:text-slate-100">
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">{t('export.resolution')}</span>
                  <select
                    value={exportScale}
                    onChange={(event) => setExportScale(Number(event.target.value) === 2 ? 2 : 3)}
                    className="h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 font-mono text-xs text-slate-100 outline-none focus:border-cyan-300/60"
                  >
                    <option value={2}>{t('export.scale2')}</option>
                    <option value={3}>{t('export.scale3')}</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">{t('export.brand')}</span>
                  <input
                    type="text"
                    maxLength={40}
                    value={brandText}
                    onChange={(event) => setBrandText(event.target.value)}
                    placeholder={t('export.brandPlaceholder')}
                    className="h-10 w-full rounded-md border border-slate-700 bg-slate-900 px-3 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/60"
                  />
                </label>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-700/80 bg-slate-900/60 px-3">
                  <input type="checkbox" checked={includeWatermark} onChange={(event) => setIncludeWatermark(event.target.checked)} className="accent-cyan-300" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-300">{t('export.includeWatermark')}</span>
                </label>
              </div>
              {exportError && <p role="alert" className="mt-3 text-[10px] text-rose-300">{exportError}</p>}
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setExportOpen(false)} className="h-10 rounded-md border border-slate-700 px-4 font-mono text-[9px] uppercase tracking-[0.12em] text-slate-400 hover:text-slate-100">{t('export.cancel')}</button>
                <button
                  type="button"
                  disabled={exporting}
                  onClick={() => void downloadMap({ scale: exportScale, watermark: includeWatermark, brandText: brandText.trim() || 'NodeChart' })}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-cyan-300/45 bg-cyan-300/10 px-4 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-50"
                >
                  <Download className="size-3.5" aria-hidden />
                  {exporting ? t('export.exporting') : t('export.download')}
                </button>
              </div>
            </section>
          </div>
        )}
      </section>

      {open && (
        <Script
          id="nodecluster-runtime"
          src="/nodecluster.js"
          strategy="afterInteractive"
          onReady={handleRuntimeReady}
        />
      )}
    </div>
  );
}
