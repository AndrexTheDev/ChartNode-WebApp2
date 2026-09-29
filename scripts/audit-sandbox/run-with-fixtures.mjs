// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// Führt ein Projekt-Skript aus, das selbst Puppeteer startet – und hängt JEDER
// neuen Seite den Fixture-Feed an (12 Venues im Original-Wire-Format).
//
// Warum: `npm run verify` ist im Deploy-Workflow die Sperre vor dem Deploy.
// Mehrere Teile davon (fit-check, qa-features, browser-check) warten auf
// `canvas` – ohne Börsen-Netz erscheint kein Canvas, und die Prüfung endet im
// Timeout, obwohl die App korrekt ist. In der CI gibt es Netz, in der Audit-
// Sandbox nicht. Mit diesem Wrapper läuft dieselbe Kette offline prüfbar:
//
//   node scripts/audit-sandbox/run-with-fixtures.mjs scripts/qa-features.mjs
//
// Umgesetzt wird das über einen Patch von `puppeteer.launch`: Das Zielskript
// importiert dasselbe Modul (ESM-Modul-Cache), sieht also die gepatchte
// Funktion. Jede Seite – auch die aus `createBrowserContext()` – bekommt
// `installFixtures()` vor dem ersten `goto`.
import puppeteer from 'puppeteer';
import { installFixtures } from './fixtures.mjs';

const target = process.argv[2];
if (!target) {
  console.error('Aufruf: node scripts/audit-sandbox/run-with-fixtures.mjs <skript.mjs> [args…]');
  process.exit(2);
}

const patchPage = (page) => {
  const goto = page.goto.bind(page);
  let installed = false;
  page.goto = async (...args) => {
    if (!installed) {
      installed = true;
      await installFixtures(page);
    }
    return goto(...args);
  };
  return page;
};

const originalLaunch = puppeteer.launch.bind(puppeteer);
puppeteer.launch = async (options = {}) => {
  const browser = await originalLaunch(options);
  const originalNewPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => patchPage(await originalNewPage(...args));
  const originalContext = browser.createBrowserContext.bind(browser);
  browser.createBrowserContext = async (...args) => {
    const context = await originalContext(...args);
    const contextNewPage = context.newPage.bind(context);
    context.newPage = async (...more) => patchPage(await contextNewPage(...more));
    return context;
  };
  return browser;
};

/* Relative Importe im Zielskript beziehen sich auf dessen eigenen Pfad –
   deshalb wird das Skript als Datei-URL importiert, nicht als cwd-Aufruf. */
await import(new URL(`../../${target.replace(/^\.\//, '')}`, import.meta.url).href);
