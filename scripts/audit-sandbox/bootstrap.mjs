// © 2026 AndrexTheDev – All Rights Reserved. See LICENSE.md.
// Sandbox-Bootstrap: richtet Chromium + Laufzeitbibliotheken ein.
//
// Warum überhaupt: Die Sandbox hat weder Debian-Browserpakete noch Zugriff auf
// die Google-Hosts (storage.googleapis.com, edgedl.me.gvt1.com) – `npm install`
// kann Chrome also nicht herunterladen. npm und GitHub gehen aber, deshalb holt
// dieses Skript Chromium aus @sparticuz/chromium (npm) und die AL2023-Libs
// (libnspr4, libnss3 …) aus demselben Paket.
//
// Aufruf:  node scripts/audit-sandbox/bootstrap.mjs
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const PKG = `${ROOT}/node_modules/@sparticuz/chromium`;

if (!existsSync(PKG)) {
  console.log('• @sparticuz/chromium fehlt – wird installiert …');
  execSync('npm install --no-save --no-audit --no-fund @sparticuz/chromium', { cwd: ROOT, stdio: 'inherit' });
}

// 1) Chromium nach /tmp (das API entpackt nur das Binary)
const mod = await import(`${PKG}/build/index.js`);
const chromiumPath = await mod.default.executablePath();
console.log('• Chromium:', chromiumPath);

// 2) AL2023-Libs + Fonts: liegen als .tar.br im Paket und werden vom API nicht
//    entpackt – Debian 12 hat libnss3/libnspr4 nicht.
for (const [src, tar, dest] of [
  ['bin/al2023.tar.br', '/tmp/al2023.tar', '/tmp/al2023'],
  ['bin/fonts.tar.br', '/tmp/fonts.tar', '/tmp/fonts'],
]) {
  if (existsSync(`${dest}`) && existsSync(`${dest}/lib`) === existsSync('/tmp/al2023/lib')) {
    // fonts-Verzeichnis hat kein lib/ – separat prüfen
  }
  writeFileSync(tar, brotliDecompressSync(readFileSync(`${PKG}/${src}`)));
  mkdirSync(dest, { recursive: true });
  execSync(`tar -xf ${tar} -C ${dest}`);
}
console.log('• AL2023-Libs:', existsSync('/tmp/al2023/lib'), '| Fonts:', existsSync('/tmp/fonts'));

// 3) CJK-Schrift: ohne sie rendert Chrome Chinesisch als Tofu-Kästchen und jede
//    ZH-Layoutmessung ist wertlos. Der Fontsource-WOFF ist brauchbar, aber
//    fontconfig indexiert lieber OTF/TTF – daher die Variable-OTF von GitHub.
const CJK = '/tmp/fonts/NotoSansCJKsc-VF.otf';
if (!existsSync(CJK)) {
  try {
    execSync(
      `curl -sSL -H "Accept: application/vnd.github.raw" -o ${CJK} ` +
        'https://api.github.com/repos/notofonts/noto-cjk/contents/Sans/Variable/OTF/NotoSansCJKsc-VF.otf',
      { stdio: 'inherit' },
    );
    console.log('• CJK-Schrift geladen:', CJK);
  } catch {
    console.log('• CJK-Schrift konnte nicht geladen werden (ZH-Messungen wären Tofu)');
  }
}

// 4) fontconfig auf /tmp/fonts zeigen lassen
writeFileSync(
  '/tmp/fonts/fonts.conf',
  `<?xml version="1.0" ?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>/tmp/fonts</dir>\n  <cachedir>/tmp/fonts-cache/</cachedir>\n</fontconfig>\n`,
);

// 5) Laufzeittest
const version = execSync(`${chromiumPath} --version`, { env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib' } })
  .toString()
  .trim();
console.log('• Laufzeittest:', version);
