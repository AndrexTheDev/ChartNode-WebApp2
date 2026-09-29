// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { detectAdBlockOnce } from '@/lib/ads/adblock';
import { mountNativeBanner, whenIdle } from '@/lib/ads/adsterra';
import {
  AD_BREAKPOINT,
  ADS_ENABLED,
  isDesktopViewport,
  NATIVE_DESKTOP_CONTAINER_ID,
  NATIVE_MOBILE_CONTAINER_ID,
  NATIVE_SLOTS_SHARE_PLACEMENT,
  nativePlacement,
  socialBarPlacement,
  type AdVariant,
} from '@/lib/ads/config';
import { donationGraceActive, useViralStore, WALL_COOLDOWN_MS } from '@/store/useViralStore';
import dynamic from 'next/dynamic';
import { LazyGate } from '@/components/ui/LazyGate';

/*
 * M7: Die beiden Dialoge der Monetarisierungsschicht (Spenden-Wall, Teilen)
 * werden erst beim Öffnen geladen. Sie hingen vorher statisch im Root-Layout
 * und damit im Erstkontakt-Bundle JEDER Seite – auch der Landingpage, die
 * beide nie zeigt.
 */
const SupportModal = dynamic(() => import('./SupportModal').then((m) => m.SupportModal), { ssr: false });
const ShareModal = dynamic(() => import('../share/ShareModal').then((m) => m.ShareModal), { ssr: false });

/** Social Bar: max. Versuche (Initial + Netz-Retry + Retry nach Wall-Close). */
const SOCIAL_MAX_TRIES = 3;

/**
 * Läuft der 7-Tage-Cooldown der Soft-Wall?
 *
 * M6-Fix: Der Social-Bar-Retry nach dem Wall-Close („Blocker ggf. gerade
 * deaktiviert") lief auch dann, wenn der Nutzer die Wall mit Escape/X
 * geschlossen hatte – der fehlgeschlagene Retry setzte `wallOpen` sofort
 * wieder auf true. Ergebnis: ein Dialog, der sich nicht schließen ließ.
 * Jetzt gewinnt der Cooldown: wer einmal abgelehnt hat, wird in dieser
 * Session nicht erneut gefragt.
 */
function wallInCooldown(): boolean {
  const { wallDismissedAt } = useViralStore.getState();
  return wallDismissedAt !== null && Date.now() - wallDismissedAt < WALL_COOLDOWN_MS;
}

/**
 * Misst nach dem Load die selbst verankerte Social Bar (fixed, bodennah) und
 * legt ihre Höhe als `--nc-socialbar-h` ab. Konsumenten: der Terminal-Shell
 * (reserviert die Höhe unten – Mobile UND Desktop, sonst liegt die Bar über
 * Toolbar bzw. Chart-Zeitachse) und der Whale-Ticker (setzt sich darüber).
 * Best-Effort mit Retries: Adsterra rendert die Bar teils verzögert nach dem
 * Script-Load; findet sich nichts Fixiertes, bleibt die Variable bei 0.
 */
function findSocialBar(): { height: number; el: HTMLElement | null } {
  const isOurs = (el: Element) =>
    (el.id !== '' && el.id.startsWith('nc-')) ||
    (typeof el.className === 'string' && el.className.includes('nc-'));
  let height = 0;
  let found: HTMLElement | null = null;
  const consider = (el: Element, depth: number) => {
    if (height > 0 || depth > 2 || isOurs(el)) return;
    const cs = window.getComputedStyle(el as HTMLElement);
    if (cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden') {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const bottomAnchored = Math.abs(window.innerHeight - rect.bottom) < 48;
      if (bottomAnchored && rect.height >= 20 && rect.height <= 220) {
        height = Math.max(height, rect.height);
        found = el as HTMLElement;
        return;
      }
    }
    for (const child of Array.from(el.children)) consider(child, depth + 1);
  };
  for (const child of Array.from(document.body.children)) consider(child, 0);
  return { height, el: found };
}

function measureSocialBar(): void {
  const attempt = (left: number) => {
    window.setTimeout(() => {
      let h = 0;
      let el: HTMLElement | null = null;
      try {
        const found = findSocialBar();
        h = found.height;
        el = found.el;
      } catch {
        /* Messung ist Best-Effort */
      }
      if (h > 0) {
        document.documentElement.style.setProperty('--nc-socialbar-h', `${Math.ceil(h)}px`);
        // Marker für CSS-Regeln (z. B. Pause unter offenen Modals)
        if (el) el.dataset.ncSocialbar = '1';
        return;
      }
      if (left > 0) attempt(left - 1);
    }, 900);
  };
  attempt(4); // ≈ 0,9 / 1,8 / 2,7 / 3,6 / 4,5 s nach Load
}

/**
 * Global monetization layer – mounted once in the root layout.
 *
 *  · Social Bar (Adsterra, echtes Delivery-Skript aus config.ts) läuft NUR auf
 *    den App-Seiten (…/terminal) und verankert sich selbst am Viewport-Boden.
 *    Injection zur Laufzeit per `body.appendChild` = „right above the closing
 *    </body> tag", lazy (Timer) und mit `data-cfasync="false"` gegen Cloudflare
 *    Rocket Loader. Anti-Blocker-Strategie (transparent, keine Maskierung):
 *      – onerror ⇒ detectAdBlockOnce(): echter Blocker ⇒ Cyberpunk-Soft-Wall
 *        (bittet um Deaktivierung/Spende), Netz-Flake ⇒ 1 stiller Retry;
 *      – Wall-Close ⇒ ein weiterer Retry (Blocker ggf. gerade deaktiviert);
 *      – Donation-Grace & navigator.webdriver ⇒ gar keine Injection.
 *  · Ad-block detection runs once per session; a blocked visitor sees the
 *    cyberpunk soft-wall (unless supporter or inside the 7-day cooldown).
 *    `?adwall=1` forces it open – used by the browser proof and for demos.
 *  · Hosts <SupportModal/> + <ShareModal/> so both work on every route.
 *
 * Renders no markup of its own besides the modals → zero hydration risk and
 * zero layout shift when ads are disabled.
 */
function AdManagerInner() {
  const [wallOpen, setWallOpen] = useState(false);
  const pathname = usePathname();
  /** „APP page" im Monetization-Sinn: das Charting-Terminal. */
  const isAppPage = pathname.includes('/terminal');

  const socialSrcRef = useRef<string | null>(null);
  const socialTries = useRef(0);
  const socialDone = useRef(false);
  const socialBlocked = useRef(false);

  const injectSocial = useCallback(
    // Benannte Function-Expression: legale Selbstreferenz für die Retries
    // (react-hooks verbietet den Zugriff auf das eigene const vor Deklaration).
    function inject(src: string): void {
      if (socialDone.current || socialTries.current >= SOCIAL_MAX_TRIES) return;
      socialTries.current += 1;
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.setAttribute('data-cfasync', 'false');
      script.dataset.ncSocialTry = String(socialTries.current);
      script.onload = () => {
        socialDone.current = true;
        measureSocialBar();
      };
      script.onerror = () => {
        script.remove();
        void detectAdBlockOnce().then((blocked) => {
          if (blocked) {
            // Transparente Gegenmaßnahme: Soft-Wall statt stiller Verlust.
            // Nach einem Wall-Close (Cooldown) wird nicht erneut geöffnet.
            socialBlocked.current = true;
            socialDone.current = true;
            if (!wallInCooldown()) setWallOpen(true);
          } else if (socialTries.current < SOCIAL_MAX_TRIES) {
            inject(src); // Netz-Flake, kein Blocker → stiller Retry
          } else {
            socialDone.current = true;
          }
        });
      };
      document.body.appendChild(script); // Laufzeit-Äquivalent zu „vor </body>"
    },
    [],
  );

  useEffect(() => {
    if (!isAppPage || !ADS_ENABLED) return;
    if (donationGraceActive()) return; // Spende schlägt alles – auch die Bar
    if (navigator.webdriver) return; // QA/CI (Puppeteer) bleibt werbefrei
    const src = socialBarPlacement(isDesktopViewport() ? 'desktop' : 'mobile');
    if (!src) return;
    socialSrcRef.current = src;
    // Deferred: nie synchrone Arbeit/setState im Effect; die Bar darf nie mit
    // Chart-Seeding oder First Paint um die Main Thread kämpfen.
    const timer = setTimeout(() => injectSocial(src), 0);
    return () => clearTimeout(timer);
  }, [isAppPage, injectSocial]);

  const closeWall = useCallback(() => {
    setWallOpen(false);
    // M6-Fix: Auch Escape/X sind eine Ablehnung – vorher setzte nur der
    // Dismiss-Button den 7-Tage-Cooldown, die Wall kam also bei jeder
    // Navigation wieder (und mit ihr der Retry-Sturm).
    useViralStore.getState().dismissWall();
    // Andere Ad-Flächen (Native Banner) hören auf dieses Event für ihren
    // letzten Retry – Blocker ggf. gerade deaktiviert.
    window.dispatchEvent(new CustomEvent('nc-adwall-closed'));
    // Wall eben geschlossen ⇒ Blocker ggf. gerade deaktiviert: letzter Versuch.
    if (socialBlocked.current && socialSrcRef.current && socialTries.current < SOCIAL_MAX_TRIES) {
      socialBlocked.current = false;
      socialDone.current = false;
      injectSocial(socialSrcRef.current);
    }
  }, [injectSocial]);

  useEffect(() => {
    let cancelled = false;

    // Donation-Grace schlägt alles – auch den ?adwall=1-Testweg: Wer
    // gespendet hat (48 h, über $5 → 5 Tage), bekommt keinen Aufruf zu
    // sehen. Punkt. (QA nutzt genau das als deterministischen Beweis.)
    if (donationGraceActive()) return;

    const force = new URLSearchParams(window.location.search).get('adwall') === '1';
    if (force) {
      // Deferred so the effect never setState synchronously (lint rule).
      const forceTimer = setTimeout(() => setWallOpen(true), 0);
      return () => {
        cancelled = true;
        clearTimeout(forceTimer);
      };
    }

    if (wallInCooldown()) return;

    const timer = setTimeout(() => {
      void detectAdBlockOnce().then((blocked) => {
        if (!cancelled && blocked) setWallOpen(true);
      });
    }, 1500); // never interrupt first paint

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const shareOpen = useViralStore((s) => s.shareOpen);

  return (
    <>
      <LazyGate active={wallOpen}>
        <SupportModal open={wallOpen} onClose={closeWall} />
      </LazyGate>
      <LazyGate active={shareOpen}>
        <ShareModal />
      </LazyGate>
    </>
  );
}

export function AdManager() {
  return <AdManagerInner />;
}

/** Tiny corner tag so an unfilled (blocked) slot never looks broken. */
function SlotTag({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-1 top-1 z-10 font-mono text-micro-8 uppercase tracking-cyber text-faint"
    >
      {label}
    </span>
  );
}

/**
 * The two ad containers – one per device class.
 *
 *  · `desktop` – vertical rail right of the chart grid (lg+), receives the
 *    desktop native-banner placement.
 *  · `mobile`  – horizontal strip between toolbar and grid (<lg), receives
 *    the mobile placement (320×100 / responsive native).
 *
 * Visibility is pure CSS (`lg:hidden` / `hidden lg:block`), so orientation
 * changes and resizes flip instantly without JS; the *injection* follows the
 * same breakpoint via matchMedia and lazy-loads the other placement when the
 * visitor crosses it. Containers render only when a placement is configured
 * (build-time env), keeping server/client markup identical.
 */
export function AdSlot({ variant }: { variant: AdVariant }) {
  const ref = useRef<HTMLElement | null>(null);
  const t = useTranslations('ads');
  const src = nativePlacement(variant);
  const containerId = variant === 'desktop' ? NATIVE_DESKTOP_CONTAINER_ID : NATIVE_MOBILE_CONTAINER_ID;
  // Ein Placement darf pro Seite nur einmal gerendert werden (Adsterra-Limit);
  // zeigen beide Slots auf denselben Hash, bleibt der mobile aktiv.
  const active = src !== '' && containerId !== '' && !(variant === 'desktop' && NATIVE_SLOTS_SHARE_PLACEMENT);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!active) return;
    // Gleiche Doctrine wie alle anderen Flächen (Social Bar, Header-Banner,
    // Sidebar-Rail, Smartlinks): Spender sehen gar nichts, QA bleibt werbefrei.
    // M6: die Terminal-Slots hatten diesen Guard als einzige nicht – ein
    // Spender bekam im Terminal weiter Werbung, Puppeteer lud Ad-Skripte.
    if (donationGraceActive() || navigator.webdriver) {
      // Deferred: nie synchrones setState im Effect (React-Regel) – und der
      // SSR-Zustand bleibt bis dahin unverändert (kein Hydration-Mismatch).
      const timer = window.setTimeout(() => setCollapsed(true), 0);
      return () => window.clearTimeout(timer);
    }
    const el = ref.current;
    if (!el) return;
    const mq = window.matchMedia(AD_BREAKPOINT);
    let cancelled = false;

    /** Füllt der Loader den Container? (Nur dann bleibt der Slot reserviert.) */
    const pollFilled = (left: number) => {
      window.setTimeout(() => {
        if (cancelled) return;
        const host = document.getElementById(containerId);
        if (host && (host.querySelector('iframe, ins, img') || host.childElementCount > 1)) return;
        if (left > 0) pollFilled(left - 1);
        else setCollapsed(true); // kein Fill ⇒ kein toter Streifen (M6)
      }, 1_500);
    };

    const apply = () => {
      const isMine = variant === 'desktop' ? mq.matches : !mq.matches;
      if (!isMine) return;
      // Container-gebundenes Self-Placement (next/script kann kein Ziel-Div):
      // async + idle-geplant, damit Werbung nie mit Chart-Arbeit konkurriert.
      whenIdle(() => {
        if (cancelled) return;
        void mountNativeBanner(el, variant).then(() => pollFilled(4));
      });
    };
    apply();
    mq.addEventListener('change', apply);
    return () => {
      cancelled = true;
      mq.removeEventListener('change', apply);
    };
  }, [active, containerId, variant]);

  if (!active || collapsed) return null;
  const label = t('sponsored');
  // Reservierte Fläche = Widget-Layout des Loaders (4:1) ⇒ Kreativ füllt exakt
  // hinein: kein CLS beim Fill, kein Clipping (M6).
  const holder = (
    <div
      id={containerId}
      data-native-banner=""
      className={variant === 'desktop'
        ? 'w-full overflow-hidden [aspect-ratio:4/1] max-h-56'
        : 'w-full overflow-hidden [aspect-ratio:4/1] max-h-36'}
    />
  );

  if (variant === 'desktop') {
    return (
      <aside
        ref={(el) => {
          ref.current = el;
        }}
        data-ad-slot="desktop"
        aria-label={label}
        className="relative mx-auto hidden w-full max-w-4xl shrink-0 px-2 py-2 lg:block"
      >
        <SlotTag label={label} />
        {holder}
      </aside>
    );
  }
  return (
    <div
      ref={(el) => {
        ref.current = el;
      }}
      data-ad-slot="mobile"
      aria-label={label}
      className="relative mx-auto w-full max-w-xl shrink-0 px-2 py-2 lg:hidden"
    >
      <SlotTag label={label} />
      {holder}
    </div>
  );
}
