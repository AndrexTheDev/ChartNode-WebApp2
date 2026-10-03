/* © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md. */
/**
 * Open-Graph card renderer – dependency-free SVG (1200×630).
 *
 * Runs on the serverless `/api/og` route and stays a pure string builder:
 * no DOM, wasm, or font fetches. Every dynamic value is XML-escaped because
 * ticker/price arrive from query parameters. A shared price is a snapshot,
 * not a live quote; the card says so explicitly.
 */

export interface OgInput {
  ticker: string;
  price: string | null;
  changePct: number | null;
  locale: string;
}

/** Localized card copy; claims remain qualified on every share card. */
const OG_STRINGS: Record<string, { tagline: string; footer: string; priceNote: string }> = {
  en: {
    tagline: 'Selected CEX/DEX markets · browser charts',
    footer: 'No core subscription · third-party ads or links may appear',
    priceNote: 'Price snapshot when shared; provider data may be delayed.',
  },
  de: {
    tagline: 'Ausgewählte CEX/DEX-Märkte · Browsercharts',
    footer: 'Kein Abo für Basiszugang · Drittanbieterwerbung möglich',
    priceNote: 'Preisstand beim Teilen; Anbieterdaten können verzögert sein.',
  },
  es: {
    tagline: 'Mercados CEX/DEX seleccionados · gráficos web',
    footer: 'Sin suscripción básica · puede haber anuncios o enlaces externos',
    priceNote: 'Precio al compartir; los datos del proveedor pueden retrasarse.',
  },
  ru: {
    tagline: 'Выбранные рынки CEX/DEX · графики в браузере',
    footer: 'Базовый доступ без подписки · возможна сторонняя реклама',
    priceNote: 'Цена на момент отправки; данные провайдера могут запаздывать.',
  },
  zh: {
    tagline: '精选 CEX/DEX 市场 · 浏览器图表',
    footer: '核心功能无需订阅 · 可能显示第三方广告或链接',
    priceNote: '分享时的价格快照；服务商数据可能延迟。',
  },
};

/** Whitelist-Fallback: unbekannte/?constructor-Locales landen auf EN. */
export function ogLocale(raw: string | null): string {
  return raw && Object.prototype.hasOwnProperty.call(OG_STRINGS, raw) ? raw : 'en';
}

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Sanitises a `?ticker=` query value – cashtags only, never markup. */
export function sanitizeTicker(raw: string | null): string {
  const clean = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return clean || 'BTC';
}

export function sanitizePrice(raw: string | null): string | null {
  const n = Number.parseFloat(raw ?? '');
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
}

export function buildOgSvg(input: OgInput): string {
  const ticker = escapeXml(sanitizeTicker(input.ticker));
  const price = input.price ? escapeXml(input.price) : null;
  const up = (input.changePct ?? 0) >= 0;
  const change =
    input.changePct === null ? null : `${up ? '+' : ''}${input.changePct.toFixed(2)}%`;
  const changeColor = up ? '#00ff9d' : '#ff2e63';
  const copy = OG_STRINGS[ogLocale(input.locale)] ?? OG_STRINGS.en ?? { tagline: '', footer: '', priceNote: '' };

  const grid = Array.from({ length: 11 }, (_, i) => {
    const x = 60 + i * 108;
    return `<line x1="${x}" y1="0" x2="${x}" y2="${OG_HEIGHT}" stroke="#123018" stroke-width="1"/>`;
  }).join('');
  const gridH = Array.from({ length: 5 }, (_, i) => {
    const y = 70 + i * 110;
    return `<line x1="0" y1="${y}" x2="${OG_WIDTH}" y2="${y}" stroke="#123018" stroke-width="1"/>`;
  }).join('');

  // Decorative candles only; these do not represent a market-data snapshot.
  const candles = Array.from({ length: 26 }, (_, i) => {
    const x = 70 + i * 42;
    const seed = Math.sin(i * 12.9898) * 43758.5453;
    const frac = seed - Math.floor(seed);
    const h = 60 + frac * 120;
    const y = 470 - h;
    const green = frac > 0.45;
    const color = green ? '#00ff9d' : '#ff2e63';
    return (
      `<line x1="${x}" y1="${y - 22}" x2="${x}" y2="${y + h + 22}" stroke="${color}" stroke-width="2"/>` +
      `<rect x="${x - 8}" y="${y}" width="16" height="${h}" fill="${color}" opacity="0.85"/>`
    );
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#050807"/>
      <stop offset="1" stop-color="#0a1410"/>
    </linearGradient>
    <linearGradient id="neon" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#39ff14"/>
      <stop offset="1" stop-color="#00f0ff"/>
    </linearGradient>
  </defs>
  <rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#bg)"/>
  <g opacity="0.5">${grid}${gridH}</g>
  <g opacity="0.55">${candles}</g>
  <rect x="0" y="0" width="${OG_WIDTH}" height="6" fill="url(#neon)"/>
  <!-- These are optimized crops of the supplied logo image, not redrawn paths. -->
  <image href="/brand/nodechart-mark.webp" x="64" y="28" width="64" height="64" preserveAspectRatio="xMidYMid meet"/>
  <image href="/brand/nodechart-wordmark.webp" x="143" y="33" width="270" height="61" preserveAspectRatio="xMidYMid meet"/>
  <text x="64" y="250" font-family="monospace" font-size="110" font-weight="800" fill="#f2fff2">$${ticker}</text>
  ${
    price
      ? `<text x="64" y="330" font-family="monospace" font-size="56" fill="#39ff14">$${price}</text>`
      : `<text x="64" y="330" font-family="monospace" font-size="40" fill="#7d9c7d">${escapeXml(copy.tagline)}</text>`
  }
  ${
    change
      ? `<text x="${price ? 64 + price.length * 34 + 40 : 64}" y="330" font-family="monospace" font-size="44" fill="${changeColor}">${escapeXml(change)}</text>`
      : ''
  }
  ${price ? `<text x="64" y="378" font-family="monospace" font-size="20" fill="#9bb49b">${escapeXml(copy.priceNote)}</text>` : ''}
  <text x="64" y="580" font-family="monospace" font-size="24" fill="#9bb49b">${escapeXml(copy.footer)}</text>
  <text x="${OG_WIDTH - 40}" y="580" text-anchor="end" font-family="monospace" font-size="28" fill="#39ff14" opacity="0.8">$${ticker}</text>
</svg>`;
}
