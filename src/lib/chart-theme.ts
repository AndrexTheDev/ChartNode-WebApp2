/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Chart theming.
 *
 * The design system stores every color as an HSL triplet CSS variable
 * (`--nc-primary: 183 100% 50%`) on `<html data-theme="…">`. Instead of
 * duplicating three palettes here, the chart reads the *live* values, so it
 * always matches the surrounding UI — including a theme the user switched to
 * while the terminal was open.
 *
 * Canvas needs concrete color strings, so triplets are rebuilt as
 * `hsl(h, s%, l%)` (comma syntax: universally supported by canvas parsers).
 * lightweight-charts v5 resolves every colour through the canvas 2D context's
 * *native* color parser (sRGB, up-converted to Display P3 on capable panels)
 * — so we always pass sRGB strings and never do manual channel math ourselves.
 */

export interface ChartTheme {
  bg: string;
  surface: string;
  grid: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  primary: string;
  secondary: string;
  accent: string;
  bull: string;
  bear: string;
  /** Magenta family – critical alerts (price alerts, execution warnings). */
  danger: string;
  /** Amber – indicator overlays (aVWAP, bar-close countdown). */
  warning: string;
  /** 0..1 – how strong the grid lines are. */
  gridOpacity: number;
}

/**
 * Token-exakte Cyberpunk Pro Dark Defaults (HSL-Komma-Syntax, canvas-tauglich).
 * Auch der Fallback-Theme-Stub in `primitives.ts` nutzt diese Werte, damit
 * nirgends zweite, leicht abweichende Hex-Kopien der Tokens herumliegen.
 */
export const CHART_THEME_FALLBACK: ChartTheme = {
  bg: 'hsl(220, 18%, 7%)',
  surface: 'hsl(220, 15%, 11%)',
  grid: 'hsl(218, 14%, 22%)',
  border: 'hsl(218, 14%, 22%)',
  text: 'hsl(215, 30%, 97%)',
  muted: 'hsl(215, 15%, 65%)',
  faint: 'hsl(215, 12%, 55%)',
  primary: 'hsl(183, 100%, 50%)',
  secondary: 'hsl(215, 70%, 78%)',
  accent: 'hsl(183, 100%, 50%)',
  bull: 'hsl(158, 55%, 62%)',
  bear: 'hsl(348, 70%, 70%)',
  danger: 'hsl(330, 100%, 74%)',
  warning: 'hsl(41, 100%, 60%)',
  gridOpacity: 0.45,
};

const FALLBACK = CHART_THEME_FALLBACK;

/** `183 100% 50%` → `hsl(183, 100%, 50%)`; optional alpha → 4th component. */
export function hsl(triplet: string, alpha?: number): string | null {
  const parts = triplet.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const [h, s, l] = parts as [string, string, string];
  return alpha === undefined ? `hsl(${h}, ${s}, ${l})` : `hsl(${h}, ${s}, ${l}, ${alpha})`;
}

/**
 * Reads the palette for `theme`.
 *
 * The id is not just a cache key: when the store has already flipped but the
 * `data-theme` attribute write is still in flight, we read the variables from a
 * throwaway probe element carrying the requested theme, so the chart never
 * paints one frame in the previous skin.
 */
export function readChartTheme(theme?: string): ChartTheme {
  if (typeof window === 'undefined' || typeof document === 'undefined') return FALLBACK;

  let host: HTMLElement = document.documentElement;
  let probe: HTMLDivElement | null = null;
  if (theme && document.documentElement.getAttribute('data-theme') !== theme) {
    probe = document.createElement('div');
    probe.setAttribute('data-theme', theme);
    probe.style.display = 'none';
    document.body.appendChild(probe);
    host = probe;
  }

  try {
    const styles = getComputedStyle(host);
    const get = (name: string): string => styles.getPropertyValue(name).trim();
    const resolved: ChartTheme = {
      bg: hsl(get('--nc-bg')) ?? FALLBACK.bg,
      surface: hsl(get('--nc-surface')) ?? FALLBACK.surface,
      grid: hsl(get('--nc-line')) ?? FALLBACK.grid,
      border: hsl(get('--nc-line')) ?? FALLBACK.border,
      text: hsl(get('--nc-fg')) ?? FALLBACK.text,
      muted: hsl(get('--nc-muted')) ?? FALLBACK.muted,
      faint: hsl(get('--nc-faint')) ?? FALLBACK.faint,
      primary: hsl(get('--nc-primary')) ?? FALLBACK.primary,
      secondary: hsl(get('--nc-secondary')) ?? FALLBACK.secondary,
      accent: hsl(get('--nc-accent')) ?? FALLBACK.accent,
      bull: hsl(get('--nc-bull')) ?? FALLBACK.bull,
      bear: hsl(get('--nc-bear')) ?? FALLBACK.bear,
      danger: hsl(get('--nc-danger')) ?? FALLBACK.danger,
      warning: hsl(get('--nc-warning')) ?? FALLBACK.warning,
      gridOpacity: Number.parseFloat(get('--nc-grid-opacity')) || FALLBACK.gridOpacity,
    };
    return resolved;
  } catch {
    return FALLBACK;
  } finally {
    probe?.remove();
  }
}

/**
 * Alpha helper that stays in "colour string" land on purpose: the result is a
 * CSS colour the canvas 2D context parses natively (sRGB / Display P3), never
 * a pre-computed rgb() that would drift from the theme tokens.
 */
export function withAlpha(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  // hsl(183, 100%, 50%)  →  hsl(183, 100%, 50%, a)
  const comma = color.match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/);
  if (comma && comma[1] && comma[2] && comma[3]) {
    return `hsl(${comma[1]}, ${comma[2]}%, ${comma[3]}%, ${alpha})`;
  }
  // hsl(183 100% 50%)  →  hsl(183 100% 50% / a)
  const space = color.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/);
  if (space && space[1] && space[2] && space[3]) {
    return `hsl(${space[1]} ${space[2]}% ${space[3]}% / ${alpha})`;
  }
  // #rrggbb → rgba() so hex accents (e.g. SERIES_COLORS) also support alpha
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex && hex[1]) {
    const value = Number.parseInt(hex[1], 16);
    const r = (value >> 16) & 0xff;
    const g = (value >> 8) & 0xff;
    const b = value & 0xff;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}
