// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * Ad-Fixtures: Die Sandbox erreicht `globalimmaturelunatic.com` (Adsterra) nicht
 * – und selbst wenn, wäre ein echter Fill nicht reproduzierbar. Für M6 werden
 * die Delivery-Skripte deshalb im Browser abgefangen und durch Stubs ersetzt,
 * die sich wie die echten verhalten:
 *
 *   · Native Banner  – füllt `#container-…` selbst (Terminal 4:1, Header mobil 2:1)
 *   · Sidebar-Rail   – hängt einen 160×600-iframe neben den Loader
 *   · Social Bar     – `position:fixed` am Viewport-Boden, hoher z-index
 *   · Popunder       – merkt sich den nächsten Klick (ohne echtes window.open)
 *
 * Damit sind Fill, No-Fill (Blocker) und Netz-Flake (Fehler, dann Erfolg)
 * deterministisch messbar – inklusive CLS, Überdeckungen und Fehlerpfaden.
 */

export const ADS_HOST = 'globalimmaturelunatic.com';
export const NATIVE_CONTAINER_ID = 'container-2cedab945cb896ea179b566a413d953b';
export const SIDEBAR_KEY = '91280e044de251872788eee6dcbddc079';
export const NATIVE_KEY = '2cedab945cb896ea179b566a413d953b';

const MARK = 'data-nc-adstub';

/** Native Banner: 4:1-Streifen, Header-Fixture mobil 2:1 wie die CSS-Reserve. */
export function nativeFillJs() {
  return `(function(){
  // Wie das echte invoke.js: Ziel-Container aus dem eigenen URL-Hash ableiten.
  // (Fest verdrahtet würde der Desktop-Slot mit eigenem Placement nie füllen –
  // der Stub schriebe in den Container der mobilen Platzierung.)
  var me = document.currentScript;
  var m = /([0-9a-f]{16,64})[/]invoke[.]js/i.exec(me ? me.src : '');
  var id = m ? 'container-' + m[1] : ${JSON.stringify(NATIVE_CONTAINER_ID)};
  function place(){
    var host = document.getElementById(id) || (me && me.closest('[data-native-banner]'));
    if (!host) return false;
    if (host.querySelector('iframe[${MARK}]')) return true;
    var isHeader = id === ${JSON.stringify(NATIVE_CONTAINER_ID)};
    var f = document.createElement('iframe');
    f.setAttribute('${MARK}','native');
    f.setAttribute('title','Sponsored');
    f.style.cssText = 'display:block;border:0;width:100%;background:#0d1520';
    f.srcdoc = '<!doctype html><body style="margin:0;height:100%;display:flex;align-items:center;justify-content:center;font:12px monospace;color:#7fd4ff;background:#0d1520">NC-ADSTUB NATIVE RESPONSIVE</body>';
    function resize(){
      var w = Math.max(240, Math.floor(host.clientWidth || 300));
      var ratio = isHeader && window.matchMedia('(max-width:640px)').matches ? 2 : 4;
      var h = Math.round(w / ratio);
      f.width = String(w); f.height = String(h); f.style.height = h + 'px';
      window.__ncAdStubNative = h;
    }
    host.appendChild(f);
    resize();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(host);
    else window.addEventListener('resize', resize);
    return true;
  }
  if (!place()) window.__ncAdStubNativePending = (window.__ncAdStubNativePending||0)+1;
})();`;
}

/** Sidebar-Rail: 160×600-iframe neben dem Loader (atOptions-Format `iframe`). */
export function sidebarFillJs() {
  return `(function(){
  var s = document.currentScript;
  var host = (s && s.parentElement) || document.body;
  if (host.querySelector('iframe[${MARK}]')) return;
  var o = window.atOptions || {};
  var w = o.width || 160, h = o.height || 600;
  var f = document.createElement('iframe');
  f.setAttribute('${MARK}','sidebar');
  f.setAttribute('title','Sponsored');
  f.width = String(w); f.height = String(h);
  f.style.cssText = 'display:block;border:0;width:'+w+'px;height:'+h+'px;background:#0d1520';
  f.srcdoc = '<!doctype html><body style="margin:0;height:100%;display:flex;align-items:center;justify-content:center;font:12px monospace;color:#ffd47f;background:#0d1520">NC-ADSTUB 160x600</body>';
  host.appendChild(f);
  window.__ncAdStubSidebar = true;
})();`;
}

/** Social Bar: fixiert am Viewport-Boden, eigener (hoher) z-index. */
export function socialBarFillJs({ height = 60 } = {}) {
  return `(function(){
  if (document.getElementById('adsterra-social-bar')) return;
  var d = document.createElement('div');
  d.id = 'adsterra-social-bar';
  d.setAttribute('${MARK}','socialbar');
  d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:${height}px;z-index:2147483000;background:#0d1520;border-top:1px solid #1f6feb';
  var f = document.createElement('iframe');
  f.setAttribute('${MARK}','socialbar');
  f.setAttribute('title','Sponsored');
  f.style.cssText = 'width:100%;height:100%;border:0;background:#0d1520';
  f.srcdoc = '<!doctype html><body style="margin:0;height:100%;display:flex;align-items:center;justify-content:center;font:12px monospace;color:#7fd4ff;background:#0d1520">NC-ADSTUB SOCIAL BAR ${height}px</body>';
  d.appendChild(f);
  document.body.appendChild(d);
})();`;
}

/** Popunder: merkt sich den nächsten Klick (kein echtes Fenster im Test). */
export function popunderFillJs() {
  return `(function(){
  window.__ncAdStubPopunder = (window.__ncAdStubPopunder || 0) + 1;
  if (window.__ncAdStubPopunderArmed) return;
  window.__ncAdStubPopunderArmed = true;
  document.addEventListener('click', function(){
    window.__ncAdStubPopunderOpens = (window.__ncAdStubPopunderOpens || 0) + 1;
  }, true);
})();`;
}

/** Zielseite des Direct-Links (Smartlink-Klick). */
export const SMARTLINK_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>NC-ADSTUB Offer</title></head>' +
  '<body style="margin:0;font:14px monospace;background:#0d1520;color:#7fd4ff;display:flex;align-items:center;justify-content:center;height:100vh">NC-ADSTUB Direct-Link</body></html>';

/** Klassifiziert eine Adsterra-URL → Stub oder `null` (durchlassen). */
export function adStubFor(url, { socialHeight = 60, invokeAs = null } = {}) {
  if (!url.includes(ADS_HOST)) return null;
  if (url.endsWith('/invoke.js')) {
    // `invokeAs` erzwingt eine Form: Der Terminal-Test braucht für beide
    // Geräteklassen ein Native-Widget, auch wenn dort ein fremder Hash steht.
    const kind = invokeAs ?? (url.includes(`${SIDEBAR_KEY}/invoke.js`) ? 'sidebar' : 'native');
    return {
      kind,
      body: kind === 'sidebar' ? sidebarFillJs() : nativeFillJs(),
      contentType: 'application/javascript',
    };
  }
  if (url.includes('/e2/b2/33/')) {
    return { kind: 'socialbar', body: socialBarFillJs({ height: socialHeight }), contentType: 'application/javascript' };
  }
  if (url.includes('/00/ca/4a/')) {
    return { kind: 'popunder', body: popunderFillJs(), contentType: 'application/javascript' };
  }
  if (url.includes('/ufhc3mt24s')) {
    return { kind: 'smartlink', body: SMARTLINK_PAGE, contentType: 'text/html' };
  }
  return { kind: 'other', body: '/* nc-adstub: noop */', contentType: 'application/javascript' };
}

/**
 * Installiert die Ad-Route in einer Seite.
 *
 *   mode 'fill'    – jedes Delivery-Skript füllt (Kreativ sichtbar)
 *   mode 'nofill'  – jedes Delivery-Skript schlägt fehl (Netz-Flake, kein Blocker)
 *   mode 'blocked' – Skripte UND `/ads.js` scheitern + kosmetisches Filtern
 *                    (echter Ad-Blocker)
 *   mode 'flake'   – erster Versuch scheitert, danach füllt es (Retry-Pfad)
 *
 * `onKind` zählt die Anfragen pro Placement (Beweis für Dedupe/Caps).
 */
export async function installAdRoute(page, { mode = 'fill', socialHeight = 60, invokeAs = null, onKind = () => {} } = {}) {
  await page.setRequestInterception(true);
  const counts = { native: 0, sidebar: 0, socialbar: 0, popunder: 0, smartlink: 0, other: 0, adsjs: 0 };
  const perMode = { ...counts };
  let flakeBudget = 1;

  page.on('request', (req) => {
    const url = req.url();
    // Eigener Ad-Block-Bait (`/ads.js`) – im Blocked-Modus abgefangen.
    if (mode === 'blocked' && /\/ads\.js(\?|$)/.test(url)) {
      counts.adsjs += 1;
      return req.abort('failed');
    }
    const stub = adStubFor(url, { socialHeight, invokeAs });
    if (!stub) return req.continue();
    counts[stub.kind] = (counts[stub.kind] ?? 0) + 1;
    perMode[stub.kind] = (perMode[stub.kind] ?? 0) + 1;
    onKind(stub.kind, url);
    if (mode === 'nofill' || mode === 'blocked') return req.abort('failed');
    if (mode === 'flake' && flakeBudget-- > 0) return req.abort('failed');
    return req.respond({
      status: 200,
      contentType: stub.contentType,
      headers: { 'access-control-allow-origin': '*', 'x-nc-fixture': '1', 'cache-control': 'no-store' },
      body: stub.body,
    });
  });

  return { counts, perMode };
}

/**
 * Browser-Instrumentierung für M6 – läuft VOR jedem Dokument-Skript:
 *   · `navigator.webdriver` spoofen (die App schaltet QA sonst werbefrei)
 *   · CLS-Sammler (layout-shift, ohne Nutzereingabe, inkl. Quellen)
 *   · kosmetisches Ad-Filter (nur Blocked-Modus)
 *   · Spender-Status (donation grace) vorbelegen
 */
export function adInstrument(page, { webdriver = false, cosmeticBlock = false, donation = 0 } = {}) {
  const pre = [];
  if (donation > 0) {
    // ACHTUNG: `useViralStore` setzt keine `version` (Default 0). Ein Payload
    // mit `version: 1` würde von zustand verworfen – inklusive
    // Migrations-Fehler in der Konsole (Harness-Artefakt, kein App-Befund).
    pre.push(`try {
      localStorage.setItem('nc-viral-v1', JSON.stringify({
        state: { supporter: true, lastDonationAt: Date.now(), lastDonationUsd: ${donation}, wallDismissedAt: null, shareUnlocked: false, shares: 0, celebrated: [] },
        version: 0
      }));
    } catch (e) {}`);
  }
  if (cosmeticBlock) {
    // Vorsicht: `evaluateOnNewDocument` läuft VOR dem Parsen – `document.head`
    // UND `documentElement` sind dort noch null (der Blocker liefe sonst in
    // einen TypeError und filterte nichts). Deshalb erst einhängen, wenn das
    // Dokument existiert.
    pre.push(`(function(){
      function apply(){
        var root = document.head || document.documentElement;
        if (!root) return false;
        var st = document.createElement('style');
        st.textContent = '.ad-banner,.adsbox,.ad-placement,.pub_300x250,.textads,.banner-ads,.ad-container{display:none!important}';
        root.appendChild(st);
        return true;
      }
      if (!apply()) document.addEventListener('readystatechange', function once(){
        if (apply()) document.removeEventListener('readystatechange', once);
      });
    })();`);
  }
  pre.push(`(function(){
    try {
      Object.defineProperty(navigator, 'webdriver', { get: function(){ return ${webdriver ? 'true' : 'false'}; }, configurable: true });
    } catch (e) {}
    window.__ncCls = { value: 0, count: 0, sources: [] };
    try {
      new PerformanceObserver(function(list){
        for (var e of list.getEntries()) {
          if (e.hadRecentInput) continue;
          window.__ncCls.value += e.value;
          window.__ncCls.count += 1;
          var detail = { value: Math.round(e.value * 10000) / 10000, t: Math.round(e.startTime), nodes: [] };
          (e.sources || []).forEach(function(s){
            var n = s.node;
            var desc = n ? (n.tagName || '?') + (typeof n.className === 'string' && n.className ? '.' + n.className.slice(0, 60) : '') : '?';
            detail.nodes.push({
              node: desc,
              prev: s.previousRect ? [Math.round(s.previousRect.top), Math.round(s.previousRect.left), Math.round(s.previousRect.width), Math.round(s.previousRect.height)] : null,
              next: s.currentRect ? [Math.round(s.currentRect.top), Math.round(s.currentRect.left), Math.round(s.currentRect.width), Math.round(s.currentRect.height)] : null
            });
            window.__ncCls.sources.push({ value: detail.value, t: detail.t, node: desc });
          });
          window.__ncCls.sourcesFull = window.__ncCls.sourcesFull || [];
          window.__ncCls.sourcesFull.push(detail);
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) {}
  })();`);
  return page.evaluateOnNewDocument(pre.join('\n'));
}

/** CLS aus der Seite lesen. */
export async function readCls(page) {
  return page.evaluate(() => {
    const c = window.__ncCls ?? { value: 0, count: 0, sources: [] };
    return { value: Math.round(c.value * 10000) / 10000, count: c.count, sources: c.sources.slice(0, 6) };
  });
}

/** Heap der Ad-Zähler (Fill-/Dedupe-Beweise). */
export async function readAdState(page) {
  return page.evaluate(() => ({
    native: window.__ncAdStubNative ?? null,
    nativePending: window.__ncAdStubNativePending ?? 0,
    sidebar: window.__ncAdStubSidebar === true,
    socialbar: !!document.getElementById('adsterra-social-bar'),
    socialbarVar: getComputedStyle(document.documentElement).getPropertyValue('--nc-socialbar-h').trim(),
    popunderScripts: window.__ncAdStubPopunder ?? 0,
    popunderOpens: window.__ncAdStubPopunderOpens ?? 0,
  }));
}
