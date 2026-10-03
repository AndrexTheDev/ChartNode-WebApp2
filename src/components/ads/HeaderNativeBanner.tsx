// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { detectAdBlockOnce } from '@/lib/ads/adblock';
import { NATIVE_BANNER_CONTAINER_ID, NATIVE_BANNER_SRC } from '@/lib/ads/config';
import { cn } from '@/lib/cn';
import { donationGraceActive } from '@/store/useViralStore';
import { AdUnavailable } from '@/components/ads/AdUnavailable';
import { hasAdCreative } from '@/components/ads/hasAdCreative';

/** Initial + Netz-Retry + Retry nach Wall-Close – identische Doktrin wie Social Bar. */
const MAX_TRIES = 3;
/** Ein Native Banner pro Page-Load (Adsterra: ein Container pro Placement). */
let injectedOnce = false;

/**
 * Native Banner (Adsterra, Widget-Layout 4:1) in der Header-Zone – direkt
 * unter der Sticky-Nav, über dem Seiteninhalt, auf allen Seiten AUSSER dem
 * Terminal: dort sitzt bereits der Sponsored-Strip in der Header-Zone
 * („nur wenn dort noch keine Werbung ist").
 *
 *  · SSR rendert die reservierte responsive Box ⇒ kein CLS, wenn das Kreativ füllt.
 *  · Bei No-Fill bleibt die Reserve stehen und zeigt einen lokalisierten,
 *    transparenten Hinweis. Donation-Grace, QA und erkannte Blocker kollabieren.
 *  · Anti-Blocker-Kette (transparent): onerror ⇒ detectAdBlockOnce() ⇒
 *    echter Blocker → Soft-Wall, Netz-Flake → stiller Retry; nach Wall-Close
 *    (Event `nc-adwall-closed`) ein letzter Versuch. `data-cfasync="false"`.
 *  · `navigator.webdriver` & Donation-Grace ⇒ keine Injection.
 */
export function HeaderNativeBanner() {
  const t = useTranslations('ads');
  const pathname = usePathname();
  /** Terminal-Header trägt schon Werbung (Sponsored-Strip) ⇒ kein Banner. */
  const isTerminal = pathname.includes('/terminal');
  const [collapsed, setCollapsed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const tries = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    if (isTerminal) return;
    // Spender & QA: keine Injection, reservierte Box sofort kollabieren.
    if (donationGraceActive() || navigator.webdriver) {
      setCollapsed(true);
      return;
    }
    if (injectedOnce) return;
    // „nur wenn dort noch keine Werbung ist": Container-Dedupe + Fremdbanner
    if (document.getElementById(NATIVE_BANNER_CONTAINER_ID)?.childElementCount) return;
    const host = () => document.getElementById(NATIVE_BANNER_CONTAINER_ID);
    const target = host();
    if (!target) return;
    const observer = new MutationObserver(() => {
      if (hasAdCreative(target)) {
        done.current = true;
        setUnavailable(false);
      }
    });
    observer.observe(target, { childList: true, subtree: true });

    const pollFilled = (left: number) => {
      window.setTimeout(() => {
        const el = host();
        if (!el) return;
        if (hasAdCreative(el)) {
          done.current = true; // Kreativ da ⇒ Box bleibt reserviert = kein CLS
          setUnavailable(false);
          return;
        }
        if (left > 0) pollFilled(left - 1);
        else {
          done.current = true;
          setUnavailable(true); // No-fill ⇒ Reserve bleibt mit transparentem Hinweis
        }
      }, 1500);
    };

    const inject = function injectFn(src: string): void {
      if (done.current || tries.current >= MAX_TRIES) return;
      tries.current += 1;
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.setAttribute('data-cfasync', 'false');
      script.dataset.ncNativeTry = String(tries.current);
      script.onload = () => pollFilled(4); // ≈ 1,5/3/4,5/6/7,5 s
      script.onerror = () => {
        script.remove();
        void detectAdBlockOnce().then((blocked) => {
          if (blocked) {
            done.current = true;
            setCollapsed(true);
            // Soft-Wall öffnet AdManager-seitig (gleiche Erkennung, 1×/Session)
          } else if (tries.current < MAX_TRIES) {
            injectFn(src); // Netz-Flake → stiller Retry
          } else {
            done.current = true;
            setUnavailable(true);
          }
        });
      };
      document.body.appendChild(script);
    };

    const onWallClosed = () => {
      if (!done.current && tries.current < MAX_TRIES) inject(NATIVE_BANNER_SRC);
    };
    window.addEventListener('nc-adwall-closed', onWallClosed);
    const timer = setTimeout(() => {
      // Commit the page-level guard only when the scheduled work runs. React
      // StrictMode tears effects down and replays them in development; setting
      // it before scheduling would cancel the first timer and block the replay.
      if (injectedOnce) return;
      injectedOnce = true;
      inject(NATIVE_BANNER_SRC);
    }, 0);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('nc-adwall-closed', onWallClosed);
    };
  }, [isTerminal]);

  if (isTerminal) return null;

  return (
    <div
      className={cn('nc-header-ad container', collapsed && 'nc-collapsed')}
      aria-label={t('sponsored')}
    >
      {/* Responsive Reserve (CSS): bei No-fill bleibt die Fläche transparent markiert. */}
      <div id={NATIVE_BANNER_CONTAINER_ID} data-native-banner="">
        {unavailable && <AdUnavailable />}
      </div>
    </div>
  );
}
