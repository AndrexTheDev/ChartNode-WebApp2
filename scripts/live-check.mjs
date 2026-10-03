#!/usr/bin/env node
// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * Live-Endkontrolle nach dem Deploy (M9) – prüft die ausgelieferte Domain so,
 * wie ein Crawler, ein Social-Bot und ein Browser sie sehen.
 *
 *   npm run check:live                                   # https://nodechart.cc
 *   node scripts/live-check.mjs --site https://staging.example.com
 *   SITE_URL=http://127.0.0.1:3000 node scripts/live-check.mjs   # lokal
 *
 * Ersetzt die Klickliste aus VEROEFFENTLICHEN.md §5: Sitemap-URLs, hreflang-
 * Netz, Canonicals, robots-Meta, JSON-LD, OG-Karte, 404-Verhalten,
 * Cache-Header, Security-Header und die Domain-Regeln (Always HTTPS,
 * www → apex). Prüfungen, die nur auf der echten Domain Sinn ergeben, werden
 * außerhalb von nodechart.cc als SKIP geführt.
 */
const argvSiteFlag = process.argv.indexOf('--site');
const SITE = (
  process.env.SITE_URL
  ?? process.argv.find((a) => a.startsWith('--site='))?.slice(7)
  ?? (argvSiteFlag !== -1 ? process.argv[argvSiteFlag + 1] : undefined)
  ?? 'https://nodechart.cc'
).replace(/\/+$/, '');
const CANONICAL = 'https://nodechart.cc';
const IS_PROD = SITE === CANONICAL;
const LOCALES = ['de', 'en', 'es', 'ru', 'zh'];
const ROUTE_PATHS = ['', '/terminal', '/cluster', '/help', '/legal/terms', '/legal/privacy', '/legal/disclaimer'];
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const UA_TELEGRAM = 'TelegramBot (like TwitterBot)';

let pass = 0;
let fail = 0;
let skip = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ''}`);
};
const skipped = (name, why) => {
  skip += 1;
  console.log(`  SKIP  ${name} — ${why}`);
};

const get = async (path, opts = {}) => {
  const request = () => fetch(`${SITE}${path}`, {
    redirect: opts.follow ? 'follow' : 'manual',
    headers: { 'user-agent': opts.ua ?? UA_BROWSER, accept: opts.accept ?? 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(20_000),
  });

  try {
    let res = await request();
    if (res.status >= 500) {
      console.log(`  RETRY ${SITE}${path} — HTTP ${res.status}; retrying in 3 s`);
      // Free the first response's connection; a cleanup error must not prevent retry.
      await res.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      res = await request();
    }

    const body = opts.body === false ? '' : await res.text();
    return { status: res.status, headers: res.headers, body };
  } catch (error) {
    // Netzfehler (Domain nicht erreichbar, Timeout) sind ein FAIL, kein Crash:
    // Status 0 lässt jede Folgerprüfung rot laufen, statt das Skript zu beenden.
    console.log(`  NETZ  ${SITE}${path} — ${error?.cause?.message ?? error?.message ?? error}`);
    return { status: 0, headers: new Headers(), body: '' };
  }
};
/** Inhalt eines <meta>-Tags, Attributreihenfolge egal: meta('name','robots'). */
const meta = (html, attr, value) => {
  const v = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<meta[^>]*${attr}="${v}"[^>]*content="([^"]*)"`, 'i');
  const re2 = new RegExp(`<meta[^>]*content="([^"]*)"[^>]*${attr}="${v}"`, 'i');
  return (re.exec(html)?.[1] ?? re2.exec(html)?.[1] ?? '').replace(/&amp;/g, '&');
};
/** href eines <link rel="…">, z. B. linkHref(html, 'canonical'). */
const linkHref = (html, rel) => {
  const re = new RegExp(`<link[^>]*rel="${rel}"[^>]*href="([^"]*)"`, 'i');
  const re2 = new RegExp(`<link[^>]*href="([^"]*)"[^>]*rel="${rel}"`, 'i');
  return (re.exec(html)?.[1] ?? re2.exec(html)?.[1] ?? '').replace(/&amp;/g, '&');
};

console.log(`\n═══ Live-Endkontrolle: ${SITE} ═══\n`);

/* ------------------------------- Landing -------------------------------- */
console.log('— Startseite —');
const root = await get('/', { follow: false });
check('"/" leitet auf eine Sprache (307/308)', root.status === 307 || root.status === 308, `${root.status} → ${root.headers.get('location') ?? '?'}`);

const de = await get('/de');
check('/de antwortet 200', de.status === 200, String(de.status));
check('canonical zeigt auf die eigene Domain', linkHref(de.body, 'canonical') === `${CANONICAL}/de`, linkHref(de.body, 'canonical') || 'kein canonical');
// React schreibt das Attribut als `hrefLang` (großes L) – deshalb /i.
const hreflangs = [...de.body.matchAll(/hreflang="([^"]+)"/gi)].map((m) => m[1]);
check('hreflang-Netz vollständig (5 Sprachen + x-default)', LOCALES.every((l) => hreflangs.includes(l)) && hreflangs.includes('x-default'), hreflangs.join(','));
check('genau eine h1 auf /de', (de.body.match(/<h1[\s>]/g) ?? []).length === 1, `${(de.body.match(/<h1[\s>]/g) ?? []).length}`);
const ld = de.body.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g) ?? [];
const ldTypes = ld.join(' ').match(/"@type"\s*:\s*"([A-Za-z]+)"/g)?.map((s) => s.split('"')[3]) ?? [];
check('JSON-LD: Organization + WebSite + SoftwareApplication', ['Organization', 'WebSite', 'SoftwareApplication'].every((t) => ldTypes.includes(t)), [...new Set(ldTypes)].join(','));
// Next trennt die Direktiven: `robots` für index/follow, `googlebot` für die
// Snippet-/Vorschau-Regeln. Beides muss stimmen – sonst kürzt Google Snippets.
const robotsMeta = meta(de.body, 'name', 'robots');
const googlebotMeta = meta(de.body, 'name', 'googlebot');
check('robots-Meta erlaubt Indexierung', /index/.test(robotsMeta) && /follow/.test(robotsMeta), robotsMeta || 'kein robots-Meta');
check('googlebot darf volle Snippets + große Vorschau', /max-snippet:-1/.test(googlebotMeta) && /max-image-preview:large/.test(googlebotMeta), googlebotMeta || 'kein googlebot-Meta');
const title = (de.body.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? '';
check('Titel im Snippet-Fenster (25–70 Zeichen)', title.length >= 25 && title.length <= 70, `${title.length}: ${title}`);
check('Cache-Header der Seite (s-maxage=300)', (de.headers.get('cache-control') ?? '').includes('s-maxage=300'), de.headers.get('cache-control') ?? '-');

/* ------------------------------- Terminal ------------------------------- */
console.log('\n— Terminal —');
const term = await get('/de/terminal');
check('/de/terminal antwortet 200', term.status === 200, String(term.status));
check('Terminal ist indexierbar (Produktseite)', /index/.test(meta(term.body, 'name', 'robots')), meta(term.body, 'name', 'robots'));
check('Terminal rendert serverseitig (Canvas-Markup vorhanden)', /lightweight|chart|canvas/i.test(term.body));
const shared = await get('/de/terminal?ticker=SOL&price=150');
check('geteilte Parameter-Variante bleibt noindex', /noindex/.test(meta(shared.body, 'name', 'robots')), meta(shared.body, 'name', 'robots'));

/* ------------------------------ Social-Card ----------------------------- */
console.log('\n— Social-Card (Telegram/Bot-Sicht) —');
const og = await get('/api/og?ticker=SOL&price=150&change=2.4', { ua: UA_TELEGRAM, accept: 'image/svg+xml' });
check('/api/og liefert 200 + image/svg+xml', og.status === 200 && (og.headers.get('content-type') ?? '').includes('image/svg+xml'), `${og.status} ${og.headers.get('content-type')}`);
check('OG-Karte trägt Ticker, Preis und Change', og.body.includes('$SOL') && og.body.includes('150') && og.body.includes('+2.40%'));
const ogDefault = meta(term.body, 'property', 'og:image');
check('og:image ist auf dem Terminal gesetzt', ogDefault.includes('/api/og'), ogDefault || 'kein og:image');
// Der Sinn der dynamischen Karte: die geteilte URL bringt Ticker + Preis mit.
const ogShared = meta(shared.body, 'property', 'og:image');
check('geteilte URL erzeugt die Karte mit Ticker+Preis', ogShared.includes('/api/og') && ogShared.includes('ticker=SOL') && ogShared.includes('price=150'), ogShared);
check('Twitter-Card ist summary_large_image', meta(term.body, 'name', 'twitter:card') === 'summary_large_image', meta(term.body, 'name', 'twitter:card') || 'kein twitter:card');
const silent = await get('/og.png', { body: false });
check('/og.png (statische Karte) ist erreichbar', silent.status === 200, String(silent.status));

/* -------------------------------- Crawler ------------------------------- */
console.log('\n— Crawler-Hygiene —');
const sm = await get('/sitemap.xml', { accept: 'application/xml' });
check('sitemap.xml antwortet 200', sm.status === 200, String(sm.status));
const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const expectedLocs = LOCALES.flatMap((locale) => ROUTE_PATHS.map((path) => `${CANONICAL}/${locale}${path}`));
check(
  `Sitemap enthält konfigurierte Routen je Sprache (${expectedLocs.length})`,
  locs.length === expectedLocs.length && expectedLocs.every((url) => locs.includes(url)),
  `actual=${locs.length}; expected=${expectedLocs.length}`,
);
check('Sitemap-URLs zeigen auf die kanonische Domain', locs.every((u) => u.startsWith(`${CANONICAL}/`)), locs.slice(0, 2).join(' '));
check('Sitemap trägt hreflang + lastmod', sm.body.includes('xhtml:link') && sm.body.includes('<lastmod>'));
check('Sitemap ist 1 h am Edge gecacht', (sm.headers.get('cache-control') ?? '').includes('s-maxage=3600'), sm.headers.get('cache-control') ?? '-');
const robots = await get('/robots.txt', { accept: 'text/plain' });
check('robots.txt erlaubt Crawler', /Allow: \//.test(robots.body));
check('robots.txt verweist auf die Sitemap', robots.body.includes(`${CANONICAL}/sitemap.xml`), robots.body.split('\n').filter((l) => l.startsWith('Sitemap')).join(' '));
const llms = await get('/llms.txt', { accept: 'text/plain' });
check('llms.txt für AI-Antwortmaschinen erreichbar', llms.status === 200 && llms.body.length > 200, `${llms.status}, ${llms.body.length} Zeichen`);

/* ------------------------------- Fehlerseiten --------------------------- */
console.log('\n— Fehlerverhalten —');
const nope1 = await get('/de/legal/nope');
check('unbekanntes Legal-Dokument = 404 (keine Soft-404)', nope1.status === 404, String(nope1.status));
const nope2 = await get('/de/nope');
check('unbekannte Unterseite = 404', nope2.status === 404, String(nope2.status));
const xx = await get('/xx', { follow: false });
const xxTarget = xx.headers.get('location') ?? '';
const xxFollow = await get('/xx', { follow: true });
check('unbekannte Sprache endet im 404', xxFollow.status === 404, `${xx.status} → ${xxTarget} → ${xxFollow.status}`);

/* ------------------------------ Kopfzeilen ------------------------------ */
console.log('\n— Header & Domain-Regeln —');
check('X-Content-Type-Options: nosniff', de.headers.get('x-content-type-options') === 'nosniff', de.headers.get('x-content-type-options') ?? '-');
check('Referrer-Policy gesetzt', Boolean(de.headers.get('referrer-policy')), de.headers.get('referrer-policy') ?? '-');
check('Permissions-Policy gesetzt', Boolean(de.headers.get('permissions-policy')), de.headers.get('permissions-policy') ?? '-');
check('Server-Kennung ist nicht Next.js', !/next\.js/i.test(de.headers.get('x-powered-by') ?? ''), de.headers.get('x-powered-by') ?? 'kein x-powered-by');
if (IS_PROD) {
  try {
    const plain = await fetch(`http://${SITE.replace(/^https?:\/\//, '')}/de`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    check('Always Use HTTPS aktiv (http → https)', plain.status >= 300 && plain.status < 400 && (plain.headers.get('location') ?? '').startsWith('https://'), `${plain.status} → ${plain.headers.get('location') ?? '?'}`);
  } catch (error) {
    check('Always Use HTTPS aktiv (http → https)', false, error.message);
  }
  try {
    const www = await fetch('https://www.nodechart.cc/de', { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    check('www leitet auf apex um (kein Canonical-Split)', www.status >= 300 && www.status < 400 && (www.headers.get('location') ?? '').includes('https://nodechart.cc'), `${www.status} → ${www.headers.get('location') ?? '?'}`);
  } catch (error) {
    skipped('www → apex', `www.nodechart.cc nicht erreichbar (${error.message})`);
  }
  const t0 = Date.now();
  await get('/de', { body: false });
  const ttfb = Date.now() - t0;
  check('Antwortzeit der Edge (≤ 1500 ms)', ttfb <= 1500, `${ttfb} ms`);
} else {
  skipped('Always Use HTTPS', 'nur auf der Produktionsdomain prüfbar');
  skipped('www → apex', 'nur auf der Produktionsdomain prüfbar');
}

/* ------------------------------- Sprachen ------------------------------- */
console.log('\n— Alle fünf Sprachen —');
for (const locale of LOCALES) {
  const page = await get(`/${locale}`);
  check(`/${locale} 200 + eigene Sprache im Markup`, page.status === 200 && page.body.includes(`lang="${locale === 'zh' ? 'zh-Hans' : locale === 'de' ? 'de-DE' : locale === 'es' ? 'es-ES' : locale === 'ru' ? 'ru-RU' : 'en'}"`), String(page.status));
}
const help = await get('/de/help');
check('Hilfeseite erreichbar + FAQ-Schema', help.status === 200 && help.body.includes('FAQPage'), String(help.status));
check('Glossar-Schema (DefinedTermSet) vorhanden', help.body.includes('DefinedTermSet'));

console.log(`\n${fail === 0 ? '✔' : '✖'} Live-Kontrolle: ${pass} PASS / ${fail} FAIL${skip ? ` · ${skip} SKIP` : ''}\n`);
process.exit(fail === 0 ? 0 : 1);
