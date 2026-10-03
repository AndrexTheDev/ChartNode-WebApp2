// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
import { NextResponse, type NextRequest } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { COUNTRY_COOKIE } from './lib/region';

const intlMiddleware = createMiddleware(routing);

/**
 * Next.js 16 renamed `middleware.ts` → `proxy.ts` (Node.js runtime).
 *
 * What this does for NodeChart:
 *   1. `/` → 307 to `/{locale}` using, in order of precedence:
 *        a. the NEXT_LOCALE cookie (set the first time a user picks a language)
 *        b. the `Accept-Language` header sent by the browser/OS
 *        c. `routing.defaultLocale`
 *      => "automatische Spracherkennung des Systems" with zero JS on the client.
 *   2. Prefixes/validates every other route and keeps deep links intact.
 *   3. Mirrors Cloudflare's `cf-ipcountry` header into a cookie so the client
 *      can adapt exchange selection to the visitor's region – even on fully
 *      prerendered pages, where no request headers exist at render time.
 *   4. Runs on Cloudflare's edge, costs nothing and adds no cold start.
 */
export default function proxy(request: NextRequest) {
  // `next-intl` treats an unsupported two-letter prefix as a normal path and
  // rewrites /xx/terminal to /en/xx/terminal. That falls outside this locale
  // root layout (there intentionally is no app/layout.tsx) and can surface a
  // 500. Redirect locale-shaped unknown prefixes to the equivalent default-
  // locale route before routing; this also keeps invalid locales out of SSG.
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const prefix = segments[0] ?? '';
  const normalizedPrefix = prefix.toLowerCase();
  const localePrefix = routing.locales.includes(normalizedPrefix as (typeof routing.locales)[number]);
  const localeShaped = /^[a-z]{2}$/i.test(prefix);

  // Canonicalize case variants of supported locales (for example /DE → /de)
  // before next-intl sees them; unsupported two-letter prefixes still fall back
  // to the default-locale route (for example /xx/help → /en/help).
  if (localeShaped && (localePrefix ? prefix !== normalizedPrefix : true)) {
    const target = request.nextUrl.clone();
    const destinationLocale = localePrefix ? normalizedPrefix : routing.defaultLocale;
    target.pathname = `/${destinationLocale}${segments.length > 1 ? `/${segments.slice(1).join('/')}` : ''}`;
    return NextResponse.redirect(target);
  }

  const response = intlMiddleware(request);

  // Cloudflare sets cf-ipcountry on every request (two-letter ISO-3166 alpha-2).
  const country = request.headers.get('cf-ipcountry');
  if (country && /^[A-Za-z]{2}$/.test(country) && country.toUpperCase() !== 'XX') {
    const value = country.toUpperCase();
    // Only write when it changed: a Set-Cookie on every navigation would vary
    // the CDN cache key for prerendered pages.
    if (request.cookies.get(COUNTRY_COOKIE)?.value !== value) {
      response.cookies.set(COUNTRY_COOKIE, value, {
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
        sameSite: 'lax',
      });
    }
  }

  return response;
}

export const config = {
  // Match all pathnames except static assets, Next internals and API routes.
  matcher: ['/((?!api|trpc|_next|_vercel|og|icon\\.svg|favicon\\.ico|.*\\..*).*)'],
};
