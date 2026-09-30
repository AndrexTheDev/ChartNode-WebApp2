# Audit-Sandbox (Fixture-Feed + Browser-Harness)

Werkzeuge für das Betriebsaudit (`AUDIT.md`), wenn **kein Zugang zu Börsen-,
DEX- und Fontservern** besteht: In der Sandbox zeigen Chart, Whale-Ticker und
Heatmap sonst nur legale Leerzustände, wodurch die Chart-Engine nicht prüfbar
wäre.

## Was hier liegt

| Datei | Zweck |
|---|---|
| `bootstrap.mjs` | Richtet die Sandbox ein: Chromium-Binary + AL2023-Laufzeitbibliotheken nach `/tmp`, CJK-Schrift, Font-Mock-Liste. Nach jedem Snapshot einmal ausführen. |
| `fixtures.mjs` | Fängt die Kline-Requests aller 12 Venues im Browser ab und antwortet im **Original-Wire-Format** (inkl. CORS-Header). Der Chart läuft dadurch über den echten Adapter-/Parser-/Render-Pfad. |
| `lib.mjs` | Browser-Start (headless Chromium aus `/tmp`), Instrumentierung (Konsole/Page-Errors/Netz), Menü-Helfer, Screenshots. |
| `font-mock.cjs` | Offline-Font-Mock für `next build`: liefert für jede Google-Fonts-URL echtes CSS + echte Font-Dateien aus den `@fontsource`-Paketen (kein Dummy, damit das Layout realistisch bricht – oder eben nicht). |
| `ad-fixtures.mjs` | **Ad-Fixtures (M6)**: fängt die Adsterra-Delivery-Skripte ab und ersetzt sie durch Stubs, die sich wie die echten verhalten (Native-Banner füllt sein Container-Div, Rail liefert 160×600-iframe, Social Bar verankert sich am Boden, Popunder armiert sich, Direct-Link antwortet). Modi `fill` / `nofill` / `blocked` / `flake`; dazu CLS-Messung mit Quell-Rechtecken. |
| `run-m6-ads.mjs` | **M6-Suite**: S0 CLS-Grundrauschen · S1 QA-Guard · S2 Social Bar (Reservierung, Überdeckung, Dialog-Pause) · S4 Sidebar-Rail · S5 Header-Banner · S6 Terminal-Slots · S7 Ad-Block-Wall · S8 Spender-Grace · S9 Popunder-Cap · S10 Smartlinks · S11 Fehler-Sweep. |
| `run-m7-perf.mjs` | **M7-Suite (Performance)**: S1 Ladeleistung (TTFB/FCP/LCP/CLS/TBT bei 4× CPU + Slow 4G), S2 Bundle (kritisch vs. nachgeladen je Seite), S3 Fonts je Sprache inkl. Cyrillic-Nachweis über `unicode-range`, S4 Interaktion (INP via Event-Timing, Menü→Dialog-Latenz), S5 Auslieferung (Cache/Kompression). Schalter: `--quick` (kurze Idle-Fenster), `--compare <report.json>` (zwei Läufe nebeneinander). |
| `run-m7-smoke.mjs` | **M7-Smoke**: Funktionstest der Pfade, die der Lazy-Umbau berührt (Kopfzeilen-Suche inkl. Lazy-Engine, Teilen-Dialog, Support-Dialog). 6 Checks. |
| `run-m8-robustness.mjs` | **M8-Suite (Robustheit)**: S1 Speicher (Quote voll, gesperrter Speicher, L2-Verdrängung) · S2 Rate-Limit (429-Overlay, Cooldown, Retry, kein Overlay bei 403) · S3 Netzabbruch (offline/online, Hänger mit Timeout, Abbruch beim Tippen, Dialog-Leichen) · S4 Sekundär-Quellen (Befund O3, hängende Quellen mit 12-s-Deckel) · S5 Payload-Härtung (4-MiB-Deckel, kaputtes JSON, leere/giftige Kerzen, Cache-Vergiftung). Fault-Injection über die `route`-Option der Fixtures. |
| `run-with-fixtures.mjs` | **Fixture-Wrapper (M9)**: startet ein Projekt-Skript (z. B. `scripts/browser-check.mjs`) und patcht `puppeteer.launch`, sodass **jede** Seite – auch die aus `createBrowserContext()` – den Fixture-Feed erhält. Damit laufen die Canvas-Suiten ohne Börsen-Netz statt in den Timeout. |
| `verify-offline.sh` | **Gate offline (M9)**: fährt dieselbe Kette wie `.github/workflows/deploy.yml` (`npm run verify:offline`): typecheck · lint · i18n · SEO · CWV · Fit · qa-features · browser-check mit Fixture-Feed. Live-Provider-Prüfungen melden `SKIP`. |
| `run-m5-a11y.mjs` | **M5-A11y-Suite**: S1 Fokus-Sichtbarkeit (dunkel + hell), S2 Tab-Ordnung/Fokus in 19 Overlays inkl. Fehlerachse, S2b Menü-Tastatur (4 ToolMenüs), S3 Light-Kontrast, S3b Token-Matrix über alle 5 Skins, S4 Icon-Namen (inkl. Lokalisierungs-Detektor), S5 Semantik. Schalter: `--locale de`, `--quick`. |

## Ablauf

```bash
# 1) Einmal pro Sandbox-Snapshot
node scripts/audit-sandbox/bootstrap.mjs

# 2) Bauen (Font-Mock ersetzt fonts.googleapis.com, das hier gesperrt ist)
# Achtung: absoluter Pfad – next/font löst relativ zu seinem eigenen Modul auf
NEXT_FONT_GOOGLE_MOCKED_RESPONSES="$PWD/scripts/audit-sandbox/font-mock.cjs" \
NEXT_PUBLIC_SITE_URL=https://nodechart.cc npx next build --webpack

# 3) Server + Suite
npx next start -H 0.0.0.0 -p 3000 &
LD_LIBRARY_PATH=/tmp/al2023/lib FONTCONFIG_PATH=/tmp/fonts \
  node scripts/audit-sandbox/run-m5-a11y.mjs
```

Gate ohne Netz (Durchgang M9): **867 PASS / 0 FAIL**, 19 Live-Prüfungen `SKIP`,
Exitcode 0 – `npm run verify:offline` (Server auf :3000 vorausgesetzt).

Aktueller Stand (Durchgang M5): **175 ok / 0 Befunde** in 262 s; Report als JSON
unter `/tmp/nc-shots/m5-report.json`, Screenshots daneben.

M6 (Werbung im Fill-Fall): **64 ok / 0 Befunde** in 158 s (Full-Fill-Build mit
`NEXT_PUBLIC_ADSTERRA_NATIVE_MOBILE`/`_DESKTOP`); auf dem Auslieferungs-Build ohne
diese Variablen **57 ok / 0** (die Slot-Stufen überspringen dann bewusst).
Report `/tmp/nc-shots/m6-report.json`.

M8 (Robustheit): **54 ok / 0 Befunde** in 167 s (Durchgang 6b). Geprüft werden
volle Quote beim Speichern (vorher: unbehandeltes `QuotaExceededError` im
Klickpfad), 429-Overlay mit Cooldown und automatischem Retry, Offline/Online,
hängende Verbindungen (12-s-Deckel), Abbrüche beim Tippen, tote/hängende
Sekundärquellen in Lupe und Heatmap sowie der 4-MiB-Antwortdeckel. Aufruf:
`npm run qa:robustness`.

M7 (Performance): **41 ok / 0 Befunde** (Durchgang 6). Gemessen wird gegen
`next start` (Produktionsbuild): Landing/`de` **LCP 1088 ms · CLS 0,000 · TBT 168 ms**,
Terminal **LCP 1116 ms · CLS 0,000 · TBT 305 ms**, kritisches JS **188,3 kB** (Landing)
bzw. **255,8 kB** (Terminal), 9 Font-Preloads, Cyrillic nur bei Bedarf.
Report `/tmp/nc-shots/m7-report.json`.
Die Suite braucht **keine** Fixtures: sie misst, was der Browser tatsächlich lädt
(geblockte Börsen-Hosts zählen nicht als Befund). Die drei Suiten hängen auch als
npm-Skripte im Projekt: `npm run qa:a11y`, `npm run qa:ads`, `npm run qa:perf`,
`npm run qa:perf:smoke`. Die M5-Suite braucht
den Fixture-Feed **nicht** (geprüft werden Struktur, Fokus, Kontrast) – die
Fehlerachse pro Fläche läuft trotzdem mit.

## Wichtig

- **`unhandledrejection` als DOM-Event feuert in diesem Headless-Chromium nie.**
  Wer unbehandelte Promise-Fehler prüfen will, braucht den CDP-Kanal:
  `Runtime.exceptionThrown` liefert `exceptionDetails.text` = „Uncaught (in
  promise) …“. Puppeteers `pageerror` reicht die Meldung zwar durch, aber ohne
  dieses Merkmal – eine Prüfung auf den Text `in promise` läuft dort ins Leere.
  Die M8-Suite klassifiziert deshalb über CDP und wurde mit einer
  Negativ-Kontrolle (Fix temporär entfernt) verifiziert.
- **Fixtures sind Sandbox-only.** Sie ersetzen keine echten Börsendaten; sie
  prüfen den Code-Pfad. Alle Zahlen in `AUDIT.md` sind als Fixture-Läufe
  gekennzeichnet.
- Jede abgefangene Antwort **muss** CORS-Header tragen, sonst blockt der
  Browser sie und der Chart bleibt leer.
- Venue-Aufrufe, die nicht Klines sind, antworten bewusst `503` (der
  Region-Ranker fällt dann durch) – diese Konsolenmeldungen sind erwartet.
- `@sparticuz/chromium` liegt als Dev-Abhängigkeit nicht im `package.json`;
  `bootstrap.mjs` installiert es bei Bedarf selbst nach.
