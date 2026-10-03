// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect } from 'react';
import { Bitcoin, ShieldAlert, ShieldCheck, ShieldQuestion, Waves } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { selectActiveToken, useAppStore } from '@/store/useAppStore';
import { selectLargeBinanceCount, selectWhaleEnabled, useWhaleStore } from '@/store/useWhaleStore';
import { useOnChainStore } from '@/store/useOnChainStore';
import { cn } from '@/lib/cn';
import { GOPLUS_CHAIN_ID } from '@/lib/chains';

interface OnChainHeaderBadgesProps {
  onOpen: () => void;
}

type Tone = 'ok' | 'risk' | 'warn' | 'idle' | 'secondary';

const LED_TONE: Record<Tone, string> = {
  ok: 'bg-bull shadow-[0_0_8px_hsl(var(--nc-bull)/0.8)]',
  risk: 'bg-bear shadow-[0_0_8px_hsl(var(--nc-bear)/0.85)]',
  warn: 'bg-warning shadow-[0_0_8px_hsl(var(--nc-warning)/0.8)]',
  idle: 'bg-muted',
  secondary: 'bg-secondary shadow-[0_0_8px_hsl(var(--nc-secondary)/0.75)]',
};

function MetricBadge({
  icon: Icon,
  label,
  value,
  title,
  tone,
  onClick,
  testId,
}: {
  icon: typeof Bitcoin;
  label: string;
  value: string;
  title: string;
  tone: Tone;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={`${label}: ${value}. ${title}`}
      data-testid={testId}
      className={cn(
        'nc-chip inline-flex h-7 shrink-0 items-center gap-1.5 px-2 font-mono text-[9px] uppercase tracking-[0.09em] transition-colors hover:border-primary/50 hover:text-fg',
        tone === 'ok' && 'border-bull/45 text-bull',
        tone === 'risk' && 'border-bear/55 text-bear',
        tone === 'warn' && 'border-warning/50 text-warning',
        tone === 'idle' && 'text-faint',
        tone === 'secondary' && 'border-secondary/45 text-secondary',
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="text-faint">{label}</span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <span className={cn('size-1.5 rounded-full', LED_TONE[tone])} aria-hidden />
        {value}
      </span>
    </button>
  );
}

/** Compact header signals; refreshes only BTC fees and the active DEX token's GoPlus data. */
export function OnChainHeaderBadges({ onOpen }: OnChainHeaderBadgesProps) {
  const t = useTranslations('onchain.header');
  const locale = useLocale();
  const activeToken = useAppStore(selectActiveToken);
  const btc = useOnChainStore((state) => state.btc);
  const status = useOnChainStore((state) => state.status);
  const forensics = useOnChainStore((state) => state.forensics);
  const forensicsKey = useOnChainStore((state) => state.forensicsKey);
  const refresh = useOnChainStore((state) => state.refresh);
  const largeBinanceCount = useWhaleStore(selectLargeBinanceCount);
  const whaleEnabled = useWhaleStore(selectWhaleEnabled);

  const chain = activeToken.venue === 'DEX' ? activeToken.chain : undefined;
  const contract = activeToken.venue === 'DEX' ? activeToken.contract : undefined;
  const goPlusSupported = Boolean(chain && GOPLUS_CHAIN_ID[chain as keyof typeof GOPLUS_CHAIN_ID]);
  const tokenKey = chain && contract && goPlusSupported ? `${chain}:${contract}` : null;

  useEffect(() => {
    const refreshHeaderSignals = () => {
      void refresh('btc');
      if (chain && contract && goPlusSupported) void refresh('forensics', { token: { chain, contract } });
    };

    refreshHeaderSignals();
    const timer = window.setInterval(refreshHeaderSignals, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh, chain, contract, goPlusSupported]);

  const feeValue = btc
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(btc.fastestFee)} sat/vB`
    : status.btc === 'error'
      ? t('securityOffline')
      : '…';
  const btcTone: Tone = status.btc === 'error' ? 'warn' : status.btc === 'ok' ? 'ok' : 'idle';

  const securityMatchesToken = tokenKey !== null && forensicsKey === tokenKey && forensics !== null;
  const hasSecurityRisk = Boolean(
    securityMatchesToken && forensics && (forensics.isMintable || forensics.isHoneypot),
  );
  const securityUnavailable = tokenKey !== null && status.forensics === 'error';
  const securityLabel = !tokenKey
    ? t('securityNA')
    : hasSecurityRisk
      ? t('securityRisk')
      : securityUnavailable
        ? t('securityOffline')
        : securityMatchesToken
          ? t('securityClear')
          : t('securityChecking');
  const securityTone: Tone = !tokenKey
    ? 'idle'
    : hasSecurityRisk
      ? 'risk'
      : securityUnavailable
        ? 'warn'
        : securityMatchesToken
          ? 'ok'
          : 'warn';
  const SecurityIcon = hasSecurityRisk
    ? ShieldAlert
    : securityTone === 'ok'
      ? ShieldCheck
      : ShieldQuestion;

  const whaleValue = !whaleEnabled
    ? t('whalesOff')
    : t('whalesValue', { count: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(largeBinanceCount) });
  const whaleTone: Tone = whaleEnabled ? 'secondary' : 'idle';

  return (
    <div role="group" aria-label={t('group')} data-testid="onchain-header-badges" className="hidden shrink-0 items-center gap-1 md:flex">
      <MetricBadge
        icon={Bitcoin}
        label={t('btcFees')}
        value={feeValue}
        title={t('btcTitle')}
        tone={btcTone}
        onClick={onOpen}
        testId="btc-fee-badge"
      />
      <MetricBadge
        icon={Waves}
        label={t('whales')}
        value={whaleValue}
        title={t('whalesTitle')}
        tone={whaleTone}
        onClick={onOpen}
        testId="binance-whale-badge"
      />
      <MetricBadge
        icon={SecurityIcon}
        label={t('security')}
        value={securityLabel}
        title={t('securityTitle')}
        tone={securityTone}
        onClick={onOpen}
        testId="goplus-security-badge"
      />
    </div>
  );
}
