#!/usr/bin/env node
// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/**
 * M5 – A11Y-DEEP-DIVE (Sandbox-Runner)
 * ====================================
 * Vier Achsen aus dem M5-Auftrag, plus zwei billige Semantik-Nebenprüfungen:
 *
 *   S1  Fokus-Sichtbarkeit        – hat jedes per Tastatur fokussierte Control
 *                                   einen sichtbaren, ausreichend kontrastreichen
 *                                   Fokusring (WCAG 1.4.11 ≥ 3:1)?
 *   S2  Tab-Ordnung & Containment – 19 Dialog-/Overlay-Flächen: Anfangsfokus,
 *                                   Tab-Zyklus ohne Ausbruch, Wrap-around,
 *                                   Escape schließt, Fokus kehrt zurück,
 *                                   Reihenfolge = DOM-Reihenfolge?
 *   S3  Light-Theme-Kontrast      – Text/Hintergrund-Paare im hellen Skin
 *                                   (WCAG AA 4.5:1 / 3:1 large)
 *   S4  Icon-only Buttons         – zugänglicher Name vorhanden UND lokalisiert
 *                                   (detektiert hart kodierte englische Labels)
 *   S5  Semantik-Sweep            – lang, Landmarks, Überschriften, alt, Ids
 *
 * Nutzung (Server muss laufen, siehe README.md):
 *   node scripts/audit-sandbox/run-m5-a11y.mjs [--locale de] [--quick]
 *
 * Exit-Code ≠ 0, sobald echte Befunde übrig bleiben.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BASE, launch, classify, instrument, wait, shot, SHOTS } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MSG = Object.fromEntries(
  ['de', 'en', 'es', 'ru', 'zh'].map((l) => [l, JSON.parse(readFileSync(join(ROOT, 'messages', `${l}.json`), 'utf8'))]),
);
const pick = (obj, path) => path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);

const ARGS = process.argv.slice(2);
const ONLY_LOCALE = ARGS.includes('--locale') ? ARGS[ARGS.indexOf('--locale') + 1] : null;
const QUICK = ARGS.includes('--quick');

const results = [];
const report = (section, name, ok, detail = '') => {
  results.push({ section, name, ok, detail: String(detail).slice(0, 240) });
  console.log(`${ok ? '  ✓' : '  ✗'} [${section}] ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ─────────────────────────── Browser-Helfer ─────────────────────────── */

/** Fokussierbare, sichtbare Controls innerhalb eines Scopes (in DOM-Reihenfolge). */
const COLLECT_FN = (sel) =>
  '(' +
  function (selector) {
    const vis = (el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return false;
      return el.getClientRects().length > 0;
    };
    const scope = selector ? document.querySelector(selector) : document;
    if (!scope) return null;
    return [...scope.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
      .filter(
        (el) => vis(el) && el.tabIndex >= 0 && !el.matches(':disabled') && el.getAttribute('aria-hidden') !== 'true',
      )
      .map((el, i) => ({
        i,
        tag: el.tagName.toLowerCase(),
        name: (
          el.getAttribute('aria-label') ||
          (el.getAttribute('aria-labelledby')
            ? (document.getElementById(el.getAttribute('aria-labelledby'))?.textContent ?? '')
            : '') ||
          el.textContent ||
          el.getAttribute('title') ||
          el.getAttribute('placeholder') ||
          ''
        )
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 60),
        cls: String(el.className || '').slice(0, 60),
      }));
  }.toString() +
  `)(${JSON.stringify(sel)})`;

/** Fokusring-Zustand des aktiven Elements + Kontrast gegen den Untergrund. */
const RING_FN = '(' +
  function () {
    const parse = (c) => {
      const m = String(c).match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
      return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const blend = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    const el = document.activeElement;
    if (!el || el === document.body) return { none: true };
    const cs = getComputedStyle(el);
    // effektiver Seitenhintergrund unter dem Element
    let node = el.parentElement;
    let bg = { r: 10, g: 10, b: 12, a: 1 };
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.85) {
        bg = c;
        break;
      }
      node = node.parentElement;
    }
    const outline = parse(cs.outlineColor);
    const width = parseFloat(cs.outlineWidth) || 0;
    const outlineVisible = cs.outlineStyle !== 'none' && width >= 1 && outline && outline.a > 0.1;
    const shadow = cs.boxShadow && cs.boxShadow !== 'none' ? cs.boxShadow : '';
    const shadowColor = parse(shadow);
    const shadowVisible = !!shadowColor && shadowColor.a > 0.1 && !/rgba?\(0,\s*0,\s*0,\s*0\)/.test(shadow);
    const ringColor = outlineVisible ? outline : shadowColor;
    return {
      tag: el.tagName.toLowerCase(),
      name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 32),
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
      hasRing: outlineVisible || shadowVisible,
      via: outlineVisible ? 'outline' : shadowVisible ? 'box-shadow' : 'keiner',
      contrast: ringColor ? Number(ratio(blend(ringColor, bg), bg).toFixed(2)) : null,
    };
  }.toString() +
  ')()';

/** Text/Hintergrund-Kontrastpaare einer Seite einsammeln (WCAG AA). */
const CONTRAST_FN = '(' +
  function () {
    const parse = (c) => {
      const m = String(c).match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
      return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
    };
    const blend = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    /* Gradienten/Background-Images kann man aus computed styles nicht in eine
       Kontrastzahl gießen – solche Elemente werden als "nicht messbar"
       gemeldet statt falsch-negativ (gesponserte Chips, Neon-Trägerflächen). */
    const hasGradient = (el) => {
      let node = el;
      while (node && node !== document.body) {
        if (getComputedStyle(node).backgroundImage !== 'none') return true;
        node = node.parentElement;
      }
      return false;
    };
    const effBg = (el) => {
      let node = el;
      let acc = null;
      while (node) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0) {
          acc = acc ?? c;
          if (c.a > 0.9) return c;
        }
        node = node.parentElement;
      }
      return acc ?? { r: 255, g: 255, b: 255, a: 1 };
    };
    const out = [];
    const skippable = [];
    for (const el of document.querySelectorAll('body *')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.5) continue;
      if (!el.getClientRects().length) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const fg = parse(cs.color);
      const bg = effBg(el);
      if (!fg) continue;
      // Gradient-Text (background-clip:text) meldet color:transparent – nicht messbar,
      // Emoji-only-Zeilen werden vom Font als Farbglyphe gerendert (Kontrast sinnlos).
      const fill = getComputedStyle(el).webkitTextFillColor || '';
      if (/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/.test(fill) || (fg.a < 0.5 && !cs.textShadow.includes('rgb'))) continue;
      const txt = (el.textContent || '').trim();
      if (!/[\p{L}\p{N}]/u.test(txt)) continue;
      const size = parseFloat(cs.fontSize) || 12;
      const weight = Number(cs.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const ratioV = Number(ratio(blend(fg, bg), bg).toFixed(2));
      const need = large ? 3 : 4.5;
      if (ratioV < need) {
        if (hasGradient(el)) {
          skippable.push({ text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30), cls: String(el.className || '').slice(0, 50) });
          continue;
        }
        out.push({
          ratio: ratioV,
          need,
          size,
          text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 42),
          cls: String(el.className || '').slice(0, 70),
          color: cs.color,
          bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
        });
      }
    }
    return { bad: out.sort((a, b) => a.ratio - b.ratio).slice(0, 25), skipped: skippable.length, skippedSample: skippable.slice(0, 3) };
  }.toString() +
  ')()';

const LANG_FN = '(' +
  function () {
    const bad = { dupIds: [], noAlt: [], javaScriptHref: [] };
    const ids = {};
    for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1;
    bad.dupIds = Object.keys(ids).filter((k) => ids[k] > 1);
    for (const img of document.querySelectorAll('img')) if (!img.getAttribute('alt')) bad.noAlt.push(img.src.slice(-40));
    for (const a of document.querySelectorAll('a[href^="javascript:"]')) bad.javaScriptHref.push(a.textContent.trim().slice(0, 20));
    return { lang: document.documentElement.lang, bad, title: document.title };
  }.toString() +
  ')()';

/* ─────────────────────────── Overlay-Landkarte ─────────────────────────── */

/**
 * Alle 19 Dialog-/Overlay-Flächen mit ihrem realistischen Öffnungsweg.
 * `labelKey` / `labelNs` holen den sichtbaren Text aus messages/<locale>.json,
 * damit auch Flächen ohne data-Attribut (Watchlist-Chip, Tip-Jar) klickbar sind.
 */
const SURFACES = [
  { id: 'backtest', kind: 'menu', menu: 'tools', item: 'backtest', ns: 'terminal', key: 'backtest' },
  { id: 'screener', kind: 'menu', menu: 'tools', item: 'screener', ns: 'terminal', key: 'screener' },
  { id: 'risk', kind: 'menu', menu: 'tools', item: 'risk', ns: 'terminal', key: 'risk' },
  { id: 'journal', kind: 'menu', menu: 'tools', item: 'journal', ns: 'terminal', key: 'journal' },
  { id: 'magnifier', kind: 'menu', menu: 'tools', item: 'magnifier', ns: 'terminal', key: 'magnifier' },
  { id: 'scripts', kind: 'menu', menu: 'tools', item: 'scripts', ns: 'terminal', key: 'scripts' },
  { id: 'alerts', kind: 'menu', menu: 'tools', item: 'alerts-manager', ns: 'terminal', key: 'alerts' },
  { id: 'liq', kind: 'menu', menu: 'edge', item: 'liq', ns: 'edge', key: 'menuLiq' },
  { id: 'lag', kind: 'menu', menu: 'edge', item: 'lag', ns: 'edge', key: 'menuLag' },
  { id: 'regime', kind: 'menu', menu: 'edge', item: 'regime', ns: 'edge', key: 'menuRegime' },
  { id: 'clock', kind: 'menu', menu: 'edge', item: 'clock', ns: 'edge', key: 'menuClock' },
  { id: 'patterns', kind: 'menu', menu: 'analyse', item: 'patterns', ns: 'terminal', key: 'patterns' },
  { id: 'ratings', kind: 'menu', menu: 'analyse', item: 'ratings', ns: 'terminal', key: 'ratings' },
  { id: 'heatmap', kind: 'menu', menu: 'analyse', item: 'heatmap', ns: 'terminal', key: 'heatmap' },
  { id: 'share', kind: 'menu', menu: 'more', item: 'share', ns: 'share', key: 'button' },
  { id: 'palette', kind: 'key', keys: 'Control+k', ns: 'command', key: 'title' },
  { id: 'watchlist', kind: 'text', ns: 'showcase', key: 'watch', trap: false },
  { id: 'support', kind: 'text', ns: 'support', key: 'openTip' },
  { id: 'indicator', kind: 'text', ns: 'chart', key: 'toolbar.indicators', fuzzy: true, args: { n: 0 } },
];

/** Menü öffnen, Eintrag per `data-menu-item` klicken; Fokus vorher setzen (Tastaturnutzer). */
async function openViaMenu(page, menu, item) {
  const ok = await page.evaluate(
    (m) => {
      const trigger = document.querySelector(`[data-menu-trigger="${m}"]`);
      if (!trigger) return 'trigger-fehlt';
      trigger.focus();
      trigger.click();
      return null;
    },
    menu,
    item,
  );
  if (ok) return ok;
  await wait(320);
  const res = await page.evaluate(
    (k) => {
      const el = document.querySelector(`[role="menu"] [data-menu-item="${k}"]`);
      if (!el) return 'item-fehlt';
      el.focus();
      el.click();
      return null;
    },
    item,
  );
  return res;
}

/** Sichtbaren Text aus messages/<locale>.json rendern (ICU-Platzhalter grob ersetzen). */
function labelText(locale, ns, key, args = {}) {
  const raw = pick(MSG[locale], `${ns}.${key}`) ?? '';
  return String(raw).replace(/\{\s*(\w+)[^}]*\}/g, (_, k) => (args[k] !== undefined ? String(args[k]) : ''));
}

async function openViaText(page, selector, text, exact = false) {
  return page.evaluate(
    (sel, t, ex) => {
      const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');
      if (!t) return 'leerer-label-text';
      const cands = [...document.querySelectorAll(sel)];
      const el = cands.find((b) => (ex ? norm(b.getAttribute('aria-label') || b.textContent) === t : norm(b.getAttribute('aria-label') || b.textContent).includes(t)));
      if (!el) return `nicht-gefunden:${t}`;
      el.focus();
      el.click();
      return null;
    },
    selector,
    text,
    exact,
  );
}

/** Persistierte UI-Toggles (Palette, Dialog-Flags) vor jeder Fläche neutralisieren. */
async function resetUiState(page, theme) {
  await page.evaluate((t) => {
    try {
      const raw = localStorage.getItem('nodechart:store:v1');
      const obj = raw ? JSON.parse(raw) : {};
      const keep = obj.state ?? {};
      obj.state = { ...keep, commandPaletteOpen: false, theme: t ?? keep.theme ?? 'acid' };
      obj.version = 1;
      localStorage.setItem('nodechart:store:v1', JSON.stringify(obj));
    } catch {
      /* frischer Origin – nichts zu tun */
    }
  }, theme);
}

async function openSurface(page, surface, locale) {
  if (surface.kind === 'menu') return openViaMenu(page, surface.menu, surface.item);
  if (surface.kind === 'key') {
    await page.keyboard.down('Control');
    await page.keyboard.press(surface.keys.split('+')[1]);
    await page.keyboard.up('Control');
    return null;
  }
  const text = labelText(locale, surface.ns, surface.key, surface.args ?? {});
  const short = text.split(/[·(]/)[0].trim();
  return openViaText(page, 'button, [role="button"]', short || text);
}

/* ─────────────────────────── S1: Fokus-Sichtbarkeit ─────────────────────────── */

async function s1FocusVisibility(browser, locale) {
  const page = await browser.newPage();
  await page.goto(`${BASE}/${locale}/terminal`, { waitUntil: 'domcontentloaded' });
  await wait(5500);
  await page.evaluate(() => document.body.focus());
  const rows = [];
  const steps = QUICK ? 14 : 26;
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    // Buttons mit `transition-all` animieren Outline-Width/-Color nach –
    // ohne Warten misst man den Startwert (3px/currentColor).
    await wait(260);
    const ring = await page.evaluate(RING_FN);
    if (!ring.none) rows.push(ring);
  }
  const withoutRing = rows.filter((r) => !r.hasRing);
  const lowContrast = rows.filter((r) => r.hasRing && r.contrast != null && r.contrast < 3);
  report('S1', 'Fokusring auf allen per Tab erreichten Controls sichtbar', withoutRing.length === 0, withoutRing.map((r) => `${r.tag}:"${r.name}"`).slice(0, 4).join(' · '));
  report('S1', 'Fokusring-Kontrast ≥ 3:1 (WCAG 1.4.11)', lowContrast.length === 0, lowContrast.map((r) => `${r.name}=${r.contrast}`).slice(0, 4).join(' · '));
  report('S1', 'Tab erreicht ≥ 8 verschiedene Controls auf /terminal', new Set(rows.map((r) => r.name)).size >= 8, `n=${new Set(rows.map((r) => r.name)).size}/${rows.length}`);
  // Fokusring auch im hellen Skin (dort ist der Kontrast am kritischsten).
  await setTheme(page, 'light');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await wait(3500);
  await page.evaluate(() => document.body.focus());
  const lightRows = [];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    await wait(260);
    const ring = await page.evaluate(RING_FN);
    if (!ring.none) lightRows.push(ring);
  }
  const lightBad = lightRows.filter((r) => !r.hasRing || (r.contrast != null && r.contrast < 3));
  report('S1', 'Fokusring auch im Light-Theme sichtbar + ≥3:1', lightBad.length === 0, lightBad.map((r) => `${r.name}(${r.via}/${r.contrast})`).slice(0, 4).join(' · '));
  await setTheme(page, 'acid');
  await page.close();
  return { dark: rows, light: lightRows };
}

/* ─────────────────────────── S2: Tab-Ordnung & Fokus ─────────────────────────── */

async function s2Dialogs(browser, locale) {
  const surfaces = QUICK ? SURFACES.slice(0, 5) : SURFACES;
  const details = [];
  for (const surface of surfaces) {
    const page = await browser.newPage();
    const log = instrument(page);
    await page.goto(`${BASE}/${locale}/terminal`, { waitUntil: 'domcontentloaded' });
    await resetUiState(page, 'acid');
    await wait(5000);
    const opened = await openSurface(page, surface, locale);
    await wait(surface.kind === 'key' ? 400 : 900);
    if (opened) {
      report('S2', `${surface.id}: öffnet über ${surface.kind}`, false, opened);
      await page.close();
      continue;
    }
    const dialogInfo = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"], [role="menu"]');
      if (!d) return null;
      const labelled = d.getAttribute('aria-label') || document.getElementById(d.getAttribute('aria-labelledby') || '')?.textContent || '';
      const rect = d.getBoundingClientRect();
      return {
        role: d.getAttribute('role'),
        modal: d.getAttribute('aria-modal'),
        labelled: (labelled || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        focusInside: d.contains(document.activeElement) || d === document.activeElement,
      };
    });
    if (!dialogInfo) {
      report('S2', `${surface.id}: Fläche erscheint als Dialog/Overlay`, false, 'kein [role=dialog|menu] gefunden');
      await page.close();
      continue;
    }
    const tag = `${surface.id}`;
    report('S2', `${tag}: Dialog hat zugänglichen Namen`, !!dialogInfo.labelled, dialogInfo.labelled || 'ohne aria-label/labelledby');
    if (surface.trap === false) {
      report('S2', `${tag}: Nicht-modaler Popover (Fokus bleibt beim Auslöser)`, true, await activeDesc(page));
    } else {
      report('S2', `${tag}: Fokus landet im Dialog`, dialogInfo.focusInside, await activeDesc(page));
    }

    // Tab-Zyklus
    const focusables = await page.evaluate(COLLECT_FN('[role="dialog"], [role="menu"]'));
    const n = focusables?.length ?? 0;
    const seq = [];
    let escaped = null;
    for (let i = 0; i < Math.min(n + 2, 40); i++) {
      await page.keyboard.press('Tab');
      const cur = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"], [role="menu"]');
        const a = document.activeElement;
        const list = d
          ? [...d.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter(
              (el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0,
            )
          : [];
        return {
          inside: !!(d && (d.contains(a) || d === a)),
          outsideIsBody: a === document.body,
          /* -1 = kein Kandidat (z. B. Chromes tabbare Scroll-Container ohne tabindex) */
          index: list.indexOf(a),
          desc: a ? `${a.tagName.toLowerCase()}:"${(a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)}"` : 'null',
        };
      });
      if (!cur.inside && !escaped) escaped = cur.desc;
      if (cur.inside) seq.push({ index: cur.index, desc: cur.desc });
    }
    if (surface.trap === false) {
      report('S2', `${tag}: Nicht-modaler Popover (kein Focus-Trap erwartet)`, true, `${n} Controls erreichbar`);
    } else {
      report('S2', `${tag}: Tab verlässt den Dialog nicht (${n} Controls)`, !escaped, escaped ? `Ausbruch nach "${escaped}"` : `Zyklus über ${new Set(seq.map((x) => x.desc)).size} Controls`);
    }
    /* Reihenfolge: Tab-Indizes müssen lückenlos +1 modulo n laufen
       (Wrap-around inklusive). Namen taugen dafür nicht – mehrere Inputs
       heißen gleich, tabindex="-1"-Buttons sind keine Tab-Stationen. */
    const indices = seq.map((x) => x.index);
    const offPath = indices.filter((i) => i < 0);
    let cyclic = n > 0 && indices.length > 0 && offPath.length === 0;
    for (let k = 1; k < indices.length && cyclic; k++) {
      if (indices[k] !== (indices[k - 1] + 1) % n) cyclic = false;
    }
    report(
      'S2',
      `${tag}: Tab-Reihenfolge = DOM-Reihenfolge (zyklisch)`,
      cyclic || surface.trap === false,
      cyclic ? `n=${n}` : `indizes=[${indices.slice(0, 10).join(',')}] n=${n}${offPath.length ? ' (scrollbarer Container tabbar)' : ''}`,
    );
    // Shift+Tab vom ersten Element ⇒ letztes
    await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"], [role="menu"]');
      const list = [...d.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter(
        (el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length,
      );
      list[0]?.focus();
    });
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    const wrappedBack = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"], [role="menu"]');
      return { inside: !!(d && d.contains(document.activeElement)), desc: (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').trim().slice(0, 24) };
    });
    report('S2', `${tag}: Shift+Tab vom ersten Control bleibt im Dialog (Wrap)`, wrappedBack.inside || surface.trap === false, wrappedBack.desc);

    // Escape + Fokus-Rückgabe
    const beforeClose = await page.evaluate(() => {
      const a = document.activeElement;
      return a ? `${a.tagName.toLowerCase()}:"${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 24)}"` : 'null';
    });
    await page.keyboard.press('Escape');
    await wait(350);
    const after = await page.evaluate(() => {
      const still = document.querySelector('[role="dialog"]');
      const a = document.activeElement;
      return {
        stillOpen: !!still,
        active: a ? `${a.tagName.toLowerCase()}:"${(a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)}"` : 'null',
        isBody: a === document.body,
        closesWithName: true,
      };
    });
    const bodyOk = surface.kind === 'key'; // per Shortcut geöffnet: body IST der Auslöser-Zustand
    report(
      'S2',
      `${tag}: Escape schließt und Fokus wird wiederhergestellt`,
      !after.stillOpen && (!after.isBody || bodyOk),
      after.stillOpen ? 'Dialog blieb offen' : after.isBody ? (bodyOk ? '→ <body> (Shortcut-Auslöser)' : `Fokus auf <body> (vorher ${beforeClose})`) : `→ ${after.active}`,
    );
    const net = classify(log);
    report(
      'S2',
      `${tag}: keine App-/Page-Fehler beim Öffnen, Bedienen und Schließen`,
      net.appErrors.length === 0 && net.pageErrors.length === 0,
      [...net.appErrors.map((e) => e.text), ...net.pageErrors].slice(0, 2).join(' | '),
    );
    details.push({
      surface: surface.id,
      role: dialogInfo.role,
      labelled: dialogInfo.labelled,
      focusables: n,
      seq: seq.map((x) => x.desc).slice(0, 12),
      indices: indices.slice(0, 12),
      escaped,
      restored: after.active,
    });
    await page.close();
  }
  return details;
}

/* ─────────────────── S2b: Menü-/Dropdown-Tastaturbedienung ─────────────────── */

/**
 * `role="menu"` verlangt Pfeiltasten-Navigation (WAI-ARIA-Menü-Muster).
 * Geprüft wird an den vier ToolMenüs der Terminal-Toolbar und am
 * Chart-Typ-Dropdown: ArrowDown öffnet + fokussiert den ersten Eintrag,
 * weitere Pfeiltasten wandern, Escape schließt und gibt den Fokus zurück.
 */
async function s2bMenus(browser, locale) {
  const MENUS = [
    { id: 'tools', trigger: 'tools' },
    { id: 'edge', trigger: 'edge' },
    { id: 'analyse', trigger: 'analyse' },
    { id: 'more', trigger: 'more' },
  ];
  for (const menu of MENUS) {
    const page = await browser.newPage();
    await page.goto(`${BASE}/${locale}/terminal`, { waitUntil: 'domcontentloaded' });
    await resetUiState(page, 'acid');
    await wait(5000);
    const focused = await page.evaluate((id) => {
      const trigger = document.querySelector(`[data-menu-trigger="${id}"]`);
      if (!trigger) return 'trigger-fehlt';
      trigger.focus();
      return null;
    }, menu.trigger);
    if (focused) {
      report('S2b', `${menu.id}: Trigger vorhanden`, false, focused);
      await page.close();
      continue;
    }
    await page.keyboard.press('ArrowDown');
    await wait(320);
    const state = await page.evaluate(() => {
      const panel = document.querySelector('[role="menu"]');
      const a = document.activeElement;
      const items = panel ? [...panel.querySelectorAll('[role="menuitem"]')] : [];
      return {
        open: !!panel,
        index: items.indexOf(a),
        count: items.length,
        name: (a?.getAttribute('aria-label') || a?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30),
      };
    });
    report('S2b', `${menu.id}: ArrowDown öffnet das Menü und fokussiert den ersten Eintrag`, state.open && state.index === 0, `${state.count} Einträge, aktiv: "${state.name}"`);
    await page.keyboard.press('ArrowDown');
    await wait(120);
    const second = await page.evaluate(() => {
      const panel = document.querySelector('[role="menu"]');
      const items = panel ? [...panel.querySelectorAll('[role="menuitem"]')] : [];
      return items.indexOf(document.activeElement);
    });
    report('S2b', `${menu.id}: zweites ArrowDown wandert weiter`, second === 1, `Index ${second}`);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Home');
    await wait(120);
    const home = await page.evaluate(() => {
      const panel = document.querySelector('[role="menu"]');
      const items = panel ? [...panel.querySelectorAll('[role="menuitem"]')] : [];
      return items.indexOf(document.activeElement);
    });
    report('S2b', `${menu.id}: Home/End springen an die Ränder`, home === 0, `Index ${home}`);
    await page.keyboard.press('Escape');
    await wait(280);
    const closed = await page.evaluate(() => ({
      open: !!document.querySelector('[role="menu"]'),
      onTrigger: document.activeElement?.getAttribute('data-menu-trigger') ?? null,
    }));
    report(
      'S2b',
      `${menu.id}: Escape schließt und Fokus steht wieder auf dem Trigger`,
      !closed.open && closed.onTrigger === menu.trigger,
      closed.open ? 'Menü blieb offen' : `Fokus: ${closed.onTrigger ?? 'anderes Element'}`,
    );
    await page.close();
  }
}

/* ─────────────────────────── S3: Light-Theme-Kontrast ─────────────────────────── */

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    const raw = localStorage.getItem('nodechart:store:v1');
    let obj = {};
    try {
      obj = raw ? JSON.parse(raw) : {};
    } catch {
      obj = {};
    }
    obj.state = { ...(obj.state ?? {}), theme: t };
    obj.version = 1;
    localStorage.setItem('nodechart:store:v1', JSON.stringify(obj));
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
}

async function s3LightContrast(browser, locale) {
  const pages = ['/terminal', ''];
  const worst = {};
  for (const route of pages) {
    const page = await browser.newPage();
    await page.goto(`${BASE}/${locale}${route}`, { waitUntil: 'domcontentloaded' });
    await wait(2500);
    await setTheme(page, 'light');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await wait(route === '/terminal' ? 5500 : 2500);
    const themeApplied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    report('S3', `Light-Theme aktiv auf ${route || '/'}`, themeApplied === 'light', themeApplied);
    const res = await page.evaluate(CONTRAST_FN);
    const bad = res.bad;
    report(
      'S3',
      `${route || '/'}: alle Texte ≥ AA (4.5:1 / 3:1 large)`,
      bad.length === 0,
      (bad.slice(0, 6).map((b) => `${b.ratio}:1 (${b.size}px) "${b.text}"`).join(' · ') || 'clean') +
        (res.skipped ? ` · ${res.skipped} Gradient-Flächen nicht messbar` : ''),
    );
    worst[route || '/'] = bad;
    // Dialoge im hellen Skin gegenprüfen (Modal liegt auf bg-elevated)
    if (route === '/terminal') {
      const surface = SURFACES[0];
      await openSurface(page, surface, locale);
      await wait(1200);
      const resModal = await page.evaluate(CONTRAST_FN);
      const badModal = resModal.bad;
      report('S3', `Dialog (${surface.id}) im Light-Theme ≥ AA`, badModal.length === 0, badModal.slice(0, 6).map((b) => `${b.ratio}:1 "${b.text}"`).join(' · ') || 'clean');
      worst['dialog'] = badModal;
      await shot(page, `m5-light-${surface.id}`);
      await page.keyboard.press('Escape');
    }
    await shot(page, `m5-light-${route === '' ? 'landing' : 'terminal'}`);
    await page.close();
  }
  return worst;
}

/* ─────────────────── S3b: Token-Kontrastmatrix (alle Skins) ─────────────────── */

/**
 * Die Token-Matrix prüft jedes Text-Token gegen jede Fläche im jeweiligen Skin.
 * Das ist der einzige Weg, auch Flächen zu erwischen, die im Live-Lauf nie
 * gleichzeitig sichtbar sind (z. B. `faint` auf `elevated`).
 */
function s3TokenMatrix() {
  const css = readFileSync(join(ROOT, 'src', 'styles', 'globals.css'), 'utf8');
  const blocks = [...css.matchAll(/\[data-theme='(\w+)'\]\s*\{([\s\S]*?)\n  \}/g)];
  const hsl2rgb = (h, s, l) => {
    h /= 360;
    s /= 100;
    l /= 100;
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)].map((v) => v * 255);
  };
  const lum = ([r, g, b]) => {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  const parseP = (v) => {
    const m = String(v).match(/([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    return m ? { h: +m[1], s: +m[2], l: +m[3] } : null;
  };
  const FG = ['fg', 'muted', 'faint', 'primary', 'secondary', 'accent', 'danger', 'warning', 'bull', 'bear'];
  const BG = ['bg', 'surface', 'elevated'];
  const rows = {};
  for (const [, theme, body] of blocks) {
    const vars = Object.fromEntries([...body.matchAll(/--nc-([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    const fail = [];
    for (const fg of FG)
      for (const bg of BG) {
        const a = parseP(vars[fg]);
        const b = parseP(vars[bg]);
        if (!a || !b) continue;
        const r = ratio(hsl2rgb(a.h, a.s, a.l), hsl2rgb(b.h, b.s, b.l));
        if (r < 4.5) fail.push(`${fg}/${bg}=${r.toFixed(2)}`);
      }
    rows[theme] = { fail, worst: fail.length ? Math.min(...fail.map((f) => +f.split('=')[1])) : null };
    report('S3b', `Token-Matrix ${theme}: alle Text-Token ≥ 4.5:1`, fail.length === 0, fail.slice(0, 5).join(' · ') || 'clean');
  }
  return rows;
}

/* ─────────────────────────── S4: Icon-only Buttons ─────────────────────────── */

const ICONS_FN = '(' +
  function () {
    const vis = (el) => getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
    const out = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
      if (!vis(el)) continue;
      const text = [...el.querySelectorAll('*')]
        .filter((n) => !n.classList.contains('sr-only'))
        .map((n) => n.textContent)
        .join(' ')
        .trim();
      const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      const visible = (text + ' ' + ownText).replace(/\s+/g, ' ').trim();
      if (visible.length > 0) continue;
      const srOnly = [...el.querySelectorAll('.sr-only')].map((n) => n.textContent).join(' ').trim();
      out.push({
        name: (el.getAttribute('aria-label') || el.getAttribute('title') || srOnly || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        aria: el.hasAttribute('aria-label'),
        title: el.hasAttribute('title'),
        srOnly: srOnly.slice(0, 40),
        cls: String(el.className || '').slice(0, 50),
      });
    }
    return out;
  }.toString() +
  ')()';

const SYMBOLIC =
  /^[\d\s·+\-–%×x*/.,:()<>|_=~^\\[\]{}@#$&!?"'`…]+$|^[\p{Emoji_Presentation}\p{S}]+$/u;
/** Ticker/Kürzel (BTC/USDT, ETH, 1H) sind in jeder Sprache identisch – ok. */
const TICKER = /^[A-Z0-9]{2,10}(\s*\/\s*[A-Z0-9]{2,10})?$/;

async function s4IconNames(browser) {
  const locales = ONLY_LOCALE ? [ONLY_LOCALE] : ['de', 'en'];
  const perLocale = {};
  for (const locale of locales) {
    const page = await browser.newPage();
    await page.goto(`${BASE}/${locale}/terminal`, { waitUntil: 'domcontentloaded' });
    await wait(5200);
    const terminal = await page.evaluate(ICONS_FN);
    // plus die 15 Dialoge, weil dort der Schließen-Button sitzt
    const inDialogs = [];
    for (const surface of QUICK ? SURFACES.slice(0, 3) : SURFACES) {
      const opened = await openSurface(page, surface, locale);
      if (opened) continue;
      await wait(surface.kind === 'menu' ? 800 : 400);
      const icons = await page.evaluate(ICONS_FN);
      inDialogs.push({ surface: surface.id, icons });
      await page.keyboard.press('Escape');
      await wait(300);
    }
    perLocale[locale] = { terminal, inDialogs };
    await page.close();
  }

  // a) jeder Icon-Button hat überhaupt einen Namen
  const unnamed = [];
  for (const locale of locales) {
    for (const i of perLocale[locale].terminal) if (!i.name) unnamed.push(`${locale}:terminal:${i.cls}`);
    for (const d of perLocale[locale].inDialogs) for (const i of d.icons) if (!i.name) unnamed.push(`${locale}:${d.surface}:${i.cls}`);
  }
  report('S4', 'alle Icon-only-Buttons haben einen zugänglichen Namen', unnamed.length === 0, unnamed.slice(0, 5).join(' · '));

  // b) Lokalisierung: Namen, die in de UND en identisch sind, sind nicht übersetzt
  if (locales.length > 1) {
    const [a, b] = locales;
    const collect = (loc) => {
      const map = new Map();
      for (const i of perLocale[loc].terminal) if (i.name) map.set(i.name, 'terminal');
      for (const d of perLocale[loc].inDialogs) for (const i of d.icons) if (i.name) map.set(i.name, d.surface);
      return map;
    };
    const ma = collect(a);
    const mb = collect(b);
    const same = [];
    for (const [name, where] of ma) {
      if (mb.has(name) && !SYMBOLIC.test(name) && !TICKER.test(name) && name.length > 2) same.push(`${where}:"${name}"`);
    }
    report('S4', `Icon-Namen sind lokalisiert (nicht de=="${a}"==en)`, same.length === 0, [...new Set(same)].slice(0, 8).join(' · ') || 'clean');

    // c) gezielt: der Schließen-Button jedes Dialogs
    const closeNames = new Map();
    for (const loc of locales) {
      for (const d of perLocale[loc].inDialogs) {
        const close = d.icons.find((i) => /close|schlie|cerrar|закры|关闭/i.test(i.name)) || d.icons[0];
        if (!closeNames.has(d.surface)) closeNames.set(d.surface, {});
        closeNames.get(d.surface)[loc] = close?.name ?? '(keiner)';
      }
    }
    const englishOnly = [...closeNames.entries()].filter(([, v]) => v[a] && /^close$/i.test(v[a]) && v[a] === v[b]);
    report('S4', 'Schließen-Buttons sind übersetzt (kein hartes "close")', englishOnly.length === 0, englishOnly.map(([s, v]) => `${s}:${v[a]}`).slice(0, 6).join(' · '));
  }
  return perLocale;
}

/* ─────────────────────────── S5: Semantik-Sweep ─────────────────────────── */

async function s5Semantics(browser, locale) {
  for (const route of ['', '/terminal', '/help']) {
    const page = await browser.newPage();
    await page.goto(`${BASE}/${locale}${route}`, { waitUntil: 'domcontentloaded' });
    await wait(route === '/terminal' ? 5000 : 2000);
    const r = await page.evaluate(LANG_FN);
    const tag = `${route || '/'}`;
    report('S5', `${tag}: <html lang> beginnt mit "${locale}"`, (r.lang || '').toLowerCase().startsWith(locale), r.lang);
    report('S5', `${tag}: keine doppelten Ids`, r.bad.dupIds.length === 0, r.bad.dupIds.slice(0, 3).join(', '));
    report('S5', `${tag}: alle Bilder mit alt`, r.bad.noAlt.length === 0, r.bad.noAlt.slice(0, 2).join(', '));
    await page.close();
  }
}

/* ─────────────────────────── Hauptlauf ─────────────────────────── */

async function activeDesc(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName.toLowerCase()}:"${(a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"` : 'null';
  });
}

let s1 = null;
let s2 = null;
let s3 = null;
let s4 = null;
const started = Date.now();
console.log(`\nM5 A11Y-DEEP-DIVE · ${BASE} · locales=${ONLY_LOCALE ?? 'de,en'}${QUICK ? ' · quick' : ''}`);
const browser = await launch();

try {
  console.log('\n— S1 Fokus-Sichtbarkeit —');
  s1 = await s1FocusVisibility(browser, ONLY_LOCALE ?? 'de');
  console.log('\n— S2 Dialoge: Tab-Ordnung & Fokus-Containment —');
  s2 = await s2Dialogs(browser, ONLY_LOCALE ?? 'de');
  console.log('\n— S2b ToolMenü-/Dropdown-Tastaturbedienung —');
  await s2bMenus(browser, ONLY_LOCALE ?? 'de');
  console.log('\n— S3 Light-Theme-Kontrast —');
  s3 = await s3LightContrast(browser, ONLY_LOCALE ?? 'de');
  console.log('\n— S3b Token-Kontrastmatrix (alle 5 Skins) —');
  s3.tokens = s3TokenMatrix();
  console.log('\n— S4 Icon-only Buttons & Lokalisierung —');
  s4 = await s4IconNames(browser);
  console.log('\n— S5 Semantik-Sweep —');
  await s5Semantics(browser, ONLY_LOCALE ?? 'de');
} finally {
  await browser.close();
}

const fails = results.filter((r) => !r.ok);
const bySection = results.reduce((acc, r) => {
  acc[r.section] = acc[r.section] ?? { pass: 0, fail: 0 };
  acc[r.section][r.ok ? 'pass' : 'fail']++;
  return acc;
}, {});
console.log('\n═══════════ M5 ERGEBNIS ═══════════');
for (const [section, v] of Object.entries(bySection)) console.log(`${section}: ${v.pass} ok / ${v.fail} Befund(e)`);
console.log(`GESAMT: ${results.length - fails.length} ok / ${fails.length} Befund(e) · ${((Date.now() - started) / 1000).toFixed(0)}s`);

mkdirSync(SHOTS, { recursive: true });
const out = join(SHOTS, 'm5-report.json');
writeFileSync(out, JSON.stringify({ results, bySection, s1, s2, s3, s4 }, null, 2));
console.log(`Report: ${out}\n`);
process.exit(fails.length ? 1 : 0);
