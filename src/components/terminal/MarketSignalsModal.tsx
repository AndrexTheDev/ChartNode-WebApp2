// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, Check, ExternalLink, LockKeyhole, Radar, RefreshCw, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { WalletsList } from '@/components/support/WalletsList';
import { trapTabKey } from '@/lib/focus-trap';
import { cn } from '@/lib/cn';
import { compactUsd, pct, usd } from '@/lib/format';
import { MIN_PRO_DONATION_USD, type DonationChain } from '@/lib/donation-wallets';
import {
  fetchCrossChainSpread,
  fetchProtocolTvl,
  isHighDilutionRisk,
  marketCapToFdvPercent,
  fetchTrendRadar,
  fetchVolumeComparison,
  type CrossChainSpread,
  type ProtocolTvl,
  type TrendReading,
  type VolumeComparison,
} from '@/api/market-signals';
import { verifyDonationTransaction } from '@/api/verify-donation';
import type { DonationVerificationResult } from '@/api/verify-donation';
import { selectProAccessProof, selectProAccessStatus, selectProUnlocked, useProAccessStore } from '@/store/useProAccessStore';
import { useViralStore } from '@/store/useViralStore';
import type { Token } from '@/store/types';

interface MarketSignalsModalProps {
  token: Token;
  open: boolean;
  onClose: () => void;
}

const EMPTY_SPREAD: CrossChainSpread = { cexPriceUsd: null, cexSource: 'Binance Spot', rows: [] };

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type KeyedSignal<T> = { key: string; value: T; state: LoadState };

function trendClass(direction: TrendReading['direction']): string {
  if (direction === 'bullish') return 'border-emerald-400/35 bg-emerald-400/8 text-emerald-200';
  if (direction === 'bearish') return 'border-rose-400/35 bg-rose-400/8 text-rose-200';
  if (direction === 'mixed') return 'border-amber-300/35 bg-amber-300/8 text-amber-100';
  return 'border-slate-700 bg-slate-900/70 text-slate-500';
}

export function MarketSignalsModal({ token, open, onClose }: MarketSignalsModalProps) {
  const t = useTranslations('marketSignals');
  const support = useTranslations('support');
  const panelRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const isPro = useProAccessStore(selectProUnlocked);
  const proof = useProAccessStore(selectProAccessProof);
  const proStatus = useProAccessStore(selectProAccessStatus);
  const grant = useProAccessStore((state) => state.grant);
  const setChecking = useProAccessStore((state) => state.setChecking);
  const setUnavailable = useProAccessStore((state) => state.setUnavailable);
  const lock = useProAccessStore((state) => state.lock);
  const [volume, setVolume] = useState<VolumeComparison | null>(null);
  const [volumeState, setVolumeState] = useState<LoadState>('idle');
  const [trends, setTrends] = useState<TrendReading[]>([]);
  const [trendState, setTrendState] = useState<LoadState>('idle');
  const [spreadResult, setSpreadResult] = useState<KeyedSignal<CrossChainSpread> | null>(null);
  const [tvlResult, setTvlResult] = useState<KeyedSignal<ProtocolTvl | null> | null>(null);
  const signalKey = open && isPro ? `${token.id}:${token.base}:${token.contract ?? ''}:${token.chain ?? ''}` : '';
  const tvlKey = signalKey && token.venue === 'DEX' ? `${signalKey}:tvl` : '';
  const spread = signalKey && spreadResult?.key === signalKey ? spreadResult.value : EMPTY_SPREAD;
  const spreadState: LoadState = !signalKey ? 'idle' : spreadResult?.key === signalKey ? spreadResult.state : 'loading';
  const tvl = tvlKey && tvlResult?.key === tvlKey ? tvlResult.value : null;
  const tvlState: LoadState = !tvlKey ? 'idle' : tvlResult?.key === tvlKey ? tvlResult.state : 'loading';
  const tokenomicsPair = spread.rows.find((row) => marketCapToFdvPercent(row.marketCapUsd, row.fdvUsd) != null);
  const marketCapToFdvPct = tokenomicsPair ? marketCapToFdvPercent(tokenomicsPair.marketCapUsd, tokenomicsPair.fdvUsd) : null;
  const highDilutionRisk = isHighDilutionRisk(marketCapToFdvPct);
  const [chain, setChain] = useState<DonationChain>('ethereum');
  const [txHash, setTxHash] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<DonationVerificationResult['status'] | null>(null);

  const verifyProof = async (requestedChain: DonationChain, hash: string, recheck = false) => {
    setVerifying(true);
    setVerificationMessage(null);
    if (recheck) setChecking();
    try {
      const result = await verifyDonationTransaction(requestedChain, hash);
      setVerificationStatus(result.status);
      if (result.status === 'verified' && result.proof) {
        await grant(result.proof);
        if (!recheck) useViralStore.getState().registerDonation(result.proof.amountUsd);
        setTxHash('');
        setVerificationMessage(t('verifiedMessage', { amount: compactUsd(result.proof.amountUsd) }));
        return;
      }
      const message = result.status === 'below-minimum'
        ? t('belowMinimumMessage', { amount: compactUsd(result.amountUsd ?? 0), minimum: minAmount })
        : t(`verification.${result.status}`);
      setVerificationMessage(message);
      if (recheck && (result.status === 'pending' || result.status === 'unavailable')) {
        setUnavailable(message);
      } else if (recheck && result.status !== 'verified') {
        lock(message);
      }
    } catch {
      const message = t('verification.unavailable');
      setVerificationStatus('unavailable');
      setVerificationMessage(message);
      if (recheck) setUnavailable(message);
    } finally {
      setVerifying(false);
    }
  };

  const loadVolume = async (signal?: AbortSignal) => {
    setVolumeState('loading');
    try {
      const result = await fetchVolumeComparison(signal);
      if (!signal?.aborted) {
        setVolume(result);
        setVolumeState('ready');
      }
    } catch {
      if (!signal?.aborted) setVolumeState('error');
    }
  };

  const loadTrends = async (signal?: AbortSignal) => {
    setTrendState('loading');
    try {
      const result = await fetchTrendRadar(token, signal);
      if (!signal?.aborted) {
        setTrends(result);
        setTrendState(result.some((reading) => reading.direction !== 'unavailable') ? 'ready' : 'error');
      }
    } catch {
      if (!signal?.aborted) setTrendState('error');
    }
  };

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const initialLoad = window.setTimeout(() => {
      void loadVolume(controller.signal);
      void loadTrends(controller.signal);
    }, 0);
    const volumeTimer = window.setInterval(() => void loadVolume(controller.signal), 60_000);
    const trendTimer = window.setInterval(() => void loadTrends(controller.signal), 60_000);
    return () => {
      controller.abort();
      window.clearTimeout(initialLoad);
      window.clearInterval(volumeTimer);
      window.clearInterval(trendTimer);
    };
    // Keep provider calls scoped to the active instrument and modal session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token.id]);

  useEffect(() => {
    if (!signalKey) return;
    const controller = new AbortController();
    let alive = true;
    const loadSpread = async () => {
      try {
        const value = await fetchCrossChainSpread(token, null, controller.signal);
        if (alive && !controller.signal.aborted) {
          setSpreadResult({ key: signalKey, value, state: value.rows.length > 0 ? 'ready' : 'error' });
        }
      } catch {
        if (alive && !controller.signal.aborted) {
          setSpreadResult({ key: signalKey, value: EMPTY_SPREAD, state: 'error' });
        }
      }
    };
    const initialLoad = window.setTimeout(() => void loadSpread(), 0);
    const interval = window.setInterval(() => void loadSpread(), 30_000);
    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [signalKey, token]);

  useEffect(() => {
    if (!tvlKey) return;
    const controller = new AbortController();
    let alive = true;
    const initialLoad = window.setTimeout(() => {
      void fetchProtocolTvl(token.base, controller.signal)
        .then((value) => {
          if (alive && !controller.signal.aborted) setTvlResult({ key: tvlKey, value, state: 'ready' });
        })
        .catch(() => {
          if (alive && !controller.signal.aborted) setTvlResult({ key: tvlKey, value: null, state: 'error' });
        });
    }, 0);
    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(initialLoad);
    };
  }, [tvlKey, token.base]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      } else if (event.key === 'Tab' && panelRef.current) {
        trapTabKey(event, panelRef.current);
      }
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey, true);
    const timer = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>('button')?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previous;
      window.clearTimeout(timer);
      restoreFocusRef.current?.focus();
    };
  }, [open, onClose]);

  const trendRows = trends;
  const minAmount = `$${MIN_PRO_DONATION_USD}`;
  const normalizedHash = txHash.trim();
  const isBelowMinimum = verificationStatus === 'below-minimum';

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex justify-end bg-black/60 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="market-signals-title"
        data-testid="market-signals-panel"
        className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-cyan-300/15 bg-slate-950/95 text-slate-100 shadow-[-30px_0_100px_-40px_rgba(34,211,238,0.35)] animate-fade-up max-sm:max-w-none"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-800 px-4 py-3 sm:px-6">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200"><Radar className="size-4" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h2 id="market-signals-title" className="truncate font-display text-sm font-bold uppercase tracking-[0.15em] text-slate-100">{t('title')}</h2>
            <p className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">{token.symbol} · {token.venue}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('close')} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-400 transition-colors hover:border-rose-400/50 hover:text-rose-200"><X className="size-4" aria-hidden /></button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          <section className="rounded-xl border border-cyan-300/20 bg-[radial-gradient(ellipse_at_top_right,rgba(34,211,238,0.10),transparent_55%),rgba(15,23,42,0.45)] p-4">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-cyan-200" aria-hidden />
              <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-cyan-100">{t('freeTitle')}</h3>
              <span className="ml-auto rounded-full border border-emerald-300/25 bg-emerald-300/5 px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-emerald-200">{t('freeBadge')}</span>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[0.92fr_1.08fr]">
              <div className="rounded-lg border border-slate-800 bg-slate-950/45 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">{t('volumeRatio')}</p>
                    <p className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-50">{volume ? `${volume.dexToBinanceRatio.toFixed(3)}×` : '—'}</p>
                  </div>
                  <button type="button" onClick={() => void loadVolume()} aria-label={t('refresh')} className="inline-flex size-8 items-center justify-center rounded-md border border-slate-700 text-slate-400 hover:text-cyan-100"><RefreshCw className={cn('size-3.5', volumeState === 'loading' && 'animate-spin')} aria-hidden /></button>
                </div>
                <div className="mt-3 space-y-2 font-mono text-[9px]">
                  <div className="flex justify-between gap-3"><span className="text-slate-500">{t('dex24h')}</span><span className="tabular-nums text-slate-200">{volume ? compactUsd(volume.dexVolumeUsd) : '—'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-slate-500">{t('binance24h')}</span><span className="tabular-nums text-slate-200">{volume ? compactUsd(volume.binanceSpotVolumeUsd) : '—'}</span></div>
                </div>
                <p className="mt-3 border-t border-slate-800 pt-2 text-[9px] leading-relaxed text-slate-500">{t('volumeScope')}</p>
                {volumeState === 'error' && <p role="status" className="mt-2 text-[9px] text-amber-200/80">{t('dataUnavailable')}</p>}
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/45 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">{t('trendTitle')}</p>
                    <p className="mt-1 text-[9px] text-slate-500">{t('trendMethod')}</p>
                  </div>
                  <button type="button" onClick={() => void loadTrends()} aria-label={t('refresh')} className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-400 hover:text-cyan-100"><RefreshCw className={cn('size-3.5', trendState === 'loading' && 'animate-spin')} aria-hidden /></button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-5">
                  {trendRows.length > 0 ? trendRows.map((reading) => (
                    <div key={reading.timeframe} className={cn('rounded-md border px-2 py-2', trendClass(reading.direction))}>
                      <div className="flex items-center justify-between gap-1 font-mono">
                        <span className="text-[9px] font-bold">{reading.timeframe}</span>
                        <span className="text-[7px] uppercase tracking-[0.08em]">{t(`trend.${reading.direction}`)}</span>
                      </div>
                      <p className="mt-1 font-mono text-[8px] opacity-70">{reading.candleCount} {t('bars')}</p>
                    </div>
                  )) : <p className="col-span-full py-3 text-center font-mono text-[9px] text-slate-600">{trendState === 'loading' ? t('loading') : t('dataUnavailable')}</p>}
                </div>
                {trendState === 'error' && <p role="status" className="mt-2 text-[9px] text-amber-200/80">{t('trendUnavailable')}</p>}
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-violet-300/20 bg-slate-900/45">
            <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
              <ShieldCheck className="size-4 text-violet-200" aria-hidden />
              <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-violet-100">{t('proTitle')}</h3>
              {isPro ? <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-300/5 px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-emerald-200"><Check className="size-3" aria-hidden />{t('unlocked')}</span> : <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-slate-500"><LockKeyhole className="size-3" aria-hidden />{t('locked')}</span>}
            </header>

            {!isPro ? (
              <div className="space-y-4 p-4">
                <div className="rounded-lg border border-slate-800 bg-slate-950/55 p-3">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-200">{t('unlockHeading')}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{t('unlockDescription', { amount: minAmount })}</p>
                  <p className="mt-2 text-[9px] leading-relaxed text-slate-500">{t('verificationPolicy')}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
                  <label className="block">
                    <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">{t('network')}</span>
                    <select value={chain} onChange={(event) => setChain(event.target.value as DonationChain)} className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-2 font-mono text-[10px] text-slate-200 outline-none focus:border-violet-300/60">
                      <option value="ethereum">{t('networkOptions.ethereum')}</option>
                      <option value="solana">{t('networkOptions.solana')}</option>
                      <option value="bitcoin">{t('networkOptions.bitcoin')}</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">{t('transactionHash')}</span>
                    <input
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={100}
                      value={txHash}
                      onChange={(event) => setTxHash(event.target.value)}
                      placeholder={chain === 'ethereum' ? '0x…' : chain === 'bitcoin' ? 'txid' : 'signature'}
                      className="h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 font-mono text-[10px] text-slate-100 outline-none placeholder:text-slate-700 focus:border-violet-300/60"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={verifying || normalizedHash.length < 32}
                  onClick={() => void verifyProof(chain, normalizedHash)}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-violet-300/35 bg-violet-300/10 px-3 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-violet-100 transition-colors hover:bg-violet-300/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {verifying ? <RefreshCw className="size-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="size-3.5" aria-hidden />}
                  {verifying ? t('verifying') : t('verifyButton')}
                </button>
                {verificationMessage && (
                  <p role="status" className={cn('rounded-md border px-3 py-2 text-[9px] leading-relaxed', isBelowMinimum ? 'border-amber-300/25 bg-amber-300/5 text-amber-100' : verificationStatus === 'verified' ? 'border-emerald-300/25 bg-emerald-300/5 text-emerald-100' : 'border-rose-300/20 bg-rose-300/5 text-rose-200')}>
                    {verificationMessage}
                  </p>
                )}
                {proof && proStatus === 'unavailable' && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300/20 bg-amber-300/5 px-3 py-2">
                    <p className="min-w-0 flex-1 text-[9px] leading-relaxed text-amber-100/80">{t('recheckUnavailable')}</p>
                    <button type="button" disabled={verifying} onClick={() => void verifyProof(proof.chain, proof.txHash, true)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-200/25 px-2 font-mono text-[8px] uppercase text-amber-100 disabled:opacity-50"><RefreshCw className={cn('size-3', verifying && 'animate-spin')} aria-hidden />{t('recheck')}</button>
                  </div>
                )}
                <WalletsList title={t('walletsTitle')} copyLabel={support('copy')} copiedLabel={support('copied')} />
                <p className="text-[9px] leading-relaxed text-slate-600">{t('localProofNote')}</p>
              </div>
            ) : (
              <div className="space-y-4 p-4">
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-300/20 bg-emerald-300/5 px-3 py-2.5">
                  <Check className="size-3.5 text-emerald-200" aria-hidden />
                  <span className="font-mono text-[9px] uppercase tracking-[0.09em] text-emerald-100">{t('verifiedSupporter')}</span>
                  {proof && <code className="ml-auto max-w-full truncate font-mono text-[8px] text-slate-500">{proof.txHash.slice(0, 10)}…{proof.txHash.slice(-8)}</code>}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <ProFeature title={t('whaleTitle')} detail={t('whaleDescription')} />
                  <ProFeature title={t('tvlTitle')} detail={token.venue === 'DEX' ? t('tvlDescription') : t('tvlChartHint')} />
                </div>
                <section className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-slate-200">{t('spreadTitle')}</h4>
                    <span className="font-mono text-[8px] text-slate-600">{spread.cexPriceUsd ? `${spread.cexSource} ${usd(spread.cexPriceUsd)}` : '—'}</span>
                  </div>
                  <p className="mt-1 text-[9px] leading-relaxed text-slate-500">{t('spreadMethod')}</p>
                  {spreadState === 'loading' && <p className="py-4 text-center font-mono text-[9px] text-slate-500">{t('loading')}</p>}
                  {spreadState !== 'loading' && spread.rows.length > 0 ? (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[430px] border-collapse text-left font-mono text-[8px]">
                        <thead><tr className="border-b border-slate-800 text-slate-600"><th className="pb-2 pr-2 font-medium">{t('spreadChain')}</th><th className="pb-2 pr-2 font-medium">{t('spreadDex')}</th><th className="pb-2 pr-2 text-right font-medium">{t('spreadPrice')}</th><th className="pb-2 pr-2 text-right font-medium">{t('spreadDelta')}</th><th className="pb-2 text-right font-medium">{t('spreadLiquidity')}</th></tr></thead>
                        <tbody>{spread.rows.map((row) => (
                          <tr key={`${row.chain}:${row.pairAddress}`} className="border-b border-slate-900/80 text-slate-300 last:border-0">
                            <td className="py-2 pr-2">{row.chain}</td>
                            <td className="py-2 pr-2">
                              {row.url ? <a href={row.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-200 hover:underline">{row.dex}<ExternalLink className="size-2.5" aria-hidden /></a> : row.dex}
                            </td>
                            <td className="py-2 pr-2 text-right tabular-nums">{usd(row.priceUsd)}</td>
                            <td className={cn('py-2 pr-2 text-right tabular-nums', row.spreadPct >= 0 ? 'text-emerald-200' : 'text-rose-200')}>{pct(row.spreadPct, 2)}</td>
                            <td className="py-2 text-right tabular-nums">{compactUsd(row.liquidityUsd)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  ) : spreadState === 'error' ? <p className="py-3 text-center font-mono text-[9px] text-slate-600">{token.contract ? t('spreadUnavailable') : t('spreadNeedsContract')}</p> : null}
                </section>
                {token.venue === 'DEX' && (
                  <section className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                    <div className="flex items-center gap-2">
                      <Activity className="size-3.5 text-cyan-200" aria-hidden />
                      <h4 className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-slate-200">{t('tvlTitle')}</h4>
                      {tvl?.status === 'ok' && <span className="ml-auto font-mono text-[8px] text-cyan-100">{tvl.protocolName}</span>}
                    </div>
                    {tvlState === 'loading' ? (
                      <p className="mt-3 text-[9px] text-slate-500">{t('loading')}</p>
                    ) : tvl?.status === 'ok' ? (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <Metric label={t('tvlLatest')} value={compactUsd(tvl.points.at(-1)?.value ?? null)} />
                        <Metric label={t('tvl90dAgo')} value={compactUsd(tvl.points[0]?.value ?? null)} />
                        <Metric label={t('tvlPoints')} value={String(tvl.points.length)} />
                      </div>
                    ) : <p className="mt-2 text-[9px] leading-relaxed text-slate-500">{tvlState === 'error' ? t('dataUnavailable') : tvl?.status === 'ambiguous' ? t('tvlAmbiguous') : t('tvlUnmatched')}</p>}
                    <p className="mt-2 text-[9px] text-slate-600">{t('tvlChartHint')}</p>
                  </section>
                )}
                <section className="rounded-lg border border-amber-200/15 bg-amber-200/[0.035] p-3">
                  <div className="flex items-center gap-2">
                    <LockKeyhole className="size-3.5 text-amber-100/70" aria-hidden />
                    <h4 className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-amber-100/80">{t('unlockTitle')}</h4>
                  </div>
                  {highDilutionRisk && (
                    <div role="status" aria-live="polite" data-testid="high-dilution-risk" className="mt-2 flex items-center gap-2 rounded border border-amber-300/45 bg-amber-300/10 px-2 py-1.5 font-mono text-[9px] font-bold uppercase tracking-wide text-amber-200">
                      <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
                      <span>{t('highDilutionRisk')}</span>
                    </div>
                  )}
                  {marketCapToFdvPct != null && tokenomicsPair ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Metric label={t('unlockRatioLabel')} value={`${marketCapToFdvPct.toFixed(1)}%`} />
                      <Metric label={t('unlockRatioSource')} value={tokenomicsPair.dex} />
                    </div>
                  ) : (
                    <p className="mt-2 text-[9px] leading-relaxed text-slate-500">{t('unlockRatioUnavailable')}</p>
                  )}
                  <p className="mt-2 text-[9px] leading-relaxed text-amber-50/50">{t('unlockUnavailable')}</p>
                </section>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function ProFeature({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
      <div className="flex items-center gap-2"><ArrowUpRight className="size-3.5 text-violet-200" aria-hidden /><h4 className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-slate-200">{title}</h4></div>
      <p className="mt-2 text-[9px] leading-relaxed text-slate-500">{detail}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/70 p-2">
      <p className="font-mono text-[7px] uppercase tracking-[0.1em] text-slate-600">{label}</p>
      <p className="mt-1 font-mono text-[10px] tabular-nums text-slate-200">{value}</p>
    </div>
  );
}
