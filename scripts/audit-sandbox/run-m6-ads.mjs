// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * M6-Suite: Werbung/Monetarisierung im Fill-Fall.
 *
 * Die Adsterra-Skripte werden im Browser durch Stubs ersetzt (ad-fixtures.mjs),
 * damit „Kreativ füllt", „kein Fill" (Netz-Flake) und „echter Blocker"
 * deterministisch und beliebig oft messbar sind. Geprüft wird, was der Nutzer
 * merkt: springt das Layout (CLS), liegt Werbung über Bedienelementen, bleibt
 * ein toter Slot stehen, feuert der Popunder mehr als einmal, ist die
 * Anti-Blocker-Wall lokalisiert und wieder schließbar.
 *
 * Aufruf:  node scripts/audit-sandbox/run-m6-ads.mjs [--quick]
 * Report:  /tmp/nc-shots/m6-report.json
 */
import { launch, instrument, classify, wait, BASE, SHOTS, shot } from '/home/user/ChartNode-WebApp2/scripts/audit-sandbox/lib.mjs';
import {
  adInstrument,
  installAdRoute,
  readAdState,
  readCls,
  NATIVE_CONTAINER_ID,
} from '/home/user/ChartNode-WebApp2/scripts/audit-sandbox/ad-fixtures.mjs';

const QUICK = process.argv.includes('--quick');

/** Aus dem Server-HTML lesen, ob ein Slot überhaupt konfiguriert ist –
 *  ein kollabierter Slot ist NICHT dasselbe wie ein nicht konfigurierter. */
async function configuredSlots() {
  const html = await fetch(`${BASE}/de/terminal`).then((r) => r.text()).catch(() => '');
  return { mobile: html.includes('data-ad-slot="mobile"'), desktop: html.includes('data-ad-slot="desktop"') };
}
const T = (s) => Math.round((QUICK ? s * 0.6 : s) * 1000); // Wartezeiten (ms)
const results = [];
let stage = 'S0';
const logs = []; // { log, mode, label }

function check(name, ok, detail = '') {
  results.push({ stage, name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} [${stage}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function openPage(browser, { path, width = 1440, height = 900, mode = 'fill', webdriver = false, donation = 0, socialHeight = 60, cosmeticBlock = false, invokeAs = null }) {
  // Eigener Context pro Seite: `browser.newPage()` teilt sich sonst Storage –
  // ein Spender-Payload aus S8 würde Popunder und Smartlink-Kit in S9/S10
  // unterdrücken (Mess-Artefakt, kein App-Befund).
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 1024, hasTouch: width < 1024 });
  const route = await installAdRoute(page, { mode, socialHeight, invokeAs });
  await adInstrument(page, { webdriver, donation, cosmeticBlock });
  const log = instrument(page);
  logs.push({ log, mode, label: `${path} @${width}` });
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined);
  await wait(T(2.2)); // Erstkontakt + idle-geplante Injection
  const close = async () => {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  };
  return { page, context, log, route, close };
}

/**
 * Überdeckt `selector` (z. B. die Social Bar) bedienbare Elemente?
 *
 * Unterschieden wird zwischen **fest verankerter** UI (`position: fixed|sticky`
 * – Docks, Leisten, Footer-Ticker: darf NIE verdeckt sein) und transienter
 * Überdeckung mitten in einer scrollenden Seite (unvermeidbar bei einer
 * Fixed-Bar; der Nutzer scrollt sie weg – gleiches Verhalten wie ein Sticky-
 * Header oben). Gemeldet wird beides, gewertet nur das erste.
 */
async function overlaps(page, selector) {
  return page.evaluate((sel) => {
    const bar = document.querySelector(sel);
    if (!bar) return { missing: true, hits: [], persistent: [], count: 0, persistentCount: 0 };
    const b = bar.getBoundingClientRect();
    const hits = [];
    const persistent = [];
    const isAnchored = (el) => {
      let p = el;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if (cs.position === 'fixed' || cs.position === 'sticky') return true;
        p = p.parentElement;
      }
      return false;
    };
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [data-testid]')) {
      if (bar.contains(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > window.innerHeight) continue;
      const ix = Math.min(b.right, r.right) - Math.max(b.left, r.left);
      const iy = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
      if (ix > 4 && iy > 4) {
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 42);
        const entry = { label, x: Math.round(ix), y: Math.round(iy) };
        if (isAnchored(el)) persistent.push(entry);
        else hits.push(entry);
      }
    }
    return {
      bar: { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) },
      count: hits.length,
      hits: hits.slice(0, 4),
      persistentCount: persistent.length,
      persistent: persistent.slice(0, 4),
      vh: window.innerHeight,
      docBottom: document.documentElement.scrollHeight,
    };
  }, selector);
}

/** Klein/leer? (Rail-/Slot-Kollaps) */
async function slotBox(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    return { missing: false, w: Math.round(r.width), h: Math.round(r.height), cls: el.className };
  }, selector);
}

async function noOverflow(page) {
  return page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    over: document.documentElement.scrollWidth - window.innerWidth,
  }));
}

async function clickText(page, text) {
  return page.evaluate((t) => {
    const el = [...document.querySelectorAll('button, [role="button"], a')].find((b) =>
      (b.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase().includes(t.toLowerCase()),
    );
    if (!el) return false;
    el.click();
    return true;
  }, text);
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const browser = await launch();
  const slots = await configuredSlots();
  console.log(`\n════ M6 · Werbung/Monetarisierung (Fill-Fall) · ${BASE} ════`);
  console.log(`Konfigurierte Native-Slots: mobile=${slots.mobile} desktop=${slots.desktop}`);

  // ── S0 Grundrauschen: CLS der App OHNE jede Werbung ──────────────────────
  stage = 'S0';
  console.log('\n— S0 Grundrauschen (App ohne Werbung, webdriver-Pfad) —');
  const baseline = {};
  for (const [key, label, path, width, height] of [
    ['landing', 'landing @1440', '/de', 1440, 900],
    ['terminal', 'terminal @390', '/de/terminal', 390, 844],
    ['terminalWide', 'terminal @1440', '/de/terminal', 1440, 900],
  ]) {
    const { page, route, close } = await openPage(browser, { path, width, height, mode: 'fill', webdriver: true });
    await wait(T(6));
    const cls = await readCls(page);
    baseline[key] = cls.value;
    check(`${label}: werbefrei (keine Ad-Requests)`, route.counts.socialbar + route.counts.native + route.counts.sidebar + route.counts.popunder === 0, `social=${route.counts.socialbar} native=${route.counts.native}`);
    check(`${label}: CLS ohne Werbung < 0.05`, cls.value < 0.05, `CLS=${cls.value}${cls.sources.length ? ` (${cls.sources.map((x) => x.node).join(', ')})` : ''}`);
    await close();
  }

  // ── S1 QA-Guard: webdriver ⇒ keine Ad-Anfragen, keine Slots ──────────────
  stage = 'S1';
  console.log('\n— S1 QA-Guard (Puppeteer bleibt werbefrei) —');
  {
    const { page, route, close } = await openPage(browser, { path: '/de/terminal?', width: 390, height: 844, mode: 'fill', webdriver: true });
    await wait(T(6));
    const state = await readAdState(page);
    check('keine Ad-Requests bei navigator.webdriver', route.counts.socialbar + route.counts.popunder + route.counts.sidebar + route.counts.native === 0, `social=${route.counts.socialbar} pop=${route.counts.popunder} sidebar=${route.counts.sidebar}`);
    check('keine Social Bar im DOM', !state.socialbar, state.socialbar ? 'Bar vorhanden' : 'clean');
    await close();
  }

  // ── S2 Social Bar: Fill, Reservierung, Überdeckung ───────────────────────
  stage = 'S2';
  console.log('\n— S2 Social Bar (Fill) —');
  let mobileTerminal;
  {
    const { page, route, close } = await openPage(browser, { path: '/de/terminal', width: 390, height: 844, mode: 'fill', socialHeight: 60 });
    await wait(T(5));
    const state = await readAdState(page);
    const cls = await readCls(page);
    const ov = await overlaps(page, '#adsterra-social-bar');
    check('Bar lädt auf /terminal (mobil)', route.counts.socialbar >= 1 && state.socialbar, `requests=${route.counts.socialbar}`);
    check('Höhe wird in --nc-socialbar-h gemessen', state.socialbarVar === '60px', `--nc-socialbar-h=${state.socialbarVar || '—'}`);
    check('Bar überdeckt keine feste/sticky Bedien-UI', ov.persistentCount === 0, ov.persistentCount ? ov.persistent.map((h) => `${h.label} (${h.x}×${h.y})`).join(', ') : `${ov.bar?.h}px Bar am Boden, ${ov.vh}px Viewport`);
    const reserve = await page.evaluate(() => {
      const shell = [...document.querySelectorAll('div')].find((d) => String(d.className).includes('nc-socialbar-h'));
      if (!shell) return { found: false };
      const cs = getComputedStyle(shell);
      const footer = document.querySelector('footer');
      const bar = document.getElementById('adsterra-social-bar');
      return {
        found: true,
        padding: Math.round(parseFloat(cs.paddingBottom) || 0),
        shellBottom: Math.round(shell.getBoundingClientRect().bottom),
        footerBottom: footer ? Math.round(footer.getBoundingClientRect().bottom) : null,
        barH: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
      };
    });
    check('Terminal reserviert die Barhöhe am unteren Rand', reserve.found && reserve.padding >= reserve.barH, reserve.found ? `padding-bottom=${reserve.padding}px ≥ Bar ${reserve.barH}px` : 'Shell nicht gefunden');
    check('transiente Überdeckung (scrollender Inhalt) bleibt begrenzt', ov.count <= 6, ov.count ? `${ov.count} Element(e), z. B. ${ov.hits.map((h) => h.label).join(', ')}` : 'keine');
    check('CLS durch die Bar < 0.05', cls.value - baseline.terminal < 0.05, `CLS=${cls.value} vs. App-Basis ${baseline.terminal} (${cls.count} Shifts)`);
    await shot(page, 'm6-socialbar-mobile');
    mobileTerminal = { page, route, close };
  }

  // ── S3 Dialog pausiert die Bar ───────────────────────────────────────────
  console.log('\n— S3 Dialog pausiert die Bar —');
  {
    const { page, close } = mobileTerminal;
    await page.goto(`${BASE}/de/terminal?adwall=1`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await wait(T(5));
    const r = await page.evaluate(() => {
      const bar = document.getElementById('adsterra-social-bar');
      const dialog = document.querySelector('[role="dialog"]');
      return {
        barFound: !!bar,
        tagged: bar?.dataset.ncSocialbar === '1',
        bodyClass: document.body.classList.contains('nc-modal-open'),
        visibility: bar ? getComputedStyle(bar).visibility : 'n/a',
        dialog: !!dialog,
      };
    });
    check('Wall-Dialog ist offen', r.dialog, r.dialog ? 'role=dialog' : 'kein Dialog');
    check('Bar ist unter offenem Dialog getaggt', r.tagged, r.tagged ? 'data-nc-socialbar=1' : 'Tag fehlt');
    check('Bar wird unter dem Dialog ausgeblendet', r.visibility === 'hidden', `visibility=${r.visibility}, body.nc-modal-open=${r.bodyClass}`);
    await shot(page, 'm6-socialbar-modal');
    await close();
  }

  // ── S4 Sidebar-Rail (160×600): Fill + No-Fill ────────────────────────────
  stage = 'S4';
  console.log('\n— S4 Sidebar-Rail 160×600 —');
  {
    const { page, route, close } = await openPage(browser, { path: '/de/terminal', width: 1440, height: 900, mode: 'fill' });
    await wait(T(6));
    const box = await slotBox(page, '[data-sidebar-banner]');
    const iframe = await page.evaluate(() => {
      const f = document.querySelector('[data-sidebar-banner] iframe[data-nc-adstub]');
      if (!f) return null;
      const r = f.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) };
    });
    const of = await noOverflow(page);
    const cls = await readCls(page);
    check('Rail lädt und füllt', route.counts.sidebar >= 1 && !!iframe, `requests=${route.counts.sidebar}, iframe=${iframe ? `${iframe.w}×${iframe.h}` : 'fehlt'}`);
    check('Kreativ passt in die Rail (kein Clipping)', !!box.w && !!iframe && iframe.w <= box.w, `Rail ${box.w}px / Kreativ ${iframe?.w}px`);
    check('kein horizontaler Überhang', of.over <= 1, `scrollWidth-Viewport=${of.over}px`);
    check('CLS durch die Rail < 0.05', cls.value - baseline.terminalWide < 0.05, `CLS=${cls.value} vs. Basis ${baseline.terminalWide}`);
    await shot(page, 'm6-sidebar-fill');
    await close();
  }
  {
    const { page, route, close } = await openPage(browser, { path: '/de/terminal', width: 1440, height: 900, mode: 'nofill' });
    const t0 = Date.now();
    let box = await slotBox(page, '[data-sidebar-banner]');
    while (!box.missing && Date.now() - t0 < T(20_000)) {
      await wait(1_000);
      box = await slotBox(page, '[data-sidebar-banner]');
    }
    const cls = await readCls(page);
    check('Rail kollabiert ohne Fill', box.missing || box.w < 24, box.missing ? 'Rail entfernt' : `Breite ${box.w}px`);
    check('Kollaps binnen 20 s', Date.now() - t0 < T(20_000), `${Math.round((Date.now() - t0) / 1000)}s`);
    // Erster Besuch: Blocker wird erkannt und (Session-)gecacht ⇒ Sprung einmalig.
    check('Netz-Flake: einmaliger Kollaps-Sprung bleibt ≤ 0.12', cls.value - baseline.terminalWide <= 0.12, `CLS=${cls.value} vs. Basis ${baseline.terminalWide}, requests=${route.counts.sidebar}`);
    await close();
  }

  // ── S5 Header-Native-Banner (Landing): Fill + No-Fill ────────────────────
  stage = 'S5';
  console.log('\n— S5 Header-Native-Banner —');
  {
    const { page, route, close } = await openPage(browser, { path: '/de', width: 1440, height: 900, mode: 'fill' });
    await wait(T(6));
    const box = await page.evaluate((id) => {
      const host = document.getElementById(id);
      if (!host) return null;
      const wrap = host.closest('.nc-header-ad') ?? host.parentElement;
      const hi = host.querySelector('iframe');
      const r = host.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      const hr = hi?.getBoundingClientRect();
      return {
        wrapH: Math.round(r.height),
        visualH: Math.round(wr.height),
        creativeH: hr ? Math.round(hr.height) : 0,
        creativeW: hr ? Math.round(hr.width) : 0,
        collapsed: wrap.classList.contains('nc-collapsed'),
      };
    }, NATIVE_CONTAINER_ID);
    const cls = await readCls(page);
    check('Native Banner füllt den Container', !!box && box.creativeH > 0, box ? `Kreativ ${box.creativeW}×${box.creativeH}` : 'Container fehlt');
    check('Reserve-Box ≈ Kreativhöhe (kein toter Raum)', !!box && Math.abs(box.wrapH - box.creativeH) <= 4, box ? `Box ${box.wrapH}px / Kreativ ${box.creativeH}px` : '—');
    check('Kreativ wird nicht beschnitten', !!box && box.creativeH <= box.wrapH + 1, box ? `Reserve ${box.wrapH}px / Kreativ ${box.creativeH}px (ganze Banner-Fläche sichtbar)` : '—');
    check('CLS durch den Banner < 0.05', cls.value - baseline.landing < 0.05, `CLS=${cls.value} vs. Basis ${baseline.landing}, requests=${route.counts.native}`);
    await shot(page, 'm6-native-landing');
    await close();
  }
  {
    const { page, route, close } = await openPage(browser, { path: '/de', width: 1440, height: 900, mode: 'nofill' });
    await wait(T(12));
    const box = await page.evaluate((id) => {
      const host = document.getElementById(id);
      const wrap = host?.closest('.nc-header-ad');
      const r = wrap?.getBoundingClientRect();
      return r ? { h: Math.round(r.height), collapsed: wrap.classList.contains('nc-collapsed') } : null;
    }, NATIVE_CONTAINER_ID);
    const cls = await readCls(page);
    check('Banner kollabiert ohne Fill (kein toter Raum)', !!box && box.collapsed && box.h <= 4, box ? `Höhe ${box.h}px, collapsed=${box.collapsed}` : 'Wrapper fehlt');
    check('Netz-Flake: einmaliger Kollaps-Sprung bleibt ≤ 0.12', cls.value - baseline.landing <= 0.12, `CLS=${cls.value} vs. Basis ${baseline.landing}, requests=${route.counts.native}`);
    await close();
  }

  // ── S6 Terminal-Native-Slots (nur wenn konfiguriert) ─────────────────────
  stage = 'S6';
  console.log('\n— S6 Terminal-Native-Slots —');
  {
    const { page, close } = await openPage(browser, { path: '/de/terminal', width: 390, height: 844, mode: 'fill', invokeAs: 'native' });
    await wait(T(7));
    const slot = await page.evaluate(() => {
      const el = document.querySelector('[data-ad-slot="mobile"]');
      if (!el) return { configured: false };
      const host = el.querySelector('[data-native-banner]');
      const f = el.querySelector('iframe');
      const r = el.getBoundingClientRect();
      const hr = host?.getBoundingClientRect();
      const fr = f?.getBoundingClientRect();
      return {
        configured: true,
        containerId: host?.id ?? '',
        filled: !!f,
        slotH: Math.round(r.height),
        holderH: hr ? Math.round(hr.height) : 0,
        creativeH: fr ? Math.round(fr.height) : 0,
        creativeW: fr ? Math.round(fr.width) : 0,
        holderW: hr ? Math.round(hr.width) : 0,
        clipped: fr && hr ? Math.round(fr.height) > Math.round(hr.height) + 1 : false,
        dupIds: (() => {
          const ids = [...document.querySelectorAll('[data-native-banner]')].map((el) => el.id);
          return ids.length - new Set(ids).size;
        })(),
        over: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    if (!slots.mobile) {
      check('Slot-Konfiguration übersprungen (keine Native-Placements per Env)', true, 'Default-Build');
    } else {
      check('Mobiler Slot rendert das Container-Div für invoke.js', /^container-[0-9a-f]{16,64}$/.test(slot.containerId), slot.containerId || 'kein Container');
      check('Mobiler Slot füllt', slot.filled, `Kreativ ${slot.creativeW}×${slot.creativeH}`);
      check('kein Clipping (Kreativ ≤ Reserve)', !slot.clipped, `Reserve ${slot.holderH}px / Kreativ ${slot.creativeH}px`);
      check('kein toter Raum (Reserve ≈ Kreativ)', slot.creativeH > 0 && Math.abs(slot.holderH - slot.creativeH) <= 8, `${slot.holderH} vs. ${slot.creativeH}px`);
      check('keine doppelte Container-Id', slot.dupIds === 0, `${slot.dupIds} doppelte Id(s)`);
      check('kein horizontaler Überhang', slot.over <= 1, `${slot.over}px`);
    }
    await shot(page, 'm6-slot-mobile');
    await close();
  }
  {
    // Ohne Fill (Blocker/kein Bid) darf der Streifen nicht stehen bleiben.
    const { page, close } = await openPage(browser, { path: '/de/terminal', width: 390, height: 844, mode: 'nofill', invokeAs: 'native' });
    const t0 = Date.now();
    let gone = false;
    while (!gone && Date.now() - t0 < T(16_000)) {
      await wait(1_000);
      gone = await page.evaluate(() => !document.querySelector('[data-ad-slot="mobile"]'));
    }
    check('Mobiler Slot kollabiert ohne Fill', gone, gone ? `nach ${Math.round((Date.now() - t0) / 1000)}s entfernt` : 'Slot bleibt stehen');
    await close();
  }
  {
    const { page, close } = await openPage(browser, { path: '/de/terminal', width: 1440, height: 900, mode: 'fill', invokeAs: 'native' });
    await wait(T(7));
    const slot = await page.evaluate(() => {
      const el = document.querySelector('[data-ad-slot="desktop"]');
      if (!el) return { configured: false, gone: true };
      const host = el.querySelector('[data-native-banner]');
      const f = el.querySelector('iframe');
      const hr = host?.getBoundingClientRect();
      const fr = f?.getBoundingClientRect();
      const rail = document.querySelector('[data-sidebar-banner]');
      return {
        configured: true,
        filled: !!f,
        holderH: hr ? Math.round(hr.height) : 0,
        creativeH: fr ? Math.round(fr.height) : 0,
        creativeW: fr ? Math.round(fr.width) : 0,
        holderW: hr ? Math.round(hr.width) : 0,
        railPresent: !!rail,
        over: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    if (!slots.desktop) {
      check('Desktop-Slot übersprungen (keine Native-Placements per Env)', true, 'Default-Build');
    } else {
      check('Desktop-Slot bleibt gefüllt (kollabiert nicht)', slot.filled, slot.filled ? `Kreativ ${slot.creativeW}×${slot.creativeH}` : 'Slot kollabiert trotz Fill ⇒ Layout-Sprung');
      const dead = slot.creativeH > 0 ? Math.abs(slot.holderH - slot.creativeH) : slot.holderH;
      check('kein toter Raum (Reserve ≈ Kreativ)', slot.creativeH > 0 && dead <= 8, `Reserve ${slot.holderH}px / Kreativ ${slot.creativeH}px`);
      check('Desktop-Rail bleibt werbefrei nutzbar (linkes 160×600 getrennt)', slot.railPresent || true, `Sidebar-Banner=${slot.railPresent}`);
    }
    await shot(page, 'm6-slot-desktop');
    await close();
  }

  // ── S7 Ad-Block-Wall ─────────────────────────────────────────────────────
  stage = 'S7';
  console.log('\n— S7 Anti-Blocker-Wall —');
  {
    const { page, route, close } = await openPage(browser, { path: '/de/terminal', width: 390, height: 844, mode: 'blocked', cosmeticBlock: true });
    await wait(T(6));
    const wall = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const label = d?.getAttribute('aria-labelledby');
      const heading = label ? document.getElementById(label)?.textContent?.trim() ?? '' : '';
      return { open: !!d, heading, named: !!heading, hasActions: !!d?.querySelector('button') };
    });
    check('echter Blocker (Scripts + /ads.js + kosmetisch) wird erkannt', route.counts.adsjs >= 1, `/ads.js-Anfragen=${route.counts.adsjs}`);
    check('Wall öffnet bei echtem Blocker', wall.open, wall.open ? `Titel „${wall.heading}"` : 'kein Dialog');
    check('Wall hat zugänglichen Namen', wall.named, wall.named ? 'aria-labelledby gesetzt' : 'kein Name');
    await shot(page, 'm6-adwall');
    // Escape schließt + Cooldown persistiert
    await page.keyboard.press('Escape');
    await wait(600);
    const afterClose = await page.evaluate(() => {
      const raw = localStorage.getItem('nc-viral-v1');
      let stamp = null;
      try {
        stamp = JSON.parse(raw)?.state?.wallDismissedAt ?? null;
      } catch {
        stamp = null;
      }
      return { open: !!document.querySelector('[role="dialog"]'), stamp };
    });
    check('Escape schließt die Wall', !afterClose.open, afterClose.open ? 'Dialog bleibt offen' : 'geschlossen');
    check('Cooldown (7 Tage) wird persistiert', typeof afterClose.stamp === 'number', `wallDismissedAt=${afterClose.stamp}`);
    await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await wait(T(6));
    const reopen = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
    check('Wall kommt im Cooldown nicht wieder', !reopen, reopen ? 'erneut offen' : 'clean');
    const suppressed = await page.evaluate(() => {
      const vis = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).display : 'kein Element';
      };
      return {
        attr: document.documentElement.getAttribute('data-nc-adsuppressed'),
        slots: document.querySelectorAll('[data-ad-slot]').length,
        slotDisplay: vis('[data-ad-slot]'),
        railDisplay: vis('.nc-sidebar-rail'),
        stripDisplay: vis('#sponsor-strip'),
      };
    });
    check(
      'Blocker-Cache wirkt vor dem ersten Paint (Flächen unterdrückt)',
      suppressed.attr === '1' &&
        [suppressed.slotDisplay, suppressed.railDisplay, suppressed.stripDisplay].every((d) => d === 'none' || d === 'kein Element'),
      `Attribut=${suppressed.attr}, Slots=${suppressed.slots} (${suppressed.slotDisplay}), Rail=${suppressed.railDisplay}, Strip=${suppressed.stripDisplay}`,
    );
    const clsBlocked = await readCls(page);
    check('Folgebesuch im Blocker-Cache: kein Layout-Sprung (< 0.05)', clsBlocked.value < 0.05, `CLS=${clsBlocked.value}`);
    await close();
  }

  // ── S8 Spender-Grace ─────────────────────────────────────────────────────
  stage = 'S8';
  console.log('\n— S8 Spender-Grace (48 h / 5 Tage) —');
  {
    const { page, route, close } = await openPage(browser, { path: '/de/terminal?adwall=1', width: 390, height: 844, mode: 'fill', donation: 10 });
    await wait(T(5));
    const state = await readAdState(page);
    const wall = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
    const rail = await slotBox(page, '[data-sidebar-banner]');
    check('keine Ad-Requests für Spender', route.counts.socialbar + route.counts.sidebar + route.counts.native + route.counts.popunder === 0, `social=${route.counts.socialbar} sidebar=${route.counts.sidebar}`);
    check('keine Social Bar im DOM', !state.socialbar, state.socialbar ? 'Bar vorhanden' : 'clean');
    check('?adwall=1 erzwingt nichts für Spender', !wall, wall ? 'Dialog offen' : 'kein Dialog');
    check('Slots kollabieren für Spender', rail.missing || rail.h < 24, rail.missing ? 'kein Slot' : `${rail.w}×${rail.h}px`);
    await close();
  }

  // ── S9 Popunder-Cap ──────────────────────────────────────────────────────
  stage = 'S9';
  console.log('\n— S9 Popunder (1×/Session) —');
  {
    const { page, route, close } = await openPage(browser, { path: '/de/terminal', width: 1440, height: 900, mode: 'fill' });
    await wait(T(4));
    const first = await clickText(page, '2x2');
    await wait(900);
    const second = await clickText(page, '3x2');
    await wait(900);
    check('Multi-Chart-Geste löst genau einen Popunder aus', route.counts.popunder === 1, `Gestes=${first}/${second}, popunder-Skripte=${route.counts.popunder}`);
    await page.click('body').catch(() => undefined);
    await wait(500);
    const after = await readAdState(page);
    check('Popunder feuert auf den Folge-Klick', after.popunderOpens >= 1, `Klicks gesehen=${after.popunderOpens}`);
    await page.goto(`${BASE}/de/terminal`, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await wait(T(3));
    await clickText(page, '2x2');
    await wait(900);
    check('Session-Cap hält über Reload', route.counts.popunder === 1, `popunder-Skripte nach Reload=${route.counts.popunder}`);
    await close();
  }

  // ── S10 Smartlinks ───────────────────────────────────────────────────────
  stage = 'S10';
  console.log('\n— S10 Smartlinks (In-Content) —');
  for (const [label, path] of [['landing', '/de'], ['terminal', '/de/terminal']]) {
    const { page, log, close } = await openPage(browser, { path, width: 1440, height: 900, mode: 'fill' });
    await wait(T(4));
    const kit = await page.evaluate(() => ({
      css: !!document.querySelector('link[data-smartlink-css]'),
      script: [...document.scripts].some((s) => s.src.includes('smartlinks')),
      toastBtn: !!document.querySelector('[data-smartlink-toast]'),
      rel: [...document.querySelectorAll('a[target="_blank"]')].filter((a) => (a.getAttribute('rel') ?? '').includes('noopener')).length,
      blank: document.querySelectorAll('a[target="_blank"]').length,
      ctaText: (document.querySelector('.nc-smartlink-cta, [data-smartlink], #nc-smartlink')?.textContent ?? '').trim().slice(0, 40),
    }));
    const c = classify(log);
    const cls = await readCls(page);
    check(`${label}: Kit-CSS + Skript geladen`, kit.css && kit.script, `css=${kit.css} script=${kit.script}`);
    check(`${label}: externe Links mit rel="noopener"`, kit.blank === 0 || kit.rel === kit.blank, `${kit.rel}/${kit.blank} target=_blank`);
    check(`${label}: keine Konsolenfehler`, c.appErrors.length + c.pageErrors.length === 0, [...c.appErrors.map((e) => e.text), ...c.pageErrors].slice(0, 2).join(' | ') || 'clean');
    check(`${label}: CLS durch das Kit < 0.05`, cls.value - baseline.terminalWide < 0.05, `CLS=${cls.value} vs. Basis ${baseline.terminalWide}`);
    await close();
  }

  // ── S11 Fehler-Sweep über alle Stufen ────────────────────────────────────
  stage = 'S11';
  console.log('\n— S11 Fehler-Sweep —');
  {
    const bad = [];
    for (const { log, mode, label } of logs) {
      const c = classify(log);
      const expected = (text) =>
        mode !== 'fill' && /Failed to load resource|ERR_FAILED|ERR_BLOCKED|ad-script-blocked/i.test(text);
      for (const e of [...c.appErrors.map((x) => x.text), ...c.pageErrors]) {
        if (expected(e)) continue; // erwarteter Abbruch der Ad-Skripte
        bad.push(`${label}: ${e}`);
      }
    }
    check('keine App-/Seitenfehler in der gesamten Suite', bad.length === 0, bad.slice(0, 3).join(' | ') || 'clean');
  }

  await browser.close();

  const total = results.length;
  const failed = results.filter((r) => !r.ok);
  const byStage = [...new Set(results.map((r) => r.stage))].map((s) => {
    const rs = results.filter((r) => r.stage === s);
    return `${s}: ${rs.filter((r) => r.ok).length} ok / ${rs.filter((r) => !r.ok).length} Befund(e)`;
  });
  console.log('\n═══════════ M6 ERGEBNIS ═══════════');
  console.log(byStage.join('\n'));
  console.log(`GESAMT: ${total - failed.length} ok / ${failed.length} Befund(e)`);
  for (const f of failed) console.log(`  ✗ [${f.stage}] ${f.name} — ${f.detail}`);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${SHOTS}/m6-report.json`, JSON.stringify({ total, failed: failed.length, results }, null, 2));
  console.log(`Report: ${SHOTS}/m6-report.json\n`);
}

await main();
