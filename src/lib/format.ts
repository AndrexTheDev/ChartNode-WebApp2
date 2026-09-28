// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
const USD_SMALL = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 4,
});

const USD_BIG = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const COMPACT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

/** Price formatting: tiny prices keep significant digits, big prices 2 dp. */
export function usd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return Math.abs(value) < 1 ? USD_SMALL.format(value) : USD_BIG.format(value);
}

/** `$1.2M`, `$845K` – for notionals and volumes. */
export function compactUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${COMPACT.format(value)}`;
}

export function compact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return COMPACT.format(value);
}

export function pct(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function clockTime(ts: number): string {
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Decimal places a price axis should show, derived from the price magnitude.
 * Matches what the exchanges print, so chart, order book and ticker agree:
 * 78 126.23 → 2, 145.32 → 2, 42.567 → 3, 0.4212 → 4, 0.00001234 → 8.
 */
export function pricePrecision(price: number | null | undefined): number {
  const value = Math.abs(price ?? 0);
  if (!Number.isFinite(value) || value === 0) return 2;
  if (value >= 100) return 2;
  if (value >= 10) return 3;
  if (value >= 0.1) return 4;
  if (value >= 0.01) return 5;
  if (value >= 0.001) return 6;
  if (value >= 0.0001) return 7;
  return 8;
}

/** Matching `minMove` for lightweight-charts `priceFormat`. */
export function minMoveFor(precision: number): number {
  return 1 / 10 ** precision;
}

/**
 * Datum/Uhrzeit im **App**-Locale, nicht im Browser-Locale.
 *
 * Zwei Gründe:
 *  1. i18n: Ohne explizites Tag formatiert `toLocaleString()` in der
 *     Browsersprache. Wer die russische UI liest, bekam bisher deutsche Daten.
 *  2. Robustheit: Ein exotisches/ungültiges Runtime-Locale (z. B. POSIX-Strings
 *     wie `en-US@posix` in Containern oder manchen Webviews) lässt `Intl` mit
 *     einer RangeError abbrechen – hier fällt es auf `en-US` zurück statt die
 *     Komponente zu werfen.
 */
const dateTimeCache = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormatter(tag: string): Intl.DateTimeFormat {
  const cached = dateTimeCache.get(tag);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(tag, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' });
  }
  dateTimeCache.set(tag, formatter);
  return formatter;
}

/** `23.03.26, 14:05` – datumslokalisierter Zeitstempel für Tool-Panels. */
export function dateTime(ms: number | null | undefined, locale = 'en'): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  try {
    return dateTimeFormatter(locale).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * BCP-47-Tag, der garantiert von `Intl` akzeptiert wird.
 *
 * Runtime-Locales sind nicht immer sauber: Container setzen `LANG=en_US.UTF-8`,
 * POSIX-Modifier (`en-US@posix`) oder Windows-Notation (`de-DE-u-co-phonebk` ist
 * ok, `German_Germany` nicht). Ein ungültiges Tag lässt `Intl` mit `RangeError`
 * werfen – hier wird es auf den Sprach-Subtag reduziert und validiert.
 */
export function safeLocale(raw?: string | null): string {
  if (!raw) return 'en';
  const tag = (raw.split('@')[0] ?? '').replace(/_/g, '-').trim();
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? 'en';
  } catch {
    /* fall through */
  }
  const base = tag.split('-')[0] ?? tag;
  try {
    return Intl.getCanonicalLocales(base)[0] ?? 'en';
  } catch {
    return 'en';
  }
}
