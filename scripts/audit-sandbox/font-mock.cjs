// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
/* CommonJS ist Pflicht: next/font lädt diese Datei per require(). */
/* eslint-disable @typescript-eslint/no-require-imports */
// Offline-Font-Mock für `next build` in der Sandbox (kein Zugang zu
// fonts.googleapis.com). Statt Dummy-Bytes liefert der Mock die ECHTEN
// Font-Dateien aus den @fontsource-Paketen (npm) – das Layout der fünf Locales
// inkl. Kyrillisch wird dadurch realistisch gerendert.
//
// next/font liest bei gesetztem NEXT_FONT_GOOGLE_MOCKED_RESPONSES:
//   CSS   -> mockFile[url]   (dieser Proxy beantwortet jede URL)
//   Datei -> url beginnt mit "/" ⇒ wird von der Platte gelesen (absoluter Pfad)
const { existsSync } = require('node:fs');
const { resolve, dirname } = require('node:path');

const ROOT = resolve(dirname(__filename), '../../node_modules/@fontsource');
const PACKAGES = {
  Orbitron: { dir: 'orbitron', weights: ['900'] },
  'Exo 2': { dir: 'exo-2', weights: ['700', '800', '900'] },
  Manrope: { dir: 'manrope', weights: ['400', '600', '700'] },
  'JetBrains Mono': { dir: 'jetbrains-mono', weights: ['400', '700'] },
};
const SUBSETS = ['latin', 'cyrillic'];

function familiesFromUrl(url) {
  const found = [];
  for (const [family, meta] of Object.entries(PACKAGES)) {
    const needle = family.replace(/ /g, '+');
    if (!url.includes(`family=${needle}`)) continue;
    // Gewichte aus `family=Exo+2:wght@700;800` ziehen; sonst Paket-Default
    const section = url.split(`family=${needle}`)[1] ?? '';
    const weights = [];
    const wght = /wght@([\d;,]+)/.exec(section);
    if (wght) for (const w of wght[1].split(/[;,]/)) if (/^\d+$/.test(w)) weights.push(w);
    found.push({ family, dir: meta.dir, weights: weights.length ? weights : meta.weights });
  }
  return found;
}

function cssFor(url) {
  const blocks = [];
  for (const { family, dir, weights } of familiesFromUrl(url)) {
    for (const weight of weights) {
      for (const subset of SUBSETS) {
        const file = `${ROOT}/${dir}/files/${dir}-${subset}-${weight}-normal.woff2`;
        if (!existsSync(file)) continue;
        // Format muss der next/font-Parser erwarten: Subset-Kommentar + `src: url(…)`
        blocks.push(
          `/* ${subset} */\n@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: ${weight};\n` +
            `  font-display: swap;\n  src: url(${file}) format('woff2');\n  unicode-range: U+0000-00FF, U+0400-045F;\n}`,
        );
      }
    }
  }
  return blocks.join('\n');
}

module.exports = new Proxy(
  {},
  {
    get(_target, url) {
      if (typeof url !== 'string') return undefined;
      if (url.startsWith('http')) {
        const css = cssFor(url);
        if (!css) throw new Error(`font-mock: keine Fonts für ${url}`);
        return css;
      }
      return undefined;
    },
  },
);
