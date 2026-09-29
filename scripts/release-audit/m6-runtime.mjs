// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// MODUL 6 — RUNTIME & EDGE: bettet die CTO-Suite scripts/qa-release.mjs ein
// (Konsolen-Scan über Start + Interaktions-Batterie, Offline, Click-/Resize-
// Storm, Altbrowser-Emulation, finale Funktions-Checkliste).
import { execSync } from 'node:child_process';
import { ROOT, makeReporter } from './lib.mjs';
import { existsSync } from 'node:fs';

/**
 * Sandbox-taugliche Umgebung für die eingebetteten Alt-Suiten: sie starten
 * Puppeteer ohne `executablePath` und brauchen daher `PUPPETEER_EXECUTABLE_PATH`
 * (Chromium aus `audit-sandbox/bootstrap.mjs`). Ohne das brechen sie mit
 * „Could not find Chrome" ab, obwohl ein Binary bereitliegt.
 */
const childEnv = () => {
  const chrome = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || (existsSync('/tmp/chromium') ? '/tmp/chromium' : undefined);
  return {
    ...process.env,
    ...(chrome ? { PUPPETEER_EXECUTABLE_PATH: chrome } : {}),
    LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || '/tmp/al2023/lib',
    FONTCONFIG_PATH: process.env.FONTCONFIG_PATH || '/tmp/fonts',
  };
};



export const META = { id: 'M6', name: 'Runtime & Edge (CTO-Suite)' };

export async function run() {
  const rep = makeReporter(META.id, META.name);
  let out = '';
  let code = 0;
  try {
    out = execSync('node scripts/qa-release.mjs', { cwd: ROOT, encoding: 'utf8', timeout: 900000, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv() });
  } catch (e) {
    code = e.status || 1;
    out = (e.stdout || '') + (e.stderr || '');
  }
  const fails = (out.match(/^\s*FAIL\s+.*$/gm) || []).slice(0, 5);
  const passes = (out.match(/^\s*PASS\s+.*$/gm) || []).length;
  rep.check('qa-release (CTO-Batterie) ⇒ 0 FAIL', code === 0 && fails.length === 0, passes + 'P, Fails: ' + fails.join(' | ').slice(0, 140));
  return { ...META, pass: rep.pass(), fail: rep.fail(), rows: rep.rows() };
}
