// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { StarOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { fetchScreenerRows, type ScreenerRow } from '@/api/prometrics';
import { cn } from '@/lib/cn';
import { TOKEN_INDEX } from '@/lib/constants';
import { pct, usd } from '@/lib/format';
import { selectActiveToken, selectWatchlist, useAppStore } from '@/store/useAppStore';

/**
 * Watchlist view backed by the screener's cached provider rows. Displayed
 * quotes inherit that feed's coverage, freshness and availability limits.
 */

export function WatchlistPopover({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('tools');
  const watchlist = useAppStore(selectWatchlist);
  const activeToken = useAppStore(selectActiveToken);
  const setActiveToken = useAppStore((s) => s.setActiveToken);
  const toggleWatchlist = useAppStore((s) => s.toggleWatchlist);
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => {
      fetchScreenerRows().then((data) => {
        if (alive && data.length > 0) setRows(data);
      });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [open]);

  /*
   * M5-Fix: Der Popover ließ sich nur über den Chip selbst wieder schließen –
   * kein Escape, kein Klick daneben. Beides gehört zu einem Overlay, das die
   * Toolbar überlagert (der Chip trägt `data-watch-trigger` und ist
   * ausgenommen, damit sein eigener Klick nicht doppelt schaltet).
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (panelRef.current?.contains(target ?? null)) return;
      if (target?.closest('[data-watch-trigger]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open, onClose]);

  const quoteByBase = useMemo(() => {
    const map = new Map<string, ScreenerRow>();
    for (const row of rows) map.set(row.base, row);
    return map;
  }, [rows]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('watch.title')}
      className="nc-clip absolute right-0 top-full z-40 mt-2 w-72 border border-secondary/40 bg-bg/97 shadow-volt backdrop-blur-xl"
    >
      <header className="flex items-center justify-between border-b border-line/70 px-2.5 py-1.5">
        <span className="font-mono text-2xs uppercase tracking-cyber text-secondary">{t('watch.title')}</span>
        <span className="font-mono text-2xs tabular-nums text-faint">{watchlist.length}</span>
      </header>
      <ul className="max-h-80 overflow-y-auto">
        {watchlist.length === 0 && <li className="px-2.5 py-3 text-center font-mono text-2xs text-faint">{t('watch.empty')}</li>}
        {watchlist.map((tokenId) => {
          const token = TOKEN_INDEX[tokenId];
          if (!token) return null;
          const quote = quoteByBase.get(token.base);
          return (
            <li key={tokenId}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  setActiveToken(token);
                  onClose();
                }}
                onKeyDown={(event) => {
                  /* M5-Fix: role="button" braucht Enter UND Space (WCAG 4.1.2). */
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActiveToken(token);
                    onClose();
                  }
                }}
                className={cn(
                  'flex cursor-pointer items-center gap-2 border-b border-line/40 px-2.5 py-1.5 transition-colors hover:bg-secondary/8',
                  token.id === activeToken.id && 'bg-secondary/10',
                )}
              >
                <span className="w-20 truncate font-mono text-2xs font-bold text-fg">{token.symbol}</span>
                <span className="ml-auto font-mono text-2xs tabular-nums text-muted">{quote ? usd(quote.last) : '—'}</span>
                <span className={cn('w-14 text-right font-mono text-2xs tabular-nums', (quote?.changePct ?? 0) >= 0 ? 'text-bull' : 'text-bear')}>
                  {quote ? pct(quote.changePct, 2) : '—'}
                </span>
                <button
                  type="button"
                  aria-label={t('watch.remove')}
                  title={t('watch.remove')}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleWatchlist(tokenId);
                  }}
                  className="text-faint transition-colors hover:text-bear"
                >
                  <StarOff className="size-3" aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="px-2.5 py-1.5 font-mono text-2xs text-faint">{t('watch.hint')}</p>
    </div>
  );
}
