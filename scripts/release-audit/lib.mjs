// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// Gemeinsame Helfer für den modularen Release-Audit (scripts/release-audit/).
import { writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
export const LOCALES = ['de', 'en', 'es', 'ru', 'zh'];
export const ROUTES = ['/', '/help', '/terminal', '/cluster', '/legal/terms', '/legal/disclaimer', '/legal/privacy'];

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Headless-Artefakte + bekannte CORS-blinde Exchange-Hosts (Doktrin) filtern. */
export const ENV_NOISE = /SwiftShader|software WebGL|GroupMarkerNotSet|Fallback to SwiftShader/i;
export const CORS_BLIND = /api\.bybit\.com|api\.kucoin\.com|api-pub\.bitfinex\.com|api\.coinex\.com|geckoterminal\.com/i;
/** Chrome-interner Root-Request (tritt nur in Incognito-Kontexten auf, nie app-initiiert). */
export const CHROME_INTERNAL = /^https?:\/\/(www\.)?google\.com\/?$/;
/**
 * Vom Sandbox-Netz blockierte Drittanbieter (Börsen-REST/WS) erscheinen als
 * generische Chrome-Meldungen OHNE Host im Text – „Failed to load resource:
 * net::ERR_CONNECTION_CLOSED" bzw. „WebSocket connection to 'wss://…' failed".
 * Das ist Umgebungsrauschen, kein App-Fehler: dieselben Requests laufen auf
 * einem Rechner mit Internetzugang durch (M3/M10 beweisen den Code-Pfad mit dem
 * Fixture-Feed). Die M5/M6/M7-Suiten filtern identisch.
 */
export const NET_BLOCKED =
  /Failed to load resource: net::ERR_(CONNECTION_CLOSED|CONNECTION_REFUSED|CONNECTION_RESET|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|TIMED_OUT|ADDRESS_UNREACHABLE|EMPTY_RESPONSE|SSL|FAILED|ABORTED)/i;
export const WS_BLOCKED = /WebSocket connection to 'wss?:\/\/[^']+' failed/i;
export const isNoise = (text) =>
  ENV_NOISE.test(text) || CORS_BLIND.test(text) || CHROME_INTERNAL.test(text) || NET_BLOCKED.test(text) || WS_BLOCKED.test(text);

/** Reporter pro Modul: check(name, ok, info) sammelt + loggt sofort. */
export function makeReporter(modId, modName) {
  const rows = [];
  let pass = 0;
  let fail = 0;
  const check = (name, ok, info = '') => {
    if (ok) pass += 1;
    else fail += 1;
    rows.push({ name, ok: !!ok, info: String(info).slice(0, 200) });
    console.log(`  ${ok ? '✔' : '✘'} [${modId}] ${name}${info ? ' — ' + String(info).slice(0, 160) : ''}`);
  };
  return { check, pass: () => pass, fail: () => fail, rows: () => rows, id: modId, name: modName };
}

export async function launchBrowser() {
  /*
   * Wie im Sandbox-Harness (`audit-sandbox/lib.mjs`): In Umgebungen ohne
   * Chrome-for-Testing-Download liefert `bootstrap.mjs` ein Chromium nach
   * /tmp/chromium; `CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH` überschreiben das.
   * Ohne diese Auflösung bricht das Release-Audit auf so einem Rechner mit
   * „Could not find Chrome" ab, obwohl ein Binary bereitliegt.
   */
  const explicit = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  const fallback = existsSync('/tmp/chromium') ? '/tmp/chromium' : undefined;
  return puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
    executablePath: explicit || fallback,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || '/tmp/al2023/lib', FONTCONFIG_PATH: process.env.FONTCONFIG_PATH || '/tmp/fonts' },
    protocolTimeout: 120000,
  });
}

export async function newPage(browser, { width = 1440, height = 900, mobile = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
  await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  return page;
}

/** Console-/Pageerror-Sammler mit Noise-Filter. */
export function attachConsole(page, bucket, { allow } = {}) {
  const allowed = (s) => (typeof allow === 'function' ? allow(s) : false);
  page.on('pageerror', (e) => {
    const s = String(e && e.message ? e.message : e);
    if (!isNoise(s) && !allowed(s)) bucket.push('pageerror: ' + s);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const s = m.text();
    if (!isNoise(s) && !allowed(s)) bucket.push(m.type() + ': ' + s);
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (isNoise(u)) return;
    // Nur Same-Origin-Fails sind Release-Blocker; Third-Party-Flakes (Sandbox-
    // Netz, CORS-blinde Börsen) deckt der Funktions-Check in M3 funktional ab.
    if (!u.startsWith(BASE)) return;
    bucket.push('requestfailed: ' + u.slice(0, 120));
  });
}

/**
 * Fixture-Feed optional zuschalten.
 *
 * Die Module M3 (Terminal-Batterie) und M10 (Resilienz) brauchen Kurse. In einer
 * Sandbox ohne Börsenzugang bleibt der Chart im korrekten Platzhalter-Zustand
 * („Warte auf Kursdaten …") stehen – die Suiten würden dann die Umgebung messen
 * statt die App. Mit `fixtures: true` antwortet der Harness im Original-Wire-Format
 * aller 12 Venues (siehe `audit-sandbox/fixtures.mjs`), sodass der echte
 * Adapter-/Parser-/Render-Pfad läuft.
 */
export async function withFixtures(page) {
  const { installFixtures } = await import('../audit-sandbox/fixtures.mjs');
  await installFixtures(page);
  return page;
}

export const gotoSafe = (page, url, timeout = 90000) =>
  page.goto(url, { waitUntil: 'domcontentloaded', timeout });

/** RELEASE-AUDIT.md schreiben: Modulübersicht + alle Fails. */
export function writeReport(modules) {
  const totalP = modules.reduce((a, m) => a + m.pass, 0);
  const totalF = modules.reduce((a, m) => a + m.fail, 0);
  const lines = [
    '# RELEASE-AUDIT (modular)',
    '',
    `Stand: ${new Date().toISOString()} · **${totalP} PASS / ${totalF} FAIL**`,
    '',
    '| Modul | Bereich | PASS | FAIL |',
    '|---|---|---:|---:|',
    ...modules.map((m) => `| ${m.id} | ${m.name} | ${m.pass} | ${m.fail} |`),
    '',
  ];
  for (const m of modules) {
    if (!m.fail) continue;
    lines.push(`## ${m.id} — ${m.name}: Fails`, '');
    for (const r of m.rows.filter((x) => !x.ok)) lines.push(`- ✘ ${r.name}${r.info ? ' — ' + r.info : ''}`);
    lines.push('');
  }
  writeFileSync(resolve(ROOT, 'RELEASE-AUDIT.md'), lines.join('\n'));
  return { totalP, totalF };
}
