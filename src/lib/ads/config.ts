/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Adsterra placement configuration – device aware.
 *
 * Adsterra serves every format (Native Banner, Social Bar, Popunder) as a
 * plain `<script src>` tag tied to a placement hash from the publisher
 * dashboard, and it expects *separate placements for mobile and desktop
 * traffic* (different bids, different creatives). NodeChart therefore ships
 * two containers – a mobile strip and a desktop rail – and injects the
 * matching placement script into the matching container.
 *
 * Environment (all optional, all `NEXT_PUBLIC_*` because injection happens
 * client-side; paste the full script URL per placement):
 *
 *   NEXT_PUBLIC_ADSTERRA_NATIVE_DESKTOP / _MOBILE   native banner per device
 *   NEXT_PUBLIC_ADSTERRA_SOCIALBAR_DESKTOP / _MOBILE
 *   NEXT_PUBLIC_ADSTERRA_POPUNDER_DESKTOP / _MOBILE  override the bundled src
 *   NEXT_PUBLIC_ADSTERRA_CLUSTER_LEFT_KEY / NEXT_PUBLIC_ADSTERRA_CLUSTER_RIGHT_KEY
 *   NEXT_PUBLIC_ADSTERRA_CLUSTER_LEFT_SRC / NEXT_PUBLIC_ADSTERRA_CLUSTER_RIGHT_SRC
 *
 * Legacy single-value variables (`…_NATIVE`, `…_SOCIALBAR`, `…_POPUNDER`) act
 * as fallback for both devices. Some placements also have bundled delivery
 * defaults (including Social Bar, Popunder and banner slots); an empty Env
 * setup does not guarantee that all third-party ad requests are disabled.
 */
// NEXT_PUBLIC_* values are inlined at BUILD time – and only for *static*
// member access (`process.env.NEXT_PUBLIC_X`), never for computed keys.
const nativeBase = process.env.NEXT_PUBLIC_ADSTERRA_NATIVE ?? '';

/**
 * Echtes Adsterra-Social-Bar-Delivery-Skript für nodechart.cc (Dashboard:
 * „Insert it right above the closing </body> tag"). Läuft als Default ohne
 * Env-Setup; `NEXT_PUBLIC_ADSTERRA_SOCIALBAR*` überschreibt es.
 */
const SOCIALBAR_DELIVERY_SRC =
  'https://globalimmaturelunatic.com/e2/b2/33/e2b23323b70ad88bcd24fec9985a99b5.js';
const socialBarBase = process.env.NEXT_PUBLIC_ADSTERRA_SOCIALBAR || SOCIALBAR_DELIVERY_SRC;

/**
 * Echtes Adsterra-Native-Banner-Paar für nodechart.cc (Dashboard-Code:
 * invoke.js + Container-Div, Widget-Layout 4:1). Läuft als Default ohne
 * Env-Setup; `NEXT_PUBLIC_ADSTERRA_NATIVE_BANNER_SRC` überschreibt es.
 */
export const NATIVE_BANNER_SRC: string =
  process.env.NEXT_PUBLIC_ADSTERRA_NATIVE_BANNER_SRC ||
  'https://globalimmaturelunatic.com/2cedab945cb896ea179b566a413d953b/invoke.js';
export const NATIVE_BANNER_CONTAINER_ID = 'container-2cedab945cb896ea179b566a413d953b';

/**
 * Banner 160×600 (linke Terminal-Sidebar, Desktop only). Dashboard-Code:
 * atOptions-Block (key/format/height/width) + Loader-Zeile
 * `<script src="https://globalimmaturelunatic.com/<key>/invoke.js">`.
 * Beide Defaults sind der echte nodechart.cc-Code; Env überschreibt den Loader.
 */
export const SIDEBAR_BANNER_KEY = '91280e044de251872788eee6dcbddc079';
export const SIDEBAR_BANNER_WIDTH = 160;
export const SIDEBAR_BANNER_HEIGHT = 600;
export const SIDEBAR_BANNER_SRCS: readonly string[] = [
  process.env.NEXT_PUBLIC_ADSTERRA_SIDEBAR_SRC ||
    `https://globalimmaturelunatic.com/${SIDEBAR_BANNER_KEY}/invoke.js`,
];

/**
 * NodeCluster medium-rectangle slots reuse the existing configured Adsterra
 * delivery path by default. Dedicated per-slot keys/sources can be supplied
 * when the publisher dashboard has separate 300×250 placements.
 */
const clusterLeftKey = process.env.NEXT_PUBLIC_ADSTERRA_CLUSTER_LEFT_KEY || SIDEBAR_BANNER_KEY;
const clusterRightKey = process.env.NEXT_PUBLIC_ADSTERRA_CLUSTER_RIGHT_KEY || SIDEBAR_BANNER_KEY;
const sidebarBannerSrc = SIDEBAR_BANNER_SRCS[0] || `https://globalimmaturelunatic.com/${SIDEBAR_BANNER_KEY}/invoke.js`;

export const NODECLUSTER_BANNERS = {
  left: {
    key: clusterLeftKey,
    src: process.env.NEXT_PUBLIC_ADSTERRA_CLUSTER_LEFT_SRC
      || (clusterLeftKey === SIDEBAR_BANNER_KEY ? sidebarBannerSrc : `https://globalimmaturelunatic.com/${clusterLeftKey}/invoke.js`),
  },
  right: {
    key: clusterRightKey,
    src: process.env.NEXT_PUBLIC_ADSTERRA_CLUSTER_RIGHT_SRC
      || (clusterRightKey === SIDEBAR_BANNER_KEY ? sidebarBannerSrc : `https://globalimmaturelunatic.com/${clusterRightKey}/invoke.js`),
  },
} as const;

/**
 * Echtes Adsterra-Popunder-Delivery-Skript für nodechart.cc (Dashboard:
 * „Paste the code snippet right before the closing </head> tag"). Läuft als
 * Default ohne Env-Setup; `NEXT_PUBLIC_ADSTERRA_POPUNDER*` überschreibt es.
 */
const POPUNDER_DELIVERY_SRC =
  'https://globalimmaturelunatic.com/00/ca/4a/00ca4a13867dc6964d9b2366466a0448.js';
const popunderBase = process.env.NEXT_PUBLIC_ADSTERRA_POPUNDER || POPUNDER_DELIVERY_SRC;

export const ADSTERRA = {
  /** Native Banner in the desktop rail (lg+). */
  nativeDesktop: process.env.NEXT_PUBLIC_ADSTERRA_NATIVE_DESKTOP || nativeBase,
  /** Native Banner in the mobile strip (< lg). */
  nativeMobile: process.env.NEXT_PUBLIC_ADSTERRA_NATIVE_MOBILE || nativeBase,
  /** Social Bar – self-anchors to the viewport bottom, per device. */
  socialBarDesktop: process.env.NEXT_PUBLIC_ADSTERRA_SOCIALBAR_DESKTOP || socialBarBase,
  socialBarMobile: process.env.NEXT_PUBLIC_ADSTERRA_SOCIALBAR_MOBILE || socialBarBase,
  /** Popunder – armed on the multi-chart gesture, per device. */
  popunderDesktop: process.env.NEXT_PUBLIC_ADSTERRA_POPUNDER_DESKTOP || popunderBase,
  popunderMobile: process.env.NEXT_PUBLIC_ADSTERRA_POPUNDER_MOBILE || popunderBase,
} as const;

export type AdVariant = 'mobile' | 'desktop';

/** Layout breakpoint that separates the mobile slot from the desktop slot. */
export const AD_BREAKPOINT = '(min-width: 1024px)';

/** True when the current viewport counts as desktop for ad purposes. */
export function isDesktopViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(AD_BREAKPOINT).matches;
}

export function nativePlacement(variant: AdVariant): string {
  return variant === 'desktop' ? ADSTERRA.nativeDesktop : ADSTERRA.nativeMobile;
}

/**
 * Container-Div, das der Native-Banner-Loader erwartet.
 *
 * Adsterra-Native-Banner sind Container-gebunden: `…/<hash>/invoke.js` füllt
 * ausschließlich `#container-<hash>`. Ohne dieses Div lädt das Skript fehlerfrei
 * (onload!) und rendert **nichts** – der Slot bliebe trotz konfiguriertem
 * Placement leer. Die Id wird deshalb aus der Placement-URL abgeleitet, statt
 * fest verdrahtet zu sein: damit funktioniert sie auch für die vom Publisher
 * eingetragenen Desktop-/Mobile-Platzierungen.
 *
 * Nicht-Standard-URLs (z. B. `<script src="//pl…/invoke.js" data-key="…">`)
 * liefern `''` ⇒ der Slot rendert dann keinen Container und injiziert nichts.
 */
export function nativeContainerId(src: string): string {
  const hash = /([0-9a-f]{16,64})\/invoke\.js/i.exec(src)?.[1];
  return hash ? `container-${hash}` : '';
}

/** Container-Ids der beiden Terminal-Slots (build-time konstant). */
export const NATIVE_MOBILE_CONTAINER_ID = nativeContainerId(ADSTERRA.nativeMobile);
export const NATIVE_DESKTOP_CONTAINER_ID = nativeContainerId(ADSTERRA.nativeDesktop);

/**
 * Adsterra liefert pro Platzierung genau ein Kreativ und pro Seite genau eine
 * Instanz. Zeigen Desktop- und Mobile-Placement auf denselben Hash (Publisher
 * hat nur eine URL eingetragen), würde der zweite Slot eine **doppelte Id**
 * rendern und nie füllen ⇒ dann bleibt nur der mobile Slot aktiv.
 */
export const NATIVE_SLOTS_SHARE_PLACEMENT =
  NATIVE_MOBILE_CONTAINER_ID !== '' && NATIVE_MOBILE_CONTAINER_ID === NATIVE_DESKTOP_CONTAINER_ID;

export function socialBarPlacement(variant: AdVariant): string {
  return variant === 'desktop' ? ADSTERRA.socialBarDesktop : ADSTERRA.socialBarMobile;
}

export function popunderPlacement(variant: AdVariant): string {
  return variant === 'desktop' ? ADSTERRA.popunderDesktop : ADSTERRA.popunderMobile;
}

export const ADS_ENABLED: boolean = Boolean(
  ADSTERRA.nativeDesktop ||
    ADSTERRA.nativeMobile ||
    ADSTERRA.socialBarDesktop ||
    ADSTERRA.socialBarMobile ||
    ADSTERRA.popunderDesktop ||
    ADSTERRA.popunderMobile,
);

/** Popunder is allowed once per browser session – revenue without rage-clicks. */
export const POPUNDER_SESSION_KEY = 'nc-popunder-fired';
