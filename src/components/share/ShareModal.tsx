// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { PartyPopper, Send, Unlock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { SITE_URL } from '@/lib/constants';
import { buildShareLinks, buildShareText, buildShareUrl } from '@/lib/viral';
import { selectActiveToken, selectTimeframe, useAppStore } from '@/store/useAppStore';
import { useExchangeSelection } from '@/store/useExchangeSelection';
import { useMarketStore } from '@/store/useMarketStore';
import { feedId } from '@/websockets/types';
import { useViralStore } from '@/store/useViralStore';
import type { ThemeId } from '@/store/types';

/** X (twitter) glyph – lucide dropped brand icons, so it is inlined. */
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41Z" />
    </svg>
  );
}

const UNLOCK_TARGETS: { id: ThemeId; label: string; swatch: string }[] = [
  { id: 'matrix', label: 'Matrix Green', swatch: 'bg-[#00e63c]' },
  { id: 'miami', label: 'Miami Vice Pink', swatch: 'bg-[#ff2e97]' },
];

/**
 * Viral loop: one modal, two intents, one reward.
 *
 * Clicking X or Telegram opens the prepared composer and sets a local
 * `useViralStore.shareUnlocked` flag for the two share-gated themes. The app
 * does not verify whether the post is published.
 */
export function ShareModal() {
  const t = useTranslations('share');
  const tt = useTranslations('theme');
  const locale = useLocale();
  const open = useViralStore((s) => s.shareOpen);
  const reason = useViralStore((s) => s.shareReason);
  const closeShare = useViralStore((s) => s.closeShare);
  const unlocked = useViralStore((s) => s.shareUnlocked);
  const unlockViaShare = useViralStore((s) => s.unlockViaShare);
  const requestTheme = useViralStore((s) => s.requestTheme);

  const activeToken = useAppStore(selectActiveToken);
  const timeframe = useAppStore(selectTimeframe);
  const selection = useExchangeSelection(activeToken.symbol, timeframe, activeToken.exchange);
  const activeFeedId = selection
    ? feedId({ exchange: selection.exchange, symbol: activeToken.symbol, timeframe })
    : null;
  const feed = useMarketStore((s) => (activeFeedId ? (s.feeds[activeFeedId] ?? null) : null));
  const price = feed?.lastPrice ?? null;

  // SSR-Zweig: SITE_URL ist die kanonische Domain (Sitemap/OG nutzen sie auch)
  // – der frühere Hardcode `nodechart.app` war eine zweite, falsche Wahrheit.
  const url =
    typeof window === 'undefined'
      ? buildShareUrl(SITE_URL, locale, activeToken.symbol, price)
      : buildShareUrl(window.location.origin, locale, activeToken.symbol, price);
  // The share copy is a template consumed by buildShareText; use raw to avoid
  // next-intl requiring `{ticker}` during rendering before the replacement.
  const text = buildShareText(t.raw('tweet') as string, activeToken.symbol);
  const links = buildShareLinks(text, url);

  const fire = (href: string) => {
    // Open a same-origin blank first so we can detect popup blocking, sever the
    // opener relationship, and only then navigate to the prepared composer.
    const popup = window.open('about:blank', '_blank', 'width=680,height=560');
    if (!popup) return;

    try {
      const referrerPolicy = popup.document.createElement('meta');
      referrerPolicy.name = 'referrer';
      referrerPolicy.content = 'no-referrer';
      popup.document.head.appendChild(referrerPolicy);
      popup.opener = null;
      popup.location.href = href;
      unlockViaShare();
    } catch {
      popup.close();
    }
  };

  return (
    <Modal
      open={open}
      onClose={closeShare}
      title={
        <span className="flex items-center gap-2">
          <Unlock className="size-4 text-secondary" aria-hidden />
          {reason === 'theme' ? t('titleTheme') : t('title')}
        </span>
      }
      subtitle={unlocked ? t('already') : t('hint')}
      widthClass="max-w-lg"
    >
      <div className="flex flex-col gap-3">
        {/* Prepared share text and URL; displaying them does not confirm publication. */}
        <blockquote className="nc-clip-sm border border-line bg-surface/60 p-3 font-mono text-[11px] leading-relaxed text-muted">
          {text} <span className="text-accent">{url}</span>
        </blockquote>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => fire(links.x)}
            className={cn(
              'nc-clip-sm inline-flex items-center justify-center gap-2 border border-fg/40 bg-fg/10 px-3 py-2.5',
              'font-mono text-2xs uppercase tracking-cyber text-fg transition-colors hover:bg-fg/20',
            )}
          >
            <XIcon className="size-3.5" />
            {t('x')}
          </button>
          <button
            type="button"
            onClick={() => fire(links.telegram)}
            className={cn(
              'nc-clip-sm inline-flex items-center justify-center gap-2 border border-accent/60 bg-accent/10 px-3 py-2.5',
              'font-mono text-2xs uppercase tracking-cyber text-accent transition-colors hover:bg-accent/20',
            )}
          >
            <Send className="size-3.5" aria-hidden />
            {t('telegram')}
          </button>
        </div>

        {unlocked && (
          <div className="nc-clip-sm border border-bull/50 bg-bull/10 p-3">
            <p className="flex items-center gap-2 font-mono text-2xs uppercase tracking-cyber text-bull">
              <PartyPopper className="size-3.5" aria-hidden />
              {t('unlocked')}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {UNLOCK_TARGETS.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => {
                    requestTheme(target.id);
                    closeShare();
                  }}
                  className={cn(
                    'nc-clip-sm inline-flex items-center gap-2 border border-line bg-surface/60 px-2.5 py-2',
                    'font-mono text-2xs uppercase tracking-cyber text-muted transition-colors hover:border-primary/60 hover:text-fg',
                  )}
                >
                  <span className={cn('size-2.5 rounded-full', target.swatch)} aria-hidden />
                  {tt(target.id)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
