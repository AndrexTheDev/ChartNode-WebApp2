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

Aktueller Stand (Durchgang M5): **175 ok / 0 Befunde** in 262 s; Report als JSON
unter `/tmp/nc-shots/m5-report.json`, Screenshots daneben.

M6 (Werbung im Fill-Fall): **64 ok / 0 Befunde** in 158 s (Full-Fill-Build mit
`NEXT_PUBLIC_ADSTERRA_NATIVE_MOBILE`/`_DESKTOP`); auf dem Auslieferungs-Build ohne
diese Variablen **57 ok / 0** (die Slot-Stufen überspringen dann bewusst).
Report `/tmp/nc-shots/m6-report.json`. Die M5-Suite braucht
den Fixture-Feed **nicht** (geprüft werden Struktur, Fokus, Kontrast) – die
Fehlerachse pro Fläche läuft trotzdem mit.

## Wichtig

- **Fixtures sind Sandbox-only.** Sie ersetzen keine echten Börsendaten; sie
  prüfen den Code-Pfad. Alle Zahlen in `AUDIT.md` sind als Fixture-Läufe
  gekennzeichnet.
- Jede abgefangene Antwort **muss** CORS-Header tragen, sonst blockt der
  Browser sie und der Chart bleibt leer.
- Venue-Aufrufe, die nicht Klines sind, antworten bewusst `503` (der
  Region-Ranker fällt dann durch) – diese Konsolenmeldungen sind erwartet.
- `@sparticuz/chromium` liegt als Dev-Abhängigkeit nicht im `package.json`;
  `bootstrap.mjs` installiert es bei Bedarf selbst nach.
