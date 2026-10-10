// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, LoaderCircle, ShieldAlert, ShieldCheck, Terminal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SearchHit } from '@/api/types';
import { SmartSearch } from '@/components/search/SmartSearch';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { Logo } from '@/components/layout/Logo';
import { ProAccessGuard } from '@/components/terminal/ProAccessGuard';
import { Link, useRouter } from '@/i18n/navigation';
import { classifyQuery } from '@/lib/address';
import { ROUTES } from '@/lib/constants';
import { cn } from '@/lib/cn';
import type { Token } from '@/store/types';
import { selectActiveToken, useAppStore } from '@/store/useAppStore';
import { selectProAccessStatus, selectProUnlocked, useProAccessStore } from '@/store/useProAccessStore';

const NodeClusterView = dynamic(
  () => import('@/components/terminal/NodeClusterModal').then((module) => module.NodeClusterModal),
  {
    loading: () => (
      <div data-testid="nodecluster-loading" role="status" className="flex min-h-0 flex-1 items-center justify-center gap-2 bg-slate-950 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-200/70">
        <LoaderCircle className="size-5 animate-spin text-cyan-300" aria-hidden />
        NodeCluster
      </div>
    ),
  },
);

type LinkStatus = 'idle' | 'loading' | 'error';

function assetKey(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isDexHit(hit: SearchHit): hit is Extract<SearchHit, { kind: 'dex' }> {
  return hit.kind === 'dex';
}

function dexHitMatchesAsset(hit: Extract<SearchHit, { kind: 'dex' }>, asset: string): boolean {
  const wanted = assetKey(asset);
  return assetKey(hit.pair.baseSymbol) === wanted
    || assetKey(hit.pair.baseName) === wanted
    || assetKey(`${hit.pair.baseSymbol}/${hit.pair.quoteSymbol}`) === wanted;
}

/** Standalone NodeCluster surface with a shareable asset/contract URL. */
export function StandaloneClusterPage() {
  const t = useTranslations('nodecluster');
  const activeToken = useAppStore(selectActiveToken);
  const setActiveToken = useAppStore((state) => state.setActiveToken);
  const verification = useProAccessStore(selectProAccessStatus);
  const proVerified = useProAccessStore(selectProUnlocked);
  const router = useRouter();
  const leaveCluster = useCallback(() => router.push(ROUTES.terminal), [router]);
  const [linkStatus, setLinkStatus] = useState<LinkStatus>('idle');
  const [linkError, setLinkError] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const copyTimerRef = useRef<number | null>(null);

  const resolveLocation = useCallback(async (url: URL, signal: AbortSignal) => {
    const contract = (url.searchParams.get('contract') ?? '').trim().slice(0, 128);
    const asset = (url.searchParams.get('asset') ?? '').trim().slice(0, 80);
    const requestedChain = (url.searchParams.get('chain') ?? '').trim().toLowerCase().slice(0, 32);
    setLinkError('');

    if (!contract && !asset) {
      setLinkStatus('idle');
      return;
    }
    if (contract && !['evm', 'solana'].includes(classifyQuery(contract))) {
      setLinkStatus('error');
      setLinkError(t('standalone.assetNotFound'));
      return;
    }
    if (!contract && asset.length < 2) {
      setLinkStatus('error');
      setLinkError(t('standalone.assetNotFound'));
      return;
    }

    setLinkStatus('loading');
    let cexFallback: Token | null = null;

    try {
      if (!contract) {
        const { CEX_UNIVERSE, cexToToken } = await import('@/lib/cex-universe');
        const wanted = assetKey(asset);
        const exactPair = CEX_UNIVERSE.find((entry) => assetKey(`${entry.base}/${entry.quote}`) === wanted);
        const baseMatch = CEX_UNIVERSE.find((entry) => assetKey(entry.base) === wanted && entry.quote === 'USDT')
          ?? CEX_UNIVERSE.find((entry) => assetKey(entry.base) === wanted);
        const fallback = exactPair ?? baseMatch;
        if (fallback) cexFallback = cexToToken(fallback, fallback.exchanges[0] ?? 'binance');
      }

      const query = contract || asset;
      const { smartSearch } = await import('@/api/search');
      const result = await smartSearch(query, signal);
      if (signal.aborted) return;

      const dexHits = result.hits.filter(isDexHit);
      const chainHits = requestedChain
        ? dexHits.filter((hit) => hit.pair.chain.toLowerCase() === requestedChain)
        : dexHits;
      const relevantDex = contract
        ? chainHits.find((hit) => hit.pair.baseAddress.toLowerCase() === contract.toLowerCase())
        : chainHits.find((hit) => dexHitMatchesAsset(hit, asset));
      const selectedHit = relevantDex ?? (!cexFallback ? chainHits[0] : undefined);

      if (selectedHit) {
        const { searchHitToToken } = await import('@/lib/search-hit-to-token');
        const token = searchHitToToken(selectedHit);
        if (token) {
          setActiveToken(token);
          setLinkStatus('idle');
          return;
        }
      }

      if (cexFallback) {
        setActiveToken(cexFallback);
        setLinkStatus('idle');
        return;
      }

      setLinkStatus('error');
      setLinkError(t('standalone.assetNotFound'));
    } catch {
      if (signal.aborted) return;
      if (cexFallback) {
        setActiveToken(cexFallback);
        setLinkStatus('idle');
      } else {
        setLinkStatus('error');
        setLinkError(t('standalone.assetNotFound'));
      }
    }
  }, [setActiveToken, t]);

  useEffect(() => {
    let controller = new AbortController();
    const resolveCurrentUrl = () => {
      controller.abort();
      controller = new AbortController();
      void resolveLocation(new URL(window.location.href), controller.signal);
    };

    resolveCurrentUrl();
    window.addEventListener('popstate', resolveCurrentUrl);
    return () => {
      controller.abort();
      window.removeEventListener('popstate', resolveCurrentUrl);
    };
  }, [resolveLocation]);

  useEffect(() => () => {
    if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const updateShareUrl = useCallback((token: Token) => {
    const url = new URL(window.location.href);
    url.searchParams.delete('asset');
    url.searchParams.delete('contract');
    url.searchParams.delete('chain');
    if (token.venue === 'DEX' && token.contract) {
      url.searchParams.set('contract', token.contract);
      if (token.chain) url.searchParams.set('chain', token.chain);
    } else {
      url.searchParams.set('asset', token.base || token.symbol.split('/')[0] || token.symbol);
    }
    window.history.pushState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const handleTokenSelected = useCallback((token: Token) => {
    setActiveToken(token);
    setLinkStatus('idle');
    setLinkError('');
    updateShareUrl(token);
  }, [setActiveToken, updateShareUrl]);

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
    if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyState('idle'), 2200);
  };

  const proLabel = proVerified
    ? t('standalone.pro.verified')
    : verification === 'checking'
      ? t('standalone.pro.checking')
      : verification === 'unavailable'
        ? t('standalone.pro.unavailable')
        : t('standalone.pro.locked');
  const ProIcon = proVerified ? ShieldCheck : ShieldAlert;

  return (
    <div
      data-testid="standalone-cluster-page"
      className="flex h-[100dvh] min-h-[32rem] flex-col overflow-hidden bg-slate-950 pb-[max(var(--nc-socialbar-h,0px),env(safe-area-inset-bottom))] text-slate-100"
    >
      <h1 className="sr-only">{t('standalone.pageTitle')}</h1>
      {/* z-40: page-local header, below modal/drawer/palette/toast layers. */}
      <header className="relative z-40 flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-700/70 bg-slate-950/95 px-3 py-2 shadow-[0_8px_24px_-20px_rgba(34,211,238,0.65)] backdrop-blur-xl sm:gap-3 sm:px-5">
        <Link href={ROUTES.home} aria-label="NodeChart" className="shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
          <Logo decorative className="[&_img:first-child]:size-7 [&_img:last-child]:w-28 sm:[&_img:first-child]:size-8 sm:[&_img:last-child]:w-32" />
        </Link>

        <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:min-w-48 sm:max-w-sm sm:flex-1">
          <SmartSearch className="w-full" onTokenSelected={handleTokenSelected} />
        </div>

        <Link
          href={ROUTES.terminal}
          aria-label={t('standalone.launchTerminal')}
          className="ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded border border-cyan-300/50 bg-cyan-300/10 px-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-cyan-100 transition-colors hover:bg-cyan-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:ml-0 sm:px-3 sm:text-[10px]"
        >
          <Terminal className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">{t('standalone.launchTerminal')}</span>
        </Link>

        <LocaleSwitcher preserveQuery />

        <div
          role="status"
          aria-label={t('standalone.pro.label')}
          title={`${t('standalone.pro.label')}: ${proLabel}`}
          data-testid="cluster-pro-status"
          data-status={proVerified ? 'verified' : verification}
          className={cn(
            'inline-flex h-9 max-w-36 shrink-0 items-center gap-1.5 rounded border px-2 font-mono text-[8px] font-semibold uppercase tracking-[0.08em] sm:max-w-none sm:px-2.5 sm:text-[9px]',
            proVerified
              ? 'border-emerald-300/40 bg-emerald-300/10 text-emerald-200'
              : verification === 'checking'
                ? 'border-amber-300/40 bg-amber-300/10 text-amber-100'
                : 'border-slate-600/70 bg-slate-800/50 text-slate-400',
          )}
        >
          {verification === 'checking'
            ? <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden />
            : <ProIcon className="size-3.5 shrink-0" aria-hidden />}
          <span className="truncate">{proLabel}</span>
        </div>

        <button
          type="button"
          onClick={() => void copyShareLink()}
          aria-label={copyState === 'copied' ? t('standalone.linkCopied') : copyState === 'error' ? t('standalone.copyLinkError') : t('standalone.copyLink')}
          title={copyState === 'copied' ? t('standalone.linkCopied') : copyState === 'error' ? t('standalone.copyLinkError') : t('standalone.copyLink')}
          data-testid="cluster-copy-link"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded border border-slate-700 bg-slate-900/70 text-slate-300 transition-colors hover:border-cyan-300/50 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          {copyState === 'copied' ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        </button>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {linkStatus === 'loading' && (
          <div role="status" className="absolute left-1/2 top-2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded border border-cyan-300/25 bg-slate-950/90 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-cyan-100 shadow-lg">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            {t('standalone.assetLoading')}
          </div>
        )}
        {linkStatus === 'error' && linkError && (
          <div role="alert" className="absolute left-1/2 top-2 z-40 w-[min(36rem,calc(100%-1.5rem))] -translate-x-1/2 rounded border border-amber-300/35 bg-slate-950/95 px-3 py-2 font-mono text-[9px] leading-relaxed text-amber-100 shadow-lg">
            {linkError}
          </div>
        )}
        <NodeClusterView token={activeToken} open onClose={leaveCluster} mode="inline" showAds />
      </main>

      <ProAccessGuard />
    </div>
  );
}
