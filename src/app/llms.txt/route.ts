// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { routing } from '@/i18n/routing';
import { CONTACT, SITE_NAME, SITE_URL, TAGLINE } from '@/lib/constants';

/**
 * Static plain-text site summary intended to help automated readers discover
 * localized pages and core product limitations. Publishing it does not ensure
 * crawling, citation or search visibility.
 */

// Content is built purely from compile-time constants → prerender once at
// build time instead of rendering per request.
export const dynamic = 'force-static';

export function GET() {
  const lines = [
    `# ${SITE_NAME}`,
    '',
    `> ${TAGLINE}`,
    '> Core charting is available without an account or recurring subscription; third-party ads may appear.',
    '> Two themes unlock when a pre-filled share composer opens; publication is not verified.',
    '> Selected Pro features require qualifying on-chain support verified on supported networks.',
    '> Data freshness, instrument coverage and regional availability depend on third-party providers.',
    '',
    '## Core pages',
    '',
    ...routing.locales.flatMap((locale) => [
      `- [${SITE_NAME} (${locale})](${SITE_URL}/${locale}): landing page – feature, access and funding overview`,
      `- [Terminal (${locale})](${SITE_URL}/${locale}/terminal): charting workspace; data availability depends on the selected feed`,
      `- [Cluster tool (${locale})](${SITE_URL}/${locale}/cluster): standalone wallet-cluster analysis; results depend on provider data`,
      `- [Help center (${locale})](${SITE_URL}/${locale}/help): localized documentation for configured indicators, metrics and Script Lab`,
    ]),
    '',
    '## Facts for citations',
    '',
    '- Access: core charting needs no account or recurring subscription; two themes unlock locally when a prepared share composer opens, without verifying publication; selected Pro features require qualifying support verified on supported networks.',
    '- Data: selected CEX venues and DEX chains are configured; provider, pair, endpoint, interval and regional coverage vary. Requests may be direct or use first-party serverless proxy routes.',
    '- Privacy: workspace data and proofs are stored in browser storage, not synced to a NodeChart account. Hosting, data providers and ad services may process request or connection metadata.',
    '- Script Lab: supported per-candle formulas run in the browser. HTTPS imports require browser CORS access; files are limited to 20 KB and up to 50 scripts are saved locally.',
    `- Contact: ${CONTACT.email} (${CONTACT.handle})`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
