// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AdUnavailable } from '@/components/ads/AdUnavailable';
import { hasAdCreative } from '@/components/ads/hasAdCreative';
import { detectAdBlockOnce } from '@/lib/ads/adblock';
import { whenIdle } from '@/lib/ads/adsterra';
import { NODECLUSTER_BANNERS } from '@/lib/ads/config';
import { cn } from '@/lib/cn';
import { donationGraceActive } from '@/store/useViralStore';

type ClusterAdSlot = 'left' | 'right';
type SlotStatus = 'pending' | 'filled' | 'unavailable' | 'suppressed';
type ScriptResult = 'loaded' | 'failed';

const BANNER_WIDTH = 300;
const BANNER_HEIGHT = 250;

/** atOptions-Loader: invoke.js reads the global config when it runs. */
declare global {
  interface Window {
    atOptions?: Record<string, unknown>;
  }
}

/**
 * Adsterra's legacy display tag reads one global atOptions object. Serialize
 * the two cluster loads so one slot cannot overwrite the other's dimensions
 * or key while its invoke.js is still being fetched.
 */
let bannerLoadQueue: Promise<unknown> = Promise.resolve();

function loadAdsterraBanner(container: HTMLElement, slot: ClusterAdSlot): Promise<ScriptResult> {
  const placement = NODECLUSTER_BANNERS[slot];
  const load = bannerLoadQueue.then(() => new Promise<ScriptResult>((resolve) => {
    if (!container.isConnected) {
      resolve('failed');
      return;
    }

    window.atOptions = {
      key: placement.key,
      format: 'iframe',
      height: BANNER_HEIGHT,
      width: BANNER_WIDTH,
      params: {},
    };

    const optionsScript = document.createElement('script');
    optionsScript.textContent = `atOptions = ${JSON.stringify(window.atOptions)};`;
    const loader = document.createElement('script');
    loader.src = placement.src;
    loader.async = false;
    loader.setAttribute('data-cfasync', 'false');
    loader.dataset.ncClusterAdTry = slot;

    let settled = false;
    const timeout = window.setTimeout(() => finish('failed'), 10_000);
    const finish = (result: ScriptResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      loader.onload = null;
      loader.onerror = null;
      resolve(result);
    };
    loader.onload = () => finish('loaded');
    loader.onerror = () => finish('failed');

    container.appendChild(optionsScript);
    container.appendChild(loader);
  }));

  bannerLoadQueue = load.then(() => undefined, () => undefined);
  return load;
}

/** Reserved 300×250 Adsterra display slot with no-fill/blocker fallback. */
export function MediumRectangleBanner({
  slot,
  className,
}: {
  slot: ClusterAdSlot;
  className?: string;
}) {
  const t = useTranslations('ads');
  const clusterT = useTranslations('nodecluster');
  const holderRef = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef(false);
  const requestStartedRef = useRef(false);
  const [status, setStatus] = useState<SlotStatus>('pending');

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;

    let cancelled = false;
    let noFillTimer = 0;
    const markUnavailable = () => {
      if (cancelled || doneRef.current) return;
      doneRef.current = true;
      window.clearTimeout(noFillTimer);
      setStatus('unavailable');
    };
    const markFilled = () => {
      if (cancelled) return;
      doneRef.current = true;
      window.clearTimeout(noFillTimer);
      setStatus('filled');
    };
    const observer = new MutationObserver(() => {
      if (hasAdCreative(holder)) markFilled();
    });
    observer.observe(holder, { childList: true, subtree: true });

    if (donationGraceActive() || navigator.webdriver) {
      const suppressTimer = window.setTimeout(() => {
        doneRef.current = true;
        setStatus('suppressed');
      }, 0);
      return () => {
        cancelled = true;
        observer.disconnect();
        window.clearTimeout(suppressTimer);
      };
    }

    const pollFilled = (remaining: number) => {
      window.setTimeout(() => {
        if (cancelled || doneRef.current) return;
        if (hasAdCreative(holder)) {
          markFilled();
          return;
        }
        if (remaining > 0) pollFilled(remaining - 1);
        else markUnavailable();
      }, 1_500);
    };

    const inject = async () => {
      const target = holderRef.current;
      if (cancelled || doneRef.current || !target) return;
      const result = await loadAdsterraBanner(target, slot);
      if (cancelled || doneRef.current) return;
      if (result === 'failed') {
        // Detection also feeds the global soft-wall; the slot itself keeps its
        // reserved geometry and reports no-fill instead of collapsing.
        await detectAdBlockOnce().catch(() => false);
        if (!cancelled) markUnavailable();
        return;
      }
      pollFilled(4);
    };

    if (!doneRef.current && !requestStartedRef.current) {
      requestStartedRef.current = true;
      whenIdle(() => {
        if (cancelled || doneRef.current) return;
        noFillTimer = window.setTimeout(markUnavailable, 15_000);
        void inject();
      });
    }

    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearTimeout(noFillTimer);
    };
  }, [slot]);

  const label = clusterT('adLabel');
  return (
    <div
      role="complementary"
      aria-label={label}
      data-aads-slot={`nodecluster-${slot}`}
      data-ad-placement={`nodecluster-${slot}`}
      data-ad-size="300x250"
      data-testid={`nodecluster-ad-${slot}`}
      className={cn(
        'relative flex h-[250px] w-[300px] shrink-0 items-center justify-center overflow-hidden border border-dashed border-slate-700/80 bg-slate-900/55 text-center shadow-[inset_0_0_24px_rgba(15,23,42,0.4)]',
        className,
      )}
    >
      <span aria-hidden className="pointer-events-none absolute right-1 top-1 z-10 rounded border border-slate-700 bg-slate-950/80 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-400">
        {t('sponsored')}
      </span>
      <div
        ref={holderRef}
        data-nodecluster-ad-holder=""
        style={{ width: BANNER_WIDTH, height: BANNER_HEIGHT }}
        className="relative flex h-full w-full items-center justify-center overflow-hidden"
      >
        {(status === 'unavailable' || status === 'suppressed') && (
          <AdUnavailable className="border-0 bg-slate-950/70 text-slate-500" />
        )}
      </div>
    </div>
  );
}
