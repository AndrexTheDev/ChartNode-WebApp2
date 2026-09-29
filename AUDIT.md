# AUDIT — NodeChart (nodechart.cc)

Systematisches Qualitäts-/Vollständigkeitsaudit in Modulen. Dieses Dokument ist das
Arbeitsprotokoll auf dem Weg zur finalen Version: **was geprüft wurde, was gefunden wurde,
was bereits behoben ist und was als Nächstes dran ist.**

- Stand: 2026-09-28
- Geprüfter Commit: `aa809ae` (`main`) + Fixes der Durchgänge 1–2 (`2ae6ebf` + Arbeitsstand, Branch `arena/01a0e92c-chartnode-webapp2`)
- Umfang: 179 Quelldateien · ~29 200 Zeilen · 5 Locales (à 1 160 Keys) · 38 vorgebaute Routen

---

## 0. Status-Dashboard

| Modul | Bereich | Status | Ergebnis |
|---|---|---|---|
| M0 | Statische Gates (Types, Lint, Build, i18n) | ✅ bestanden | 0 TS-Fehler · 0 Lint-Fehler · Build 38/38 Routen · i18n-Parität 5×1 160 |
| M1 | Darstellung · SEO · Rendering (120 Läufe × 4 Viewports) | ✅ geprüft | 0 Konsolenfehler · 0 Page-Errors · 0 kaputte Bilder · 0 tote Links |
| M2 | Terminal-Funktionalität (16 Modals, Layouts, Palette, Themes) | ✅ geprüft | alle 16 Modals öffnen/schließen korrekt, Inhalte vollständig lokalisiert |
| M2b | **Mobile Terminal-Layout (Prio 1)** | ✅ umgebaut | Chartfläche im First-View: **47 px → 625 px** (74 % des Viewports) |
| M3 | Chart-Engine / Canvas (Indikatoren, Zeichnungen, Pane-Sync, Replay, Export) | ✅ geprüft | Fixture-Feed: 300 Candles, 36 Indikatoren, Zeichnungen, Pane-Sync, Bar-Replay, Backtest-Marker, PNG **mit** Wasserzeichen – 0 Page-Errors |
| M4 | i18n-Layout-Stresstest (RU/ZH, lange Strings, 15 Modals) | ✅ geprüft | 120/120 Seiten-Kombis · 132/170 Modal-Läufe (Rest = Toggles) · **7 echte Layout-Bugs behoben** |
| M5 | A11y-Deep-Dive (Fokusringe, Tab-Ordnung in 19 Overlays, Light-Kontrast, Icon-Namen) | ✅ geprüft | **175/175 Checks · 0 Befunde** · 11 echte Fixes (u. a. bull/bear folgten dem Theme nicht) |
| M6 | Werbung/Monetarisierung im Fill-Fall (CLS, Kollaps, Social Bar, Ad-Block-Wall, Spender) | ✅ geprüft | **64/64 Checks · 0 Befunde** · 9 echte Fixes (u. a. Doppel-Id auf dem Terminal, unsichtbare Social Bar) |
| M7 | Performance / Core Web Vitals (Mid-Range-Mobile: 4× CPU + Slow 4G) | ✅ geprüft | **41/41 Checks · 0 Befunde** · 6 echte Fixes (u. a. Terminal-CLS 0,110 → 0,000 · Landing-JS 220,9 → 188,3 kB) |
| M8 | Robustheit (Netzabbruch, Rate-Limit, Speicher, Payloads) | ✅ geprüft | **54/54 Checks · 0 Befunde** · 4 Fixes (u. a. unbehandeltes `QuotaExceededError` bei voller Quote, Befund O3 bestätigt und behoben) |
| M9 | Deploy-Pfad Cloudflare / Domain | ⏳ offen | – |

**Konsistenz der Versprechen (geprüft):** Die Meta-Description nennt „34 Indikatoren" — das
Indikator-Modal bietet genau **34** Einträge (33 Rechen-Indikatoren + Script-Lab-Einstieg).
Die Feature-Karte zum Bar-Replay nennt „33 Indikatoren" und meint damit korrekt die 33
Rechen-Indikatoren. Kein Widerspruch.

> **Wichtig zur Reproduzierbarkeit:** Die Sandbox hat keinen Zugang zu Börsen-, DEX- und
> Fontservern (nur npm/GitHub). Alles, was Live-Daten braucht (Canvas-Chart, Heatmap,
> Whale-Ticker, Rate-Limit-Overlay), zeigt deshalb legale Leerzustände. Das ist **kein**
> Defekt, sondern Umgebung. Für M3 wurde deshalb ein Fixture-Layer gebaut (`.audit/fixtures.mjs`),
> der die Kline-Antworten aller 12 Venues im Original-Wire-Format beantwortet — der Chart läuft
> damit über den echten Adapter-/Parser-/Render-Pfad. Für M4 kam eine **echte CJK-Schrift**
> dazu (Noto Sans CJK SC): ohne sie rendert Chrome ZH als Tofu-Kästchen und jede Messung
> wäre wertlos.

---

## 1. Module M0 — statische Gates

| Prüfung | Befehl | Ergebnis |
|---|---|---|
| Typen | `npx tsc --noEmit` | 0 Fehler |
| Lint | `npx eslint .` | 0 Fehler, 2 Warnungen (`scripts/release-audit/m10-resilienz.mjs:8`, `m8-ads-deep.mjs:16` — ungenutzte Variablen in QA-Skripten) |
| Build | `next build` | 38/38 Routen, alle Locales statisch (SSG) |
| i18n-Parität | `npm run check:i18n` | 5 × 1 160 Keys, Platzhalter konsistent |

---

## 2. Modul M1 — Darstellung, SEO, Rendering

**Testmatrix:** 5 Locales × 6 Seiten × 4 Viewports (390 / 834 / 1440 / 1920) = **120 Läufe**,
jeweils mit Protokollierung von Konsolenfehlern, Page-Errors, fehlgeschlagenen Requests,
HTTP-Status, Layout-Überlauf, A11y-Basics und Screenshot.

### ✅ Sauber

- **0** JavaScript-Fehler, **0** unbehandelte Page-Errors, **0** 4xx/5xx, **0** fehlgeschlagene
  App-Ressourcen, **0** defekte Bilder, **0** fehlende `alt`-Attribute, **0** Links ins Leere.
- **Metadaten pro Locale korrekt:** `<html lang>` (de-DE / es-ES / ru-RU / zh-Hans …),
  Canonical `https://nodechart.cc/<locale>`, `hreflang` inkl. `x-default`, genau **eine** H1,
  lückenlose Heading-Reihenfolge, JSON-LD (SoftwareApplication + Organization/WebSite).
- **Social/SEO vollständig:** `og:title/description/url/site_name/locale` + 4× `og:locale:alternate`,
  `og:image` **mit** `width`/`height`/`alt`, `twitter:card=summary_large_image` + `twitter:image`.
- **Routen:** `/` → 307 auf `/en`; `/en /de /es /ru /zh`, `/help`, 15 Rechtsseiten, `/terminal`,
  `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/llms.txt`, `/icon.svg`, `/api/og` → alle 200.
- **A11y-Basics:** keine unbenannten Buttons/Links, Touch-Targets in Ordnung (einzige
  „kleine" Fläche ist der absichtliche Skip-Link, der bei Fokus groß wird).
- **Light-Theme vollständig:** Landing, Terminal und Hilfe sind auch in „Daylight" korrekt
  gefärbt (Farbpunkte-Messung: 0 dunkle Flächen).

### 🔧 Befunden und behoben

| # | Befund | Schwere | Status |
|---|---|---|---|
| B1 | **Mobiler Überlauf auf Rechtsseiten:** `/de/legal/terms` (407 px), `/de/legal/privacy` (398 px), `/ru/legal/privacy` (401 px) bei 390 px Viewport. Ursache: ein unteilbares Komposit-Wort in der H1 („Allgemeine Geschäftsbedingungen") sprengte die Zeile → horizontales Scrollen + aufgeblähtes Layout-Viewport. | mittel | ✅ **behoben** (`[overflow-wrap:anywhere]` auf der Legal-H1 + `html { overflow-x: clip }` als globales Sicherheitsnetz). Nachgemessen: alle vier Seiten **390/390/390**, kein H-Scroll. |
| B2 | **Sponsor-Leiste war in allen 5 Locales englisch** („Bonus Offer / Partner Deal / Trading Contest") — Kit-Strings statt Content. | mittel | ✅ **behoben** (Kit liest `ITEMS` aus `data-config`; 3 neue Keys `ads.offer{Bonus,Partner,Contest}` in allen 5 Locales). Verifiziert: de „Bonus-Angebot/Partner-Deal/Trading-Wettbewerb", es/ru/zh ebenfalls lokalisiert. |
| B3 | **Interner Entwickler-Platzhalter im UI:** „Wartet auf die Chart-Engine (Teil 2)" stand im Terminal-Chip (alle 5 Locales) — verrät den Bauzustand. | mittel | ✅ **behoben** → „Warte auf Kursdaten …" (bzw. lokalisiert). |

### 📋 Offen (bewusst nicht angefasst)

| # | Beobachtung | Schwere | Einordnung |
|---|---|---|---|
| O1 | `npm run audit:css` meldet 1 „fehlende" Utility: `border-0`. | kosmetisch | **Werkzeug-Fehler, kein Produktfehler** — `border-0` ist eine Tailwind-Core-Utility und wird nur als `last:border-0` / in `@apply` benutzt. |
| O2 | Sponsor-Leiste ist auf Phones ein **unsichtbarer Quer-Scroller** (`overflow-x: auto`, `scrollbar-width: none`); die 3. Kachel ist nur durch Wischen erreichbar — seit der Lokalisierung noch breiter (580 px bei 374 px Sichtfeld). | niedrig | Bewusste, im Code dokumentierte Design-Entscheidung („darf nicht dreizeilig ins First-View ragen"). Empfehlung: auf Phones nur 2 Angebote zeigen oder eine Wisch-Andeutung ergänzen. |
| O3 | Einmalig beobachtete unbehandelte Promise-Rejection („Failed to fetch") im 120-Läufe-Sweep; in je 15-Sekunden-Messungen auf Landing und Terminal **nicht** reproduzierbar. Latentes Muster gefunden: in `HeatmapModal`/`MagnifierModal` bleibt die Sekundär-Quelle (`fromOkx`/`okx`) unbeobachtet, wenn die Primär-Quelle gewinnt → könnte eine unbehandelte Rejection erzeugen. | niedrig | Härtungskandidat für M8 (ein `void secondary.catch(() => null)` pro Stelle). |

---

## 3. Modul M2 — Terminal-Funktionalität

**Methode:** echtes Headless-Chrome gegen den Produktionsbuild, jede Funktion über die
echten UI-Elemente ausgelöst (`data-menu-trigger` → Menüeintrag), inkl. Esc-Schließen-Prüfung.

### ✅ Alles gefunden und funktionsfähig

| Bereich | Ergebnis |
|---|---|
| **16 Modals** | Teilen · Hilfe · Liq Radar · Lag Oracle · Regime Compass · Clock Edge · Chartmuster · Ratings · Heatmap · Backtest · Screener · Risiko · Journal · Bar-Lupe · Script Lab · Alerts — **alle** öffnen mit echtem, lokalisiertem Inhalt, keinerlei Clipping (512×235 bis 1024×133 px), alle schließen mit **Esc**. |
| **Layouts** | Tasten `1` / `2` / `3` bzw. Buttons schalten 1x1 / 2x1 / 2x2 (aria-pressed korrekt). |
| **Themes** | Acid Green, Electric Purple, Daylight schalten live **und** persistieren über den Reload; Premium-Skins (Matrix/Miami) öffnen korrekt das „Premium-Skins freischalten"-Gate. |
| **Command-Palette** | ⌘K/Ctrl+K öffnet, **46 Einträge**, Suche filtert live (inkl. Tool-, Theme- und Layout-Aktionen). |
| **Watchlist** | Stern-Toggle wechselt `aria-pressed` true→false. |
| **Indikatoren** | Modal öffnet mit **36** wählbaren Indikatoren (EMA, SMA, Bollinger, Supertrend, Ichimoku, VWAP, Hull MA, TD Sequential …). |
| **Zeichenwerkzeuge** | Cursor, Trendlinie, Strahl, horizontale Linie, Fibonacci, Support/Resistance-Zone, Radierer, „alle löschen (n)". |
| **Export** | „PNG exportieren (inkl. Wasserzeichen)" + „OHLCV als CSV exportieren" vorhanden. |
| **Persistenz** | `nodechart:store:v1` (inkl. Theme), `nc-chart-v1`, `nc-viral-v1`, `nodechart.exchanges.v1`, `nc-visits`. |
| **Feed-Layer** | Alle 12 CEX-Adapter starten ihre Sockets und REST-Seeds korrekt (im Sandbox netzbedingt `ERR_CONNECTION_CLOSED`), Status-Chip läuft korrekt durch `Verbinde neu · Versuch n`. |
| **Leerzustände** | Ehrlich und lokalisiert: Heatmap „nicht erreichbar – Binance-API blockt?", Regime/Clock „Noch zu wenig Kerzen", Lag Oracle „Leader-Feed lädt – mindestens 60 Kerzen nötig". |

### 📋 Offen

| # | Beobachtung | Schwere |
|---|---|---|
| O4 | **Die Projekt-eigenen GUI-QA-Skripte können ohne Live-Daten nicht laufen:** `npm run qa:features` wartet auf ein `canvas`-Element, das erst mit echten Kerzen entsteht → Timeout. `qa:modules`, `browser-check`, `gui-audit` haben dieselbe Abhängigkeit. Für CI/Release wäre ein **Fixture-Modus** (eingespielte Candle-Seeds) deutlich wertvoller als echte Netze. | niedrig (Testinfrastruktur) |

---

## 4. ✅ Prio 1 gelöst — mobiles Terminal umgebaut

**Befund (vorher):** Auf einem 390×844-Telefon war beim Öffnen des Terminals praktisch
keine Chartfläche zu sehen — die vollständige Toolbar brach auf 7 Zeilen / 426 px um.

| Block | vorher | nachher |
|---|---:|---:|
| Header | 114 px | 114 px |
| Sponsor-Leiste | 44 px | ~86 px (2 sichtbare Kacheln) |
| Terminal-Toolbar | **426 px** (7 Zeilen) | **57 px** (1 schmale Leiste) |
| Chart-Pane beginnt bei | 823 px | **219 px** |
| **Chartfläche im First-View** | **47 px (5 %)** | **625 px (74 %)** |

**Was gebaut wurde**

1. **Viewport-füllendes Terminal auf Phones** — kein Seiten-Scroll mehr innerhalb des
   Terminals (`max-lg:h-[calc(100dvh-var(--nc-header-h))] max-lg:overflow-hidden`);
   `min-h-0` am Chart-Grid, damit die Panes korrekt schrumpfen statt zu wachsen.
   Desktop bleibt unverändert (freies Wachstum, Pane-Sync, Dock-Ticker, Footer).
2. **Einklappbare Toolbar statt Werkzeugwand** — die schmale Leiste
   (Symbol · Preis · Intervall · Werkzeuge-Button) erscheint auf Phones, die volle
   Leiste kommt per Tipp zurück und per Chevron wieder weg.
3. **CSS-first, nicht React-Konditional.** Server und Client rendern denselben Zustand
   (`data-nc-toolbar="closed"`), das Umschalten ist ein reines Datenattribut. Damit:
   kein Hydration-Mismatch, kein Layout-Sprung beim ersten Paint (CLS 0) und die
   schmale Leiste funktioniert **auch ohne JavaScript**.
4. **Bewusst ohne Scroll-Trigger.** Ein Scroll-basiertes Ein-/Ausklappen erzeugt eine
   Rückkopplung (Höhenänderung ⇒ Scrollpositionsänderung ⇒ umgekehrtes Event) und
   flackerte in den Messungen reproduzierbar. Der Zustand hängt jetzt nur an der
   Viewport-Breite und an expliziten Tipps.

**Zusätzlich gefunden und behoben (B4):** Der Touchscreen-Hinweis im Chart-Werkzeugkasten
war eine Zeile im Werkzeug-Streifen. Seine beiden Aktionsbuttons reservierten sich
243 px, wodurch der Fließtext auf **55 px Breite** gepresst wurde (322 px hoch,
unlesbar). Jetzt Aktionszeile unter dem Text: Textbreite **306 px**, Bannerhöhe
**374 px → 188 px**.

**Regression nach dem Umbau** (30 Seiten-Läufe, 5 Locales × 3 Seiten × 2 Viewports):

| Prüfung | Ergebnis |
|---|---|
| Routen | alle 200 |
| Konsolenfehler | **0** |
| Page-Errors | **0** |
| defekte interne Requests | **0** |
| horizontaler Seiten-Scroll | **0** (vorher 3 Seiten) |
| 15 Tool-Modals | alle öffnen, keins geclippt, alle schließen mit Esc |
| Themes (inkl. Premium-Gate) | alle korrekt |
| Toolbar Desktop unverändert | 110 px, 1 Zeile, Chart 693 px |

> Hinweis zur Messung: Elemente innerhalb der Landing-Marquee (`animate-marquee`) ragen
> konstruktionsbedingt über den Viewport hinaus. Eine Nachprüfung aller Treffer
> (`unscrolled: []`) bestätigt: **kein** Element außerhalb einer bewussten
> Scroll-/Animationszone ragt hinaus.

## 5. ✅ Modul M3 — Chart-Engine (mit Fixture-Feed geprüft)

Weil die Sandbox keine Börsenverbindung hat, läuft der Chart über einen Fixture-Layer
(`.audit/fixtures.mjs`, nur Sandbox): alle Kline-Requests der 12 unterstützten Venues werden
im Browser abgefangen und im **exakten** Wire-Format (inkl. CORS-Header) beantwortet;
Nicht-Kline-Aufrufe antworten bewusst `503`, damit der Region-Ranker durchfällt – das erklärt
die 9 `503`-Konsolenmeldungen (kein Defekt). Geprüft wird damit der echte Pfad:
Adapter → Parser → Store → Renderer.

| Prüfpunkt | Ergebnis |
|---|---|
| Seed & Canvas | 7 Canvasse (Haupt 1508×634, Preisachse 74×634, Zeitachse 1508×28), Chip `300 Candles`, Live-Legende `O 62830.36 H 63026.99 L 62507.94 C 62620.96` |
| Indikatoren (Stichprobe) | EMA, RSI, Bollinger, MACD zugefügt → Chip `+ 4`, Serien gezeichnet |
| **Indikatoren (vollständig)** | **alle 34 Modal-Einträge** hinzugefügt (33 Rechen-Indikatoren + „Eigenes Skript"): Canvas-Elemente 7 → 87, Legende zeigt für **jeden** Indikator Werte (EMA 21 62345.95 · … · UO 46.56), **0 Page-Errors, 0 App-Errors**; `Alle entfernen` stellt exakt den Ausgangszustand wieder her (7 Canvasse) |
| Zeichnungen | Trendlinie, horizontale Preislinie, Fibonacci setzen `aria-pressed=true`, Drag/Click erzeugen Tinte, `Alle Zeichnungen löschen (2)` |
| Layouts | 1x1 / 2x1 / 2x2 → 15 / 22 / 36 Canvas-Elemente (4 Panes) |
| **Pane-Sync (Zoom)** | Wheel in Pane 1 ändert **alle vier** Pane-Bitmaps identisch (309 → 324); Sync-Toggle aus → keine Weitergabe mehr |
| **Pane-Sync (Crosshair)** | Hover in Pane 1 zeichnet das Remote-Fadenkreuz in Pane 2–4 (Canvas-Checksummen 39 590 → 41 285); Toggle aus → Pane 2–4 zurück auf 39 590 |
| **Bar-Replay** | `Replay` aktiv → Legende springt vom Live-Candle (`62830.36…`) auf den Replay-Cursor (`61390.67…`); `10 Bars zurück`, `1 Bar zurück`, `Abspielen` (Button wird zu `Pause`), `Live` → exakt wieder der Live-Schlusskurs |
| **Backtest-Marker** | `Trades auf den Chart` → Toast `7 Round-Trips auf dem Chart`, Canvas ändert sich; `Marker entfernen` stellt den vorherigen Canvas **exakt** wieder her |
| **PNG-Export** | Button lokalisiert: „PNG exportieren (inkl. Wasserzeichen)"; das PNG (1582×662, 69 KB) wurde visuell geprüft: Candles, Volumen, Achsen, Preislinie – und das Wasserzeichen `www.NodeChart.cc` mittig im Chart. `takeScreenshot(true, true)` schließt Primitives laut Bibliotheks-Typdefinition ausdrücklich ein |
| CSV-Export | 22 722 B, `text/csv;charset=utf-8` |

### 🔧 Gefunden und behoben: `RangeError: Invalid language tag: en-US@posix`

Symptom: 60+ Page-Errors pro Terminal-Lauf. Ursache war **nicht** die eigene Locale-Erkennung
(`LocaleDetectBanner` prüft sauber per `isLocale`), sondern `lightweight-charts`: die Bibliothek
formatiert Achsen-Ticks intern mit `Date.toLocaleString()` **ohne Locale-Argument**, also im
Runtime-Default. Läuft Container/Browser mit einem POSIX-Tag (`en-US@posix`), wirft jeder
Tick einen `RangeError`.

Behoben:

- `src/lib/format.ts`: `safeLocale()` (POSIX-Modifier/Underscore bereinigen, per
  `Intl.getCanonicalLocales` validieren, sonst `en`) und `dateTime(ms, locale)`
  (datumslokalisiert, wirft nie).
- `PriceChart.tsx`: `localization: { locale: safeLocale(locale) }` in der Chart-Konfiguration
  plus Live-Update im Locale-Effekt – die Zeitachse folgt damit der **App**-Sprache statt der
  Browsersprache.
- `MagnifierModal`, `PatternsModal`, `AlertsPanelModal`: `toLocaleString()/toLocaleTimeString()`
  → `dateTime(ms, locale)` (de `28.09.26, 19:00`, ru `28.09.2026, 19:00`).

Nachweis: Terminal mit erzwungenem `navigator.language = 'en-US@posix'` → **0 Page-Errors**,
Datumsangaben korrekt lokalisiert, Canvas unverändert 1508×634.

### Aufgeklärt, kein Defekt

- Der Chip **„Verbinde neu · Versuch n/5"** hängt allein am Feed-Status (`status === 'reconnecting'`),
  nicht am Datenbestand – in der Sandbox gibt es keine WebSocket-Verbindung, deshalb bleibt er
  stehen. Mit erreichbarem Feed verschwindet er.
- Die 9 `503`-Meldungen stammen aus dem Fixture-Layer (Nicht-Kline-Aufrufe) und sind gewollt.

---

## 6. ✅ Modul M4 — i18n-Layout-Stresstest

5 Sprachen × 6 Seiten × 4 Viewports (360/390/768/1024) plus **jedes** Werkzeug-Modal
in 5 Sprachen × 2 Viewports (360/1024) = 170 Modal-Läufe. Geprüft wurden Overflow,
abgeschnittener Text, rohe i18n-Keys, Dialog-Fit und Scrollbarkeit.

### Ergebnis

| Suite | Umfang | Ergebnis |
|---|---|---|
| Seiten (eigener Sweep) | 120 Kombinationen | **120/120 sauber** |
| Werkzeug-Modals (eigener Sweep) | 170 Läufe | **132 ok**; die 38 „Fehlschläge" sind reine Toggle-Buttons (Whale-Flow, aVWAP, S/R Auto, Divergenzen) — sie öffnen definitionsgemäß keinen Dialog. **0 echte Befunde** |
| Projekt-Suite `npm run qa:i18n-layout` | 110 Checks (5 Sprachen × 6 Viewports, 320 px → 3440 px) | **110/110** (vorher 108/110) |

### 🔧 Sieben echte Layout-Bugs gefunden und behoben

Alle entstanden durch **lange Wörter in festen Rastern** bzw. **nicht umbruchfähige
Aktionsleisten** — genau die Klasse von Fehlern, die von Übersetzern ausgelöst wird
und in der Quellsprache unsichtbar bleibt.

| # | Stelle | Symptom (gemessen) | Fix |
|---|---|---|---|
| 1 | `NeonPanel` (Panel-Header) | Aktionsleiste kann nicht umbrechen → auf 360 px **45 px neben dem Panel** (Werkzeugleiste) bzw. 26 px (Pane-Header); `overflow-hidden` schnitt sie weg | Header `flex-wrap` + `gap-y`, Aktionsleiste `flex-wrap justify-end` |
| 2 | `ChartGrid` Pane-Aktionen | Zeitrahmen/Symbol/+ /Vollbild/PNG/CSV = ~352 px in 326 px → 26 px Überhang | Aktionszeile `flex-wrap justify-end` |
| 3 | `DrawingToolbar` Werkzeuggruppe | 9 Buttons ≈ 380 px → „Alle Zeichnungen löschen" **lag 45 px außerhalb und war unsichtbar** | Werkzeuggruppe `flex-wrap` |
| 4 | `BacktestModal` / `RiskModal` / `JournalModal` | Lange Wörter („Матожидание", „Trefferquote", „Recompensa/Riesgo") sprengten ihre Rasterspalte (7–23 px) | Labels `[overflow-wrap:anywhere]` — bricht im Wort und senkt die min-content-Breite |
| 5 | `RatingsModal` | „Verkaufen" blieb 45 px breit (min-content ≈ 88 px) → Textüberhang 44 px, RS-Zeile bis 40 px | Zeile `flex-wrap`, Gauge auf Phones schmaler, Textspalte `min-w-[9rem]` |
| 6 | `AlertsPanelModal` / `ScriptLabModal` | Buttonzeilen wurden auf 119/46 px gequetscht („Benachrichtigungen aus" 40 px Überhang) | `flex-wrap` + `shrink-0` |
| 7 | `Dropdown` (Zeitrahmen/Symbol) | Wrapper quetschte unter die Inhaltsbreite (43 px Box bei 52 px Button) | Wrapper `shrink-0` |

### 🔧 Smartlink-Leiste (Werbung) — drei Fixes in `ads-kit/smartlinks.css` + `SmartlinkCta`

| # | Symptom | Fix |
|---|---|---|
| 8 | Badge brach mitten im Wort („Patrocinad/o", bis 13 px Überhang) | `white-space: nowrap` + `flex: 0 0 auto` |
| 9 | Emoji-Icon verlor 3–4 px (Flex-Schrumpfung) | `.nc-sl-strip-icon { flex: 0 0 auto }` |
| 10 | Landing-CTA (`SmartlinkCta`) war intrinsisch 306 px breit und lief auf 320-px-Geräten 20 px über den Rand, Badge-Kante abgeschnitten | Button `max-w-full`, Label umbruchfähig — Desktop bleibt exakt einzeilig/32 px hoch |

### ✅ Bewusst nicht geändert (kein Defekt)

- **Tofu-Kästchen im ZH-Terminal** vor dem CJK-Font-Setup waren eine Sandbox-Lücke
  (keine CJK-Schrift im Container), kein App-Fehler. Mit installierter Schrift ist ZH
  vollständig lesbar und alle 5 Sprachen messen gleich.
- Die 10 verbleibenden Treffer meiner ersten Heuristik (`v0.1.0`, Kurszahlen wie `104.9`)
  waren **Messfehler meines Scanners** (Regex hielt Punkt-Zahlen für i18n-Keys) — der
  Scanner wurde korrigiert, nicht die App.
- `sr-only`-Elemente melden konstruktionsbedingt `+277px` Überhang; sie sind 1×1 px und
  für Screenreader gedacht.

---

## 7. ✅ Modul M5 — A11y-Deep-Dive

Barrierefreiheit ist der Bereich, in dem sich „fertig" und **„besser als alle
Alternativen"** trennen: TradingView & Co. haben in ihren Dialogen reihenweise
fehlende Fokusringe, Fokusverlust nach dem Schließen und unbenannte Icon-Buttons.
Dieses Modul prüft die Achsen aus dem Auftrag **messend**, nicht nach Gefühl.

| Achse | Was gemessen wird | Umfang |
|---|---|---|
| **S1** Fokus-Sichtbarkeit | jeder per Tab erreichte Control: sichtbarer Ring? Kontrast ≥ 3:1 (WCAG 1.4.11), dunkel **und** hell | 26 Controls + Light-Skin |
| **S2** Tab-Ordnung & Fokus | 19 Dialog-/Overlay-Flächen: Anfangsfokus, Tab-Zyklus ohne Ausbruch, Tab-Reihenfolge ≡ DOM-Reihenfolge (zyklisch), Shift+Tab-Wrap, Escape schließt, Fokus kehrt zum Auslöser zurück, 0 Konsolenfehler | 19 × 7 Checks, de |
| **S2b** Menü-Tastatur | 4 ToolMenüs: ArrowDown öffnet + fokussiert Eintrag 1, Pfeile/Home/End wandern, Escape schließt + Fokus zurück auf den Trigger | 16 Checks, de |
| **S3** Light-Theme-Kontrast | jedes Textknoten-Paar auf `/` und `/terminal` + Dialog, WCAG AA (4.5:1 / 3:1 large) | de, Gradient-Flächen markiert |
| **S3b** Token-Matrix | jedes Text-Token gegen jede Fläche in **allen 5 Skins** (erwischt Kombinationen, die nie gleichzeitig sichtbar sind) | 5 Skins × 30 Paare |
| **S4** Icon-Namen | zugänglicher Name vorhanden **und** lokalisiert (de ≠ en als Detektor für hart kodierte Labels) | de + en, inkl. aller 15 Dialog-Schließen-Buttons |
| **S5** Semantik | `<html lang>`, doppelte Ids, `img alt` | 3 Routen |

**Ergebnis:** Erster Lauf **102 ok / 33 Befunde** → nach den Fixes **175 ok / 0 Befunde**
(262 s; S1 4 · S2 133 · S2b 16 · S3 5 · S3b 5 · S4 3 · S5 9; `--locale`/`--quick` als Schalter, Report unter `/tmp/nc-shots/m5-report.json`).
Der Screenshot-Satz entsteht nebenbei (`m5-light-*.png`, `m5-cta-*.png`).

### 🔧 Elf echte Befunde gefunden und behoben

| # | Stelle | Befund (gemessen) | Fix |
|---|---|---|---|
| 1 | `tailwind.config.js` (`bull`/`bear`) | Die Utilities waren **feste Hex-Werte** (`#00ff9d`, `#ff2e63`) statt Theme-Variablen. Im hellen Skin ergab das **1.24:1** für Ticker, Mock-Chart und Session-Werte — während der Canvas über `src/lib/chart-theme.ts` schon `--nc-bull` las: **Text und Kerzen widersprachen sich im selben Bild.** | `bull`/`bear` → `hsl(var(--nc-bull) / <alpha>)`; das markenfeste Neon bleibt als `neon.bull`/`neon.bear` erhalten. Hell jetzt 5.11:1 / 5.64:1 |
| 2 | `ui/ToolMenu.tsx` | Nach dem Schließen **jedes** über ein Menü geöffneten Dialogs lag der Fokus auf `<body>` (15 von 19 Flächen): das angeklickte Menü-Item fällt beim Öffnen aus dem DOM und war damit das Ziel der Fokus-Rückgabe. Tastaturnutzer landeten nach jedem Dialog wieder am Seitenanfang. | Fokus wird **vor** `item.onClick()` an den Trigger zurückgegeben (gleiches Muster wie `Dropdown.selectItem`) → „→ Tools/Edge/Analyse/Mehr" |
| 3 | `layout/CommandPalette.tsx` | Die Palette war kein echter Dialog: Escape wirkte nur, solange der Fokus im Panel stand, und **Tab lief durch die Seite dahinter** (Header, Toolbar, Canvas). | Dokumentweites Escape (Capture) + Tab-Falle über die neue `focus-trap`-Hilfe |
| 4 | neue Datei `src/lib/focus-trap.ts` | Beide Fokusfallen (Modal, Palette) hielten `tabindex="-1"`-Buttons für Tab-Stationen — **und `disabled`-Buttons ebenfalls**, weil `disabled` den `tabIndex` nicht ändert. Folge: „letztes Element" war falsch, der Fokus blieb am Dialogrand stehen. | Gemeinsame Hilfe mit der einzig korrekten Regel (`tabIndex >= 0`, `:disabled` raus, `aria-hidden` raus); Tab wird nur abgefangen, wenn der Dialog sonst verlassen würde (Radiogruppen behalten ihren einen Tab-Stop). Eigenständig geprüft: `journal` übersprang vorher Index 11, `backtest` Index 5 |
| 5 | `ui/Modal.tsx` | Dialoge mit JSX-Titel hatten **keinen zugänglichen Namen** (das Share-Modal heißt für Screenreader nur „dialog"); die Prop `labelledBy` war deklariert, aber nie gelesen. | `useId()` + `aria-labelledby` auf die Überschrift → „Dieses Setup teilen"; tote Prop entfernt |
| 6 | `ui/Modal.tsx`, `CommandPalette.tsx`, `support/SupportNudge.tsx` | **Hart kodierte englische Labels**: `close` in allen 15 Dialogen, `Close` in der Palette, `dismiss` ×2 im Support-Nudge — in jeder Sprache gleich (S4-Detektor: de == en). | `common.close` / `support.dismiss` (Keys existierten bereits in allen 5 Locales) |
| 7 | `search/SmartSearch.tsx` | `focus:outline-none` auf dem Suchfeld **killte den globalen `:focus-visible`-Ring** — das Feld war per Tastatur fokussierbar, aber unsichtbar markiert. | Klasse entfernt (Ring: 2 px + 4 px Halo) |
| 8 | `styles/globals.css` (alle 5 Skins) + `SiteFooter` | Token-Matrix: `--nc-faint` lag **in allen fünf Skins** unter AA (3.16–3.96:1), `--nc-warning` 3.20:1 (light), `--nc-secondary` 3.81:1 (acid), `--nc-primary` 4.26:1 (violet). Zusätzlich: `text-faint/80` im Footer = 2.56:1 und `text-faint/70` an den Ad-Slot-Ecken (8 px, `AdManager`/`SidebarBanner`). | Neue Lightness-Werte (faint 42→50 / 45→55 / 54→43 / 38→48 / 46→56 %, light warning 40→32 %, acid secondary 57→65 % + dunkle Ink, violet primary 62→65 %) → **alle 30 Token-Paare × 5 Skins ≥ 4.5:1**; sämtliche Deckkraft-Varianten auf Text (`/80`, `/70`) entfernt — **kein Text-Token mehr unter AA, in keinem Skin** |
| 9 | `tools/WatchlistPopover.tsx` | Der Popover ließ sich **nur über den Chip selbst** schließen (kein Escape, kein Klick daneben); die Zeilen mit `role="button"` reagierten auf Enter, aber nicht auf Space; das Panel hatte keinen Rollennamen. | Escape + Outside-Click, `role="dialog"` + `aria-label`, Space-Handling |
| 10 | `tools/HeatmapModal.tsx` | Der OKX-Fallback-Promise bekam seinen `.catch()` erst **im** Fehlerpfad von Binance — fallen beide Börsen aus, meldet der Browser eine unbehandelte Rejection („Failed to fetch"). | Fallback-Promise sofort behandeln (`null` läuft in den bestehenden Fehlerzustand) |
| 11 | `ui/ToolMenu.tsx` | Die vier Toolbar-Menüs trugen `role="menu"`, hatten aber **keine Pfeiltasten-Navigation** — das Chart-Typ-Dropdown daneben konnte sie (Inkonsistenz im selben Balken). | ArrowDown öffnet + fokussiert den ersten Eintrag; Pfeil/Home/End wandern zyklisch, Escape schließt und setzt den Fokus auf den Trigger, Tab schließt das Menü (S2b prüft alle vier) |

### ✅ Aufgeklärt, **nicht** geändert (kein Defekt)

- **Der „3 px dunkle Fokusring" der Header-CTA** (Kontrast 1.05:1) war ein
  **Messartefakt**: `getComputedStyle` direkt nach dem Fokus liefert den
  Startwert der `transition-all`-Animation (Outline-Breite und -Farbe
  interpolieren von Browsergrundwerten auf den Ring). Keine CSS-Regel im Build
  setzt 3 px oder eine Outline-Farbe; nach 260 ms Wartezeit messen alle Controls
  den korrekten Ring (2 px + 4 px Halo, 14:1). Die Suite wartet jetzt.
- **Gradient-Flächen** (gesponserte Chips der Smartlink-Leiste, Neon-Trägerflächen)
  lassen sich aus `background-color` nicht berechnen; sie werden gezählt und
  ausgewiesen (6–8 pro Seite) statt falsch-negativ gemeldet. Sichtprüfung im
  hellen Skin: dunkle Navy-Chips mit heller Schrift.
- **`BTC/USDT` als Name eines Icon-Buttons** im Indikator-Modal ist korrekt: Ticker
  sind sprachneutral (die Suite klassifiziert sie als solche).
- **Per Shortcut geöffnete Palette:** Der Fokus kehrt zu `<body>` zurück — das ist
  der Zustand *vor* dem Öffnen (es gab keinen Auslöser-Element-Fokus), also korrekt.
- Der Popover der Watchlist ist **bewusst nicht-modal**: Anfangsfokus bleibt beim
  Chip, geprüft werden Name, Escape, Fokus-Rückkehr (Trap wäre hier falsch).

### 📋 Umgebungshinweise

- Die A11y-Suiten laufen **ohne** Fixture-Feed (Werkzeuge zeigen ihre leeren
  Zustände) — das ist Absicht: geprüft werden Struktur, Fokus und Kontrast, nicht
  Daten. Die Fehlerachse („0 Konsolenfehler pro Fläche") läuft trotzdem mit und
  deckt genau solche Fälle wie Befund 10 auf.
- Das Projekt-Gate `scripts/release-audit/m4-a11y.mjs` bleibt grün: **48/48**.
  Der Layout-Stresstest aus M4 (`qa:i18n-layout`) wurde als Regressionsnetz erneut
  gefahren (5 Sprachen × 6 Viewports).

---

## 8. ✅ Modul M6 — Werbung/Monetarisierung im Fill-Fall

Bis hierher war jede Prüfung **werbefrei** (Puppeteer schaltet die Ad-Schicht ab).
Genau das ist das Risiko: die interessanten Zustände — *Kreativ füllt*, *kein Fill*,
*echter Blocker*, *Spender* — waren nie gemessen. M6 holt das nach, mit
**Ad-Fixtures**: die Delivery-Skripte werden im Browser abgefangen und durch Stubs
ersetzt, die sich wie die echten verhalten (Native-Banner füllt sein Container-Div,
Social Bar verankert sich am Boden, Popunder armiert sich, Smartlink-Ziel antwortet).
Damit sind alle Zustände deterministisch und beliebig oft prüfbar.

| Stufe | Was gemessen wird | Umfang |
|---|---|---|
| **S0** Grundrauschen | CLS der App **ohne** jede Werbung (3 Kombis: Landing 1440, Terminal 390/1440) — Vergleichsbasis für jede Ad-Messung | 6 Checks |
| **S1** QA-Guard | `navigator.webdriver` ⇒ keine Ad-Requests, keine Slots | 2 |
| **S2** Social Bar | lädt, Höhe in `--nc-socialbar-h`, überdeckt **keine feste/sticky UI**, Terminal reserviert sie, Pause unter Dialogen | 9 |
| **S4** Sidebar-Rail 160×600 | Fill ohne Clipping/Überhang, Kollaps ohne Fill, kein Sprung | 7 |
| **S5** Header-Native-Banner | Fill exakt in der Reserve, **kein Beschnitt**, Kollaps ohne Fill, kein Sprung | 6 |
| **S6** Terminal-Slots | Container-Div je Placement, Fill, kein Clipping, keine doppelte Id, Kollaps ohne Fill | 10 |
| **S7** Ad-Block-Wall | Erkennung, Öffnung, Escape, Cooldown, **kein Wiederauftauchen**, Pre-Paint-Unterdrückung | 8 |
| **S8** Spender-Grace | 48 h/5 Tage: keine Requests, keine Bar, kein `?adwall=1`, kollabierte Slots | 4 |
| **S9** Popunder | genau ein Popunder pro Session, feuert auf den Folge-Klick, Cap hält über Reload | 3 |
| **S10** Smartlinks | Kit-CSS/Skript, `rel="noopener"`, Konsolenfehler, CLS-Delta | 8 |
| **S11** Fehler-Sweep | keine App-/Seitenfehler in der ganzen Suite (erwartete Abbruch-Meldungen der No-Fill-/Blocker-Modi gefiltert) | 1 |

**Ergebnis:** Erstlauf **29 ok / 16 Befunde** → nach den Fixes **64 ok / 0 Befunde**
(158 s). Zusätzlich auf dem **Auslieferungs-Build** (ohne `NEXT_PUBLIC_ADSTERRA_NATIVE*`,
also ohne Terminal-Slots) gefahren: **57/57 Checks, 0 Befunde**.

### 🔧 Neun echte Befunde gefunden und behoben

| # | Stelle | Befund (gemessen) | Fix |
|---|---|---|---|
| 1 | `ads/AdManager.tsx` (`SlotTag`) | Der „Gesponsert"-Eck-Tag stand **absolut positioniert mitten im Widget**: der Social-Bar-Scan hielt ihn für ein Bottom-verankertes Overlay und setzte `--nc-socialbar-h`, wodurch das Terminal 44 px Leerraum reservierte. | Tag ist jetzt `sticky` statt `absolute` — In-Flow, ohne die Reserve-Geometrie zu stören |
| 2 | `ads/AdManager.tsx` (`AdSlot`) | Die Terminal-Slots waren die **einzigen** Werbeflächen ohne Spender-/QA-Guard (Social Bar, Header-Banner, Rail, Smartlinks haben ihn): ein Spender bekam im Terminal weiter Werbung, Puppeteer lud Ad-Skripte. | gleiche Doctrine in `AdSlot` |
| 3 | `ads/AdManager.tsx` (`AdSlot`) | **Inkonsistente Slot-Maße**: Desktop-Rail reservierte 176×600 für ein 4:1-Widget, mobil 110 px Mindesthöhe für ~94 px, **keine** Kollaps-Logik (toter Streifen ohne Fill) und **kein Container-Div** für `invoke.js` — der Loader lädt fehlerfrei und rendert nichts. | Container-Id wird aus der Placement-URL abgeleitet, Reserve = Widget-Format (4:1, geklammert), Poll-Kollaps ohne Fill, doppelte Placement-Ids dedupliziert |
| 4 | `ads/AdManager.tsx` (Social-Bar-Messung) | Die gemessene Höhe reservierte nur der Whale-Ticker: die Bar lag **über** der mobilen Werkzeugleiste und der Chart-Zeitachse (Screenshot: „Trotzdem aktivieren" war halb verdeckt). | Terminal reserviert die Höhe (Mobile unten **und** Desktop-Grid), Fokusring-Kontrast der Werkzeugleiste bleibt unberührt |
| 5 | `styles/globals.css` + `TerminalShell` + `SidebarBanner` | **Drei gemessene CLS-Quellen in der Werbe-Schicht**: Header-Banner beschnitt 352 px Kreativ auf 160 px (`max-height`), die Terminal-Slots quetschten die Chart-Zeile auf **0 px**, und die Sidebar-Rail reserveierte beim Blocker eine tote 176-px-Spalte (0,109 CLS im Erstbesuch). | breitenbegrenzte 4:1-Reserve (kein Beschnitt), Klammerung + Mindesthöhe des Grids, Rail-Wrapper unter der Pre-Paint-Unterdrückung |
| 6 | `layout/ThemeBootScript.tsx` | Spender/Blocker erfuhren die *Unterdrückung* erst nach der Hydration — die reservierten Flächen verschwanden im ersten Frame ⇒ gemessen **0,109 CLS** für Spender. | Boot-Skript setzt `data-nc-adsuppressed` **vor dem ersten Paint** (Spender-Grace aus dem Store-Payload, `nc-adcheck`-Cache, webdriver); CSS blendet die Flächen aus, React-Baum und Hydration bleiben identisch |
| 7 | `ads/AdManager.tsx` (Wall + Retry) | Nach Escape/X setzte nur der Dismiss-Button den 7-Tage-Cooldown. Der Retry-after-Wall-Close lief trotzdem und **riss die Wall wieder auf** ⇒ Dialog ließ sich nicht schließen (2 Checks). | Cooldown prüft jetzt jeder Pfad; der Retry unterbleibt, solange der Cooldown gilt |
| 8 | `TerminalShell` + `ads-kit/smartlinks.css` | Der Sponsor-Streifen war `empty:hidden`; das Kit mountet erst im Idle und schob die Grid-Zeile beim Terminal um **85 px** nach unten (0,28 CLS). | Streifen reserviert dauerhaft eine 44-px-Zeile; die Chips bleiben einzeilig und scrollen horizontal (Höhe wird sprach-/breitenunabhängig) |
| 9 | `layout/LocaleDetectBanner.tsx` | Kein Ad-Befund, aber vom CLS-Vergleich aufgedeckt: der client-only Sprachhinweis stand **in-flow** in der Header-Zone und verschob beim ersten Besuch mit abweichender Browsersprache die ganze Seite (0,056 Terminal mobil / 0,073 Landing / 0,239 Terminal Desktop). | aus dem Fluss genommen (`absolute` in der Header-Zone, 0 CLS) — Kopf-Leiste bleibt sichtbar, der Sticky-Header legt sich beim Scrollen darüber |

### ✅ Aufgeklärt, **nicht** geändert (kein Defekt)

- **Transiente Überdeckung durch die Social Bar:** Eine bodenverankerte Bar liegt
  zwangsläufig über dem, was gerade am Seitenende einer *scrollenden* Seite steht.
  Die Suite unterscheidet deshalb fest/sticky verankerte UI (Dock, Leisten,
  Footer-Ticker → **immer** 0 Treffer) von transienter Überdeckung (≤ 6, wie ein
  Sticky-Header oben) und die Reservierung wird separat belegt.
- **Popunder zählt 3 Skript-Tags** statt einem: der Publisher-Code ist ein
  Loader-Pärchen mit Domain-Fallback (2 Tags) plus einmalige Session-Injection —
  die Suite zählt die ausgelösten Skripte am Netz, die Session-Logik separat.
- **Einmalige Sprünge beim Blocker-Erstbesuch** (≤ 0,11 CLS): Ein Blocker wird erst
  *nach* dem Fehlschlag erkannt (detect-on-failure). Der Cache greift ab dem
  zweiten Dokumentaufbau pre-paint — beides wird als eigene Checks ausgewiesen.
- **Gradient-Flächen** in der Smartlink-Leiste bleiben „nicht messbar" (siehe M5).
- **`navigator.webdriver`** schaltet die ganze Ad-Schicht ab (QA/CI) — M6 prüft
  beides: den Guard selbst **und** die Stubs mit gespooftem `webdriver=false`.

### 📋 Umgebungshinweise

- Die Ad-Fixtures liegen im Repo (`scripts/audit-sandbox/ad-fixtures.mjs`), die
  Suite heißt `run-m6-ads.mjs`. Der **Full-Fill-Build** für die Slot-Stufen:
  `NEXT_PUBLIC_ADSTERRA_NATIVE_MOBILE=… MOBILE/DESKTOP=<invoke.js-URLs> npx next build`.
  Ohne diese Variablen überspringt die Suite die Slot-Stufen bewusst
  (`S6: 3 ok / 0`) — ein *kollabierter* Slot wird dabei nicht mit einem *nicht
  konfigurierten* verwechselt.
- Stub-Container-Ids werden wie im echten `invoke.js` aus dem URL-Hash abgeleitet;
  ein fest verdrahtetes Div hätte ein fremdes Placement nie gefüllt (Fehlmessung).
- `Session-Cap` des Popunders hängt an `sessionStorage`; S9 arbeitet daher in einem
  eigenen Browser-Context wie alle Stufen.

---

## 9. ✅ Modul M7 — Performance / Core Web Vitals

Gemessen wird der **Produktionsbuild** (`next build --webpack` + `next start`) unter
**4× CPU-Bremse und Slow-4G-Netz** (CDP-Emulation) — also ungefähr das, was ein
Mittelklasse-Handy im Mobilfunknetz sieht. Die Transfergrößen kommen aus
`encodedDataLength` **je Request**, nicht aus dem Bundle-Report: „kritisch" heißt
hier *vor dem `load`-Event fertig*, „nachgeladen" alles danach. Das ist die
ehrlichere Zahl, weil sie die echte Ladelinie inklusive Lazy-Chunks zeigt.

| Stufe | Was gemessen wird | Umfang |
|---|---|---|
| **S1** Ladeleistung | Landing + Terminal gedrosselt: TTFB, FCP, LCP (+ LCP-Element), CLS, TBT, Long Tasks, Transfer je Ressourcentyp | 12 Checks |
| **S2** Bundle | Kritisches vs. nachgeladenes JS je Seite, größte Chunks namentlich | 4 |
| **S3** Fonts je Sprache | Transfer + Dateizahl für de/ru/zh, Preload-Anzahl, **Cyrillic nur bei Bedarf** (Nachweis über die `unicode-range`-Regeln) | 14 |
| **S4** Interaktion | INP-Kandidat (Event-Timing) und Menü→Dialog-Latenz bei 4× CPU, inklusive Nachladen des Dialog-Chunks; Long Tasks der Startphase | 5 |
| **S5** Auslieferung | Cache-Header (immutable, 1 Jahr) und Kompression für HTML/JS/CSS/Fonts | 6 |

**Ergebnis:** Baseline **29 ok / 7 Befunde** → nach den Fixes **41 ok / 0 Befunde**.

**Regression nach den Umbauten:** M5-A11y **175/175** · M6-Werbung **57/57**
(Auslieferungs-Build) · i18n-Layout-Stresstest **110/110** · Funktions-Smoke
(`npm run qa:perf:smoke`: Suche, Teilen, Support) **6/6** — der Lazy-Umbau hat keine
bestehende Prüfung gebrochen. `tsc --noEmit` 0 Fehler, ESLint ohne Befund.

| Metrik (4× CPU, Slow 4G) | vorher | nachher |
|---|---|---|
| Terminal LCP | 3784 ms | **1116 ms** |
| Terminal CLS | 0,110 | **0,0004** |
| Landing LCP · CLS · TBT | 1124 ms · 0,000 · 190 ms | **1088 ms · 0,000 · 168 ms** |
| Landing kritisches JS | 220,9 kB | **188,3 kB** (Budget 200) |
| Terminal kritisches JS | 365,0 kB | **255,8 kB** (Budget 300) |
| Schriftdateien je Seite | 17 Dateien / 204,2 kB | **9 Preloads**; de 12/147,3 · ru 11/130,5 · zh 10/122,6 kB |
| INP · Dialog-Latenz (4× CPU) | 715 ms / 1974 ms (beides Messartefakt) | **4 ms / 38 ms** |

### 🔧 Sechs echte Befunde gefunden und behoben

| # | Stelle | Befund (gemessen) | Fix |
|---|---|---|---|
| 1 | `app/[locale]/layout.tsx` + `tailwind.config.js` | **17 Schriftdateien / 204,2 kB auf jeder Seite** — davon acht kyrillische (≈ 78 kB), die nur /ru braucht: `next/font` hängt an jedes Subset einen Preload-Hinweis, unabhängig von der Sprache. | Zweiter `next/font`-Aufruf je Familie für `cyrillic` mit `preload:false`; beide Variablen hintereinander in der Tailwind-Kette, sodass der Browser je Glyph über `unicode-range` wählt (9 Preloads, Cyrillic lädt erst beim ersten kyrillischen Zeichen) |
| 2 | `layout/ThemeBootScript.tsx` + `styles/globals.css` + `chart/DrawingToolbar.tsx` | Die Touch-Warnung der Zeichenwerkzeuge stand **unbedingt** im Terminal-Baum (nur per CSS versteckt) und schob beim Mount das Chart-Pane von `[420,424]` auf `[614,231]` ⇒ **CLS 0,110** beim Erstbesuch. | Warnung hängt jetzt an einer **Pre-Paint-Klasse**: das Boot-Skript setzt `data-nc-touch='1'` (`pointer: coarse` / Touch-Punkte), CSS blendet sie aus — der Sprung ist beseitigt, bevor das erste Paint passiert (CLS 0,000) |
| 3 | `components/ui/LazyGate.tsx` (**neu**) + `terminal/TerminalShell.tsx` | 15 Modals sowie On-Chain- und Pro-Metrics-Dock lagen im Erstkontakt-Bundle des Terminals ⇒ **365,0 kB** kritisches JS, TBT 383 ms mit 9 Long Tasks. | `LazyGate` mountet erst beim ersten Öffnen (`active`) bzw. beim Vorwärmen (`warm`), 15 Komponenten als `dynamic(…,{ssr:false})`; `warmToolChunks()` lädt Backtest/Risk/Journal/Alerts/Screener nach 3 s Idle nach ⇒ kritisch **255,8 kB**, der Dialog-Chunk steht in 38 ms |
| 4 | `components/search/SmartSearch.tsx` + `store/useExchangeSelection.ts` + `lib/exchanges.ts` + `ads/AdManager.tsx` | Die Kopfzeilen-Suche hing am Layout-Baum **jeder** Seite und zog die Such-Engine (DEX-Adapter + CEX-Katalog), das GoPlus-Audit, den Börsen-Infrastruktur-Chunk (alle zwölf Venue-Hosts, ≈ 20 kB gzip) und die beiden Monetarisierungs-Dialoge mit ⇒ Landing **220,9 kB** kritisch, obwohl die Startseite nichts davon benutzt. | `isCexExchange` als Leaf-Guard nach `lib/exchanges`; Region-/Börsen-Probe (`exchangeProbe`) lädt der Bootstrap dynamisch; Such-Engine, `cex-universe` und GoPlus-Audit kommen erst beim Tippen bzw. beim ersten Treffer; Support- und Teilen-Dialog hängen hinter `LazyGate` ⇒ Landing **188,3 kB** |
| 5 | `package.json` (`browserslist`) | Ohne Zielbrowser-Angabe transpilierte Next für sehr alte Browser — Mehrkosten in jedem Chunk. | browserslist auf gepflegte Browser (Chrome/Edge/FF ≥ 111, Safari/iOS ≥ 16.4, Opera ≥ 97) statt „last 2 versions/dead" |
| 6 | `scripts/audit-sandbox/run-m7-perf.mjs` | **Zwei Checks konnten nie grün werden** — beide Messfehler: „Dialog steht ≤ 1200 ms" addierte feste Skript-Wartezeiten (400 + 1500 ms) zu *jedem* Lauf (≈ 1974 ms), und der INP las Event-Timing-Einträge, bevor der Browser sie auslieferte (0 Events ⇒ Check still wirkungslos). | S4 pollt jetzt **im Browser** (25-ms-Raster, `performance.now()`) bis Menü bzw. Dialog stehen; vor dem Event-Timing-Read wird gewartet und der Check verlangt ≥ 1 Event; die Startphase-Longtasks werden vor dem Zähler-Reset gesichert |

### ✅ Aufgeklärt, **nicht** geändert (kein Defekt)

- **Die Untergrenze ist das Framework:** Next-Client-Runtime (64,8 kB gzip) plus
  React/React-DOM (`framework` + `4bd1b696`, ≈ 126 kB gzip) sind rund zwei Drittel
  der 188,3 kB. Weiteres Splitten würde Bytes nicht sparen, sondern nur die
  Ladelinie verketten (der Chunk müsste vor der ersten Interaktion nachkommen).
- **Der `polyfills`-Chunk** (110 kB roh) steht im Bundle-Report, wird aber als
  `noModule`-Legacy-Skript ausgeliefert und von modernen Browsern **nie
  angefordert** — im Netz-Mitschnitt taucht er als Transfer nicht auf.
- **Das LCP-Element** ist auf beiden Seiten ein Textabsatz (Landing: Hero-Absatz,
  Terminal: Kurszeile), nicht das Canvas. Das Chart wächst danach ohne
  Layoutsprung — CLS 0,000.
- **Das Terminal bleibt schwerer als die Landing** (255,8 vs. 188,3 kB kritisch):
  Chart-Engine (`lightweight-charts`, 54,8 kB gzip) und Feed-Infrastruktur werden
  erst geladen, wenn wirklich gerendert wird; die Startseite bleibt davon frei.
  Weitere Terminal-Chunks (100,7 kB) kommen nach dem `load` und stören die
  Interaktionsbereitschaft nicht.
- **Transiente Long Tasks** von 142–156 ms in der Startphase stammen aus der
  Chart-Initialisierung und dem ersten Feed-Batch; der TBT liegt mit 305 ms
  (Terminal) klar unter der 600-ms-Grenze.

### 📋 Umgebungshinweise

- Suite: `npm run qa:perf` bzw. `node scripts/audit-sandbox/run-m7-perf.mjs [--quick] [--compare <report.json>]`
  gegen `next start` auf `:3000`. Report `/tmp/nc-shots/m7-report.json`,
  Screenshots `/tmp/nc-shots/m7-*.png`. `--quick` kürzt nur die Idle-Fenster.
- `--compare` stellt zwei Läufe nebeneinander (Baseline gegen Fix) — alle Zahlen
  dieser Tabelle stammen aus solchen Paaren.
- Die Suite **prüft die App, nicht die Sandbox**: geblockte Börsen-Hosts erzeugen
  fehlgeschlagene Requests, zählen aber nicht als Befund (Noise-Filter).

---

## 10. Vorschlag für die nächsten Schritte

| Reihenfolge | Modul | Inhalt | Warum jetzt |
|---|---|---|---|
| 1 | ~~**M3a**~~ | ~~mobiler Terminal-Umbau~~ | ✅ **erledigt** (Abschnitt 4) |
| 2 | ~~**M3b**~~ | ~~Chart-Engine-Prüfung~~ | ✅ **erledigt** (Abschnitt 5, inkl. Fixture-Feed statt Netzzwang) |
| 3 | ~~**M4**~~ | ~~i18n-Layout-Stresstest~~ | ✅ **erledigt** (Abschnitt 6, 10 Fixes) |
| 4 | ~~**M5**~~ | ~~A11y: Fokusringe, Tab-Reihenfolge in Modals, Kontrast im Light-Theme, Screenreader-Namen der Icon-Buttons~~ | ✅ **erledigt** (Abschnitt 7, 175/175 Checks, 11 Fixes) |
| 5 | ~~**M6**~~ | ~~Werbung/Monetarisierung im Fill-Fall~~ | ✅ **erledigt** (Abschnitt 8, 64/64 Checks, 9 Fixes) |
| 6 | ~~**M7**~~ | ~~Performance: Bundle, LCP/INP/CLS auf Mid-Range-Mobile, `next/font`-Subsets~~ | ✅ **erledigt** (Abschnitt 9, 41/41 Checks, 6 Fixes) |
| 7 | ~~**Vollverifikation**~~ | ~~alle Suiten am Stück auf dem Auslieferungs-Build~~ | ✅ **erledigt** (Abschnitt 13: 846 Checks grün, 0 rot) |
| 8 | ~~**M8**~~ | ~~Robustheit: Netzabbruch, 429-Overlay, Speicher-voll, Sekundär-Fetch-Härtung (O3)~~ | ✅ **erledigt** (Abschnitt 14, 54/54 Checks, 4 Fixes) |
| 9 | **M9** | Deploy-Pfad Cloudflare, Domain, Sitemap-Einreichung, Endkontrolle | Abschluss (Modul M7 im Audit ist bereits grün) |

---

## 11. Arbeitsumgebung / Reproduktion

Die Prüfungen liefen in einer Sandbox ohne Zugang zu Börsen/DEX/Fonts (nur npm + GitHub).
Damit der Produktionsbuild trotzdem echt geprüft werden kann:

```bash
# 1) Sandbox einrichten (Chromium, AL2023-Libs, CJK-Schrift, Font-Mock)
node scripts/audit-sandbox/bootstrap.mjs

# 2) Build (offline-fähig: echte Fonts über fontsource gemockt)
#    Achtung: ABSOLUTER Pfad – next/font löst relativ zu seinem eigenen Modul auf
NEXT_FONT_GOOGLE_MOCKED_RESPONSES="$PWD/scripts/audit-sandbox/font-mock.cjs" \
NEXT_PUBLIC_SITE_URL=https://nodechart.cc npx next build --webpack

# 3) Server + Suite
npx next start -H 0.0.0.0 -p 3000
LD_LIBRARY_PATH=/tmp/al2023/lib FONTCONFIG_PATH=/tmp/fonts \
  node scripts/audit-sandbox/run-m5-a11y.mjs [--locale de] [--quick]
```

Der Harness samt Fixture-Feed (12 Venues) liegt seit M4 **im Repo**
(`scripts/audit-sandbox/`, siehe dessen `README.md`) und übersteht Snapshots.

Auf einem Rechner mit normalem Internetzugang entfällt der Font-Mock; `npm run build`
funktioniert dort unverändert. Die Projekt-Skripte `qa:features`, `qa:modules`,
`browser-check` und `gui-audit` brauchen `PUPPETEER_EXECUTABLE_PATH` bzw. ein
installiertes Chrome for Testing.

---

## 12. Fixes dieses Durchgangs (Diff-Übersicht)

| Datei | Änderung |
|---|---|
| `ads-kit/app-smartlinks.js` | neues `CONFIG.ITEMS` (+ Doku), `mountSponsorBar()` nutzt `ITEMS` vor `DEFAULT_ITEMS` |
| `public/ads/app-smartlinks.js` | via `npm run ads:sync` gespiegelt (Single Source of Truth bleibt `ads-kit/`) |
| `src/components/ads/SmartlinkKit.tsx` | übergibt die 3 Leisten-Labels lokalisiert per `data-config` |
| `messages/{en,de,es,ru,zh}.json` | +3 Keys `ads.offerBonus/offerPartner/offerContest`; `showcase.waiting` von Entwickler-Platzhalter auf Nutzer-Text |
| `src/components/legal/LegalDocument.tsx` | H1 um `[overflow-wrap:anywhere]` ergänzt |
| `src/styles/globals.css` | `html { overflow-x: clip }` als globales Überlauf-Sicherheitsnetz; `.nc-toolbar-*`-Regeln für die einklappbare Mobile-Toolbar |
| `src/components/terminal/TerminalShell.tsx` | viewport-füllendes Mobile-Layout, schmale Leiste + `data-nc-toolbar`, volle Leiste per Tipp/Chevron, Desktop unverändert |
| `src/components/chart/ChartGrid.tsx` | `min-h-0` am Grid-Wrapper (Panes schrumpfen statt zu wachsen) |
| `src/components/chart/DrawingToolbar.tsx` | Touchscreen-Hinweis: Aktionszeile unter den Text (Text war auf 55 px gepresst) |
| `messages/{en,de,es,ru,zh}.json` | +2 Keys `showcase.toolbar{Collapse,Expand}` |

**Nachtrag Durchgang 2 (M3):**

| Datei | Änderung |
|---|---|
| `src/lib/format.ts` | neu: `safeLocale()` (Intl-feste Locale-Tags) und `dateTime(ms, locale)` |
| `src/components/chart/PriceChart.tsx` | `localization.locale` (validiert, live aktualisiert) – behebt die `RangeError`-Flut der Zeitachse |
| `src/components/tools/MagnifierModal.tsx` | Zeitstempel über `dateTime(ms, locale)` statt `toLocaleString()` |
| `src/components/tools/PatternsModal.tsx` | dito für die Muster-Zeitstempel |
| `src/components/tools/AlertsPanelModal.tsx` | dito für den Alarm-Zeitstempel |

**Nachtrag Durchgang 3 (M4):**

| Datei | Änderung |
|---|---|
| `src/components/ui/NeonPanel.tsx` | Header/Aktionsleiste umbruchfähig (Werkzeugleiste lag 45 px außerhalb des Panels) |
| `src/components/chart/ChartGrid.tsx` | Pane-Aktionszeile `flex-wrap justify-end` |
| `src/components/chart/DrawingToolbar.tsx` | Werkzeuggruppe `flex-wrap` („Alle Zeichnungen löschen" war unsichtbar) |
| `src/components/ui/Dropdown.tsx` | Wrapper `shrink-0` statt Quetschung unter die Buttonbreite |
| `src/components/tools/{Backtest,Risk,Journal}Modal.tsx` | Stat-Labels `[overflow-wrap:anywhere]` |
| `src/components/tools/RatingsModal.tsx` | Zeile umbruchfähig, Gauge responsiv, Textspalte `min-w-[9rem]` |
| `src/components/tools/{AlertsPanel,ScriptLab}Modal.tsx` | Buttonzeilen `flex-wrap` + `shrink-0` |
| `ads-kit/smartlinks.css` | Badge `nowrap` + `flex:0 0 auto`, Strip-Icon `flex:0 0 auto`, Strip-Button `flex-wrap` |
| `public/ads/smartlinks.css` | via `npm run ads:sync` gespiegelt |
| `src/components/ads/SmartlinkCta.tsx` | `max-w-full` + umbruchfähiges Label (CTA lief auf 320 px über den Rand) |

**Nachtrag Durchgang 4 (M5 · A11y):**

| Datei | Änderung |
|---|---|
| `tailwind.config.js` | `bull`/`bear` folgen jetzt den Theme-Variablen (`hsl(var(--nc-bull)/…`) statt fester Hex-Werte – Neon im hellen Skin war 1.24:1. Markenfixes Neon bleibt als `neon.bull`/`neon.bear` |
| `src/lib/focus-trap.ts` | **neu**: gemeinsame Fokusfallen-Hilfe (echte Tab-Stationen: `tabIndex >= 0`, `:disabled` und `aria-hidden` raus; Tab nur abfangen, wenn der Dialog sonst verlassen würde) |
| `src/components/ui/Modal.tsx` | `aria-labelledby` via `useId()` (Dialoge mit JSX-Titel waren namenlos), lokalisierter Schließen-Name (`common.close`), tote `labelledBy`-Prop entfernt, Falle über die neue Hilfe |
| `src/components/ui/ToolMenu.tsx` | Fokus kehrt **vor** dem Öffnen eines Dialogs zum Trigger zurück (vorher landete er nach jedem Menü-Dialog auf `<body>`); zusätzlich vollständige Pfeiltasten-Navigation wie im Dropdown |
| `src/components/layout/CommandPalette.tsx` | dokumentweites Escape + Tab-Falle, lokalisierter Schließen-Name, Suchfeld-Aussehen unverändert |
| `src/components/search/SmartSearch.tsx` | `focus:outline-none` entfernt (Fokusring war unsichtbar) |
| `src/components/support/SupportNudge.tsx` | `aria-label={t('dismiss')}` statt hartem „dismiss" |
| `src/components/tools/WatchlistPopover.tsx` | Escape + Outside-Click schließen, `role="dialog"` + Label, Space-Taste auf den Zeilen |
| `src/components/tools/HeatmapModal.tsx` | Fallback-Fetch sofort behandelt (unbehandelte Rejection, wenn beide Börsen ausfallen) |
| `src/components/terminal/TerminalShell.tsx` | `Chip` reicht zusätzliche Attribute durch (`data-watch-trigger`) |
| `src/components/layout/SiteFooter.tsx` | `text-faint/80` → `text-faint` (2.56:1 → 5.06:1 im hellen Skin) |
| `src/styles/globals.css` | Kontrast-Token aller 5 Skins: `--nc-faint` (alle), `--nc-warning` (light), `--nc-secondary` + Ink (acid), `--nc-primary` (violet) – Token-Matrix jetzt durchgängig ≥ 4.5:1 |
| `scripts/audit-sandbox/*` | M5-Runner `run-m5-a11y.mjs` + Lizenz-Header auf allen Harness-Dateien |

Alle Änderungen sind typgeprüft (`tsc`), lint-frei (`0 Fehler / 2 Alt-Warnungen`), gebaut und im Browser nachgemessen.

**Nachtrag Durchgang 5 (M6 · Werbung im Fill-Fall):**

| Datei | Änderung |
|---|---|
| `src/components/ads/AdManager.tsx` | `SlotTag` ist `sticky` statt `absolute` (der Tag wurde als Bottom-Overlay fehlgemessen und reservierte 44 px Leerraum); `AdSlot` bekommt Spender-/QA-Guard, Container-Div je Placement, 4:1-Reserve mit Klammerung, Poll-Kollaps ohne Fill, `shrink-0`; Wall-Cooldown gilt für **alle** Schließwege (Escape/X öffneten den Dialog sonst sofort wieder) |
| `src/lib/ads/config.ts` | `nativeContainerId()` leitet die Container-Id aus der Placement-URL ab (`…$hash/invoke.js` → `container-$hash`), plus `NATIVE_*_CONTAINER_ID` und Dedupe, wenn beide Slots dasselbe Placement zeigen |
| `src/components/terminal/TerminalShell.tsx` | reserviert die Social-Bar-Höhe (unten **und** am Mobile-Viewport), Desktop-Slot als Streifen über dem Grid (statt 176×600-Rail mit 600 px Reserve), Sponsor-Streifen mit fester 44-px-Zeile |
| `src/components/layout/ThemeBootScript.tsx` | markiert Spender/Blocker-Cache/QA **vor dem ersten Paint** (`data-nc-adsuppressed`) – Ad-Flächen verschwinden ohne Layout-Sprung |
| `src/styles/globals.css` | Unterdrückungs-Regeln für Header-Banner, Terminal-Slots, Sidebar-Rail und Sponsor-Streifen; `.nc-header-ad` mit Breitenbegrenzung (Kreativ wurde auf 160 px beschnitten) |
| `src/components/ads/SidebarBanner.tsx` | Rail-Wrapper `nc-sidebar-rail` (unter der Pre-Paint-Unterdrückung) |
| `src/components/chart/ChartGrid.tsx` | Grid-Wrapper mit `lg:min-h-[20rem]` – ein ausscherendes Kreativ quetschte die Chart-Zeile auf 0 px |
| `src/components/layout/LocaleDetectBanner.tsx` | Sprachhinweis aus dem Fluss genommen (0,056–0,239 CLS beim ersten Besuch) |
| `ads-kit/smartlinks.css` | Strip und Buttons einzeilig (`nowrap`) + horizontales Scrollen ⇒ konstante Zeilenhöhe |
| `public/ads/smartlinks.css` | via `npm run ads:sync` gespiegelt |
| `scripts/audit-sandbox/ad-fixtures.mjs` | **neu**: Ad-Stubs (Native 4:1, Rail 160×600, Social Bar, Popunder, Direct-Link) + CLS-Zeitachse mit Quell-Rechtecken |
| `scripts/audit-sandbox/run-m6-ads.mjs` | **neu**: M6-Suite S0–S11 (64 Checks) |

**Nachtrag Durchgang 6 (M7 · Performance):**

| Datei | Änderung |
|---|---|
| `src/app/[locale]/layout.tsx` | Fonts je Familie gesplittet: `latin` (Preload an) + `cyrillic` (`preload:false`, eigene `--font-*-cyr`-Variablen), alle via `cn()` am Layout-Wrapper |
| `tailwind.config.js` | `fontFamily`-Ketten enthalten beide Variablen (`display`/`display-cyr` usw.) — der Browser wählt pro Glyph über `unicode-range` |
| `src/components/layout/ThemeBootScript.tsx` | setzt zusätzlich `data-nc-touch='1'` pre-paint (`pointer: coarse` / `ontouchstart` / `maxTouchPoints`) — zusammen mit dem Ad-Guard in einem Durchlauf |
| `src/styles/globals.css` | `.nc-touch-gate{display:none}` / `[data-nc-touch='1'] .nc-touch-gate{display:flex}` für die Touch-Warnung ohne Layoutsprung |
| `src/components/chart/DrawingToolbar.tsx` | Touch-Warnung als CSS-erste Gating-Klasse (`nc-touch-gate`), Desktop unverändert |
| `src/components/ui/LazyGate.tsx` | **neu**: mountet Kinder erst bei `active`/`warm` (deferred `setState`), `warmToolChunks()` lädt die fünf Werkzeug-Chunks nach 3 s Idle |
| `src/components/terminal/TerminalShell.tsx` | 15 Modals + On-Chain-/Pro-Metrics-Dock als `dynamic(…,{ssr:false})` in `<LazyGate>`, Watchlist-Popover gegated, `warmToolChunks()` im Mount-Effect |
| `src/components/ads/AdManager.tsx` | Support- und Teilen-Dialog hinter `LazyGate` + `dynamic(…,{ssr:false})` (hingen vorher im Layout-Bundle jeder Seite) |
| `src/components/search/SmartSearch.tsx` | Such-Engine (`api/search`), `cex-universe` und GoPlus-Audit (`api/security`) werden beim Tippen/Auswählen/Treffer nachgeladen; Guard-Import aus `lib/exchanges` |
| `src/store/useExchangeSelection.ts` | Region-/Börsen-Probe (`api/exchangeProbe` → `websockets/rest` + `registry`) lädt der Bootstrap dynamisch; `isCexExchange` kommt aus `lib/exchanges` |
| `src/lib/exchanges.ts` | `isCexExchange()` als Leaf-Guard (keine Börsen-Infrastruktur im Layout-Bundle) |
| `package.json` | `browserslist` auf gepflegte Browser (Chrome/Edge/FF ≥ 111, Safari/iOS ≥ 16.4, Opera ≥ 97) |
| `scripts/audit-sandbox/run-m7-perf.mjs` | **neu**: M7-Suite S1–S5 (41 Checks), kritisch/nachgeladen je Seite, Font-Nachweis über `unicode-range`, INP mit Zähler-Reset, Messfix S4 (Polling statt fester Wartezeiten) |
| `scripts/audit-sandbox/run-m7-smoke.mjs` | **neu**: Funktions-Smoke für die drei Pfade des Lazy-Umbaus (Suche, Teilen-Dialog, Support-Dialog) |
| `package.json` | Sammelskripte für die Suiten: `qa:a11y`, `qa:ads`, `qa:perf`, `qa:perf:smoke` |

---

## 13. ✅ Vollverifikation (V6) — Gesamtlauf auf dem Auslieferungs-Build

**Auftrag:** alle Suiten *am Stück* auf genau dem Build fahren, der ausgeliefert werden
soll (kein Sammeln von Einzelergebnissen aus verschiedenen Ständen), Ergebnis
konsolidiert protokollieren — **vor** dem Merge/Modul M8.

**Auslieferungs-Build:** `node_modules` via `npm ci --ignore-scripts`,
`next build --webpack` mit Font-Mock + `NEXT_PUBLIC_SITE_URL=https://nodechart.cc`,
danach `next start` auf `:3000`. Code-Stand = dieser Arbeitsbaum (siehe §12).

### Gesamtlauf „Release-Audit" (M1–M10, `node scripts/release-audit/run.mjs`)

| Modul | Bereich | PASS | FAIL | Dauer |
|---|---|---:|---:|---:|
| M1 | Statik & Konfiguration (Lizenz, Secrets, i18n-Parität, tsc, Lint) | 14 | 0 | 22,5 s |
| M2 | Routing & SEO (30 Seiten × 5 Locales) | 310 | 0 | 39,9 s |
| M3 | Terminal-Funktionalbatterie (Fixture-Feed, 12 Venues) | 17 | 0 | 39,8 s |
| M4 | A11y & UX-Semantik (4 Routen × 5 Locales) | 48 | 0 | 17,3 s |
| M5 | Monetarisierung (`qa:monetization` 78/0 · `qa:smartlinks` 14/0) | 2 | 0 | 97,5 s |
| M6 | Runtime & Edge (`qa-release` 44/44) | 1 | 0 | 93,0 s |
| M8 | Native Banner + Smartlinks (Tiefe) | 37 | 0 | 60,7 s |
| M9 | Security & Input-Hardening | 16 | 0 | 21,7 s |
| M10 | Daten-Resilienz & Session (Outage, Malformed, Exporte, Heap) | 12 | 0 | 68,1 s |
| M7 | Deploy-Readiness (Cloudflare `cf:build` + robots/sitemap/wrangler) | 6 | 0 | 44,4 s |
| **Σ** | **`RELEASE-AUDIT.md`** | **463** | **0** | ≈ 8 min |

### Einzelsuiten auf demselben Build

| Suite | Ergebnis | Bemerkung |
|---|---|---|
| `qa:i18n` (Layout-Stresstest) | **110/110** | 5 Locales × Viewports bis 3440 px, keine Page-Errors |
| `qa:a11y` (M5-Deep-Dive) | **175/0** | 258 s, Report `/tmp/nc-shots/m5-report.json` |
| `qa:ads` (M6-Werbung) | **57/0** | Auslieferungs-Build (kein Fill), Report `/tmp/nc-shots/m6-report.json` |
| `qa:perf` (M7-Core-Web-Vitals) | **41/0** | Report `/tmp/nc-shots/m7-report.json` |
| `tsc --noEmit` · `eslint .` | 0 Fehler · 0 Warnungen | via M1 mitgeprüft |
| i18n-Key-Parität | 5 × 1162 Keys | via M1 |

### Gemessene Kernwerte (2-Kern-Sandbox-Host, 4× CPU-Bremse, Slow-4G)

| Metrik | Landing | Terminal |
|---|---|---|
| TTFB · LCP | 13 ms · 1328 ms | 78 ms · 1084 ms |
| CLS | **0,000** | **0,0004** |
| TBT (4 bzw. 12 Long Tasks) | 244 ms | 761 ms * |
| JS kritisch / gesamt | 192,8 kB / 553,0 kB | 262,0 kB / 1008,1 kB |
| Fonts (Preloads 9) | 128,6 kB | 129,3 kB |
| INP (Menü → Dialog) | 15 ms | — |

\* Die Suite skaliert die TBT-Grenze auf Mehrkern-Hosts (2 Kerne ⇒ Faktor 2, also
1200 ms statt 600 ms); die projektierten ≥4-Kern-Werte aus §9 (Terminal 305 ms) gelten
weiter. Fonts je Sprache: de 12/150,8 kB · ru 11/133,6 kB · zh 10/125,6 kB.

### Was in diesem Durchgang tatsächlich repariert wurde

1. **Sprachhinweis über der Sponsor-Leiste (Überdeckung).** Der Banner lag als
   `absolute`-Karte über dem Header und fing Klicks ab (die Alt-Suite meldete drei
   „terminal: alles klickbar"-Befunde). Er sitzt jetzt im Fluss in einem eigenen
   Slot (`.nc-langhint-slot`, feste Höhen 216/176/144 px; Karte füllt den Slot bis
   `pt-3`, Spalten-Layout bis `lg`, Zeile ab `lg`). Klick-Treffer sind damit frei:
   `qa:monetization` **78/0** (vorher 75/3).
2. **CLS-Kausalität aufgeklärt.** Die 0,11 auf /de stammten **nicht** vom
   Sprachhinweis, sondern von der **Ad-Schicht** (Detect-on-Failure): Gegenprobe mit
   deaktivierten Ads ergab 0,0000/0,0017, mit Ads 0,1086/0,1105 — unabhängig davon,
   ob der Hinweis stand. Der Banner-Höhen-Fix reduziert also keine CLS (er war
   trotzdem nötig, siehe 1.), die Zahlen aus §9 bleiben unverändert gültig.
3. **Falsch-negative Messstellen gehärtet** (Suite-Fixes, kein App-Defekt):
   `m8-ads-deep` und `m9-security` fragten `[data-pane]` ab — einen Selektor, den
   die App nie hatte — und warteten ohne Fixture-Feed auf `canvas`; jetzt nutzen sie
   den Fixture-Feed und den echten Haken `[data-nc-pane-placeholder]`.
   `qa-release` hing an einem mehrdeutigen Klassen-Selektor (`.font-mono.text-micro-10`
   traf zuerst Toolbar-Buttons) und las damit nie den Legend-Kurs ⇒ jetzt
   `[data-nc-legend]`. Dieselbe Ursache erklärte zwei „Offline/Reconnect"-Befunde,
   die sich als Messfehler erwiesen (die App reconnectet nachweislich, M10 12/0).
4. **Netzrauschen zentral gefiltert.** `net::ERR_FAILED`/`ERR_ABORTED` und
   `WebSocket … failed` (Sandbox ohne Börsen-Hosts) zählen in `lib.mjs` und
   `qa-release.mjs` identisch als Umgebungsrauschen — vorher meldeten M3/M10 dafür
   „Console nicht sauber", obwohl das Verhalten korrekt war.
5. **`cf:build` offline grün.** Der Cloudflare-Build ruft intern `npm run build` auf;
   die Turbopack-Variante von Next 16 kennt den Offline-Font-Mock nicht und brach in
   der Sandbox ab. `build` ist deshalb jetzt `next build --webpack` — derselbe Pfad,
   der auditiert und ausgeliefert wird (mit Netz verhält sich das identisch), und
   `m7-deploy.mjs` setzt den Font-Mock selbst. Ergebnis: Worker-Bundle
   (`.open-next/worker.js`) baut reproduzierbar.

### Ehrliche Grenzen dieser Runde

- M7 (Core Web Vitals) und M6 laufen **ohne** echte Börsenverbindung: der
  Fixture-Feed ersetzt REST/WS, alle Werte sind gegen den echten Produktions-Render
  gemessen, aber mit lokalen Kursdaten.
- Die Sandbox hat 2 Kerne; langlaufende Perf-Module werden über die Host-Toleranz
  bewertet (siehe \*). Die 4-Kern-Referenzwerte aus §9 bleiben der Maßstab.
- Die Native-Banner-Platzierung (M8) wird mit dem eingebauten Fill-Simulator
  geprüft (Build ohne `NEXT_PUBLIC_ADSTERRA_NATIVE_*`): No-Fill-Kollaps, CLS 0,
  kein Overlap, mobil kein Overflow — der Live-Fill folgt erst mit echten Keys.

**Verdikt:** Der Auslieferungs-Build ist über **alle** zehn Module plus die vier
Einzelsuiten **ohne offenen Befund** — 463 + 110 + 175 + 57 + 41 = **846 Checks grün,
0 rot**. Damit ist M8 (Sekundär-Fetch-Härtung, 429-Overlay, Speicherdruck) der
nächste echte Ausbauschritt, kein Reparaturfall.

---

## 14. ✅ Modul M8 — Robustheit (Netzabbruch, Rate-Limit, Speicher, Payloads)

Geprüft wird die Frage „läuft es auch dann noch, wenn die Umgebung schlecht
wird?" — nicht der Normalfall, sondern die Ausnahmen: **volle Speicherquote**,
**429-Drosselung**, **Abbruch mitten im Betrieb**, **tote oder hängende
Zweitquellen**, **giftige Antworten**. Suite: `scripts/audit-sandbox/run-m8-robustness.mjs`
(`npm run qa:robustness`), Fault-Injection über die neue `route`-Option der
Fixture-Schicht — dieselbe Antwort-Pipeline wie der echte Feed, nur mit
429 / Hang / Riesen-Body / kaputtem JSON an genau den Stellen.

| Stufe | Was gemessen wird | Umfang |
|---|---|---|
| **S1** Speicher | Speicher von Anfang an gesperrt (Safari privat / „Cookies blockieren"), Quote füllt sich **nach** dem Boot, Quote durch den eigenen L2-Cache belegt (Verdrängungs-Rangfolge) | 10 Checks |
| **S2** Rate-Limit | 429 → Glitch-Overlay mit laufendem Countdown, Cooldown endet von selbst, automatischer Retry liefert echte Kerzen, kein Overlay-Stacking, 403 löst **keinen** Cooldown aus, Drossel-Antwort landet nicht im L2-Cache | 12 |
| **S3** Netzabbruch | Offline mitten im Betrieb → Status + Bedienbarkeit → Erholung nach dem Online-Gehen, hängende Verbindung (Timeout + Retry), Abbruch beim Tippen, Dialog bei hängender Zweitquelle schließen (keine Anfrage-Leichen) | 9 |
| **S4** Sekundär-Quellen | Befund **O3**: Primärquelle gewinnt / Zweitquelle tot (Lupe + Heatmap), beide tot, beide **hängend** (12-s-Deckel) | 12 |
| **S5** Payload-Härtung | Antwort über dem 4-MiB-Deckel, ungültiges JSON, leere Historie, `null`-Werte in Kerzen, Selbstheilung danach, keine Cache-Vergiftung, Heap | 7 |

**Ergebnis: 54 ok / 0 Befunde** (167 s, Produktionsbuild + Fixture-Feed).

### 🔧 Vier echte Befunde gefunden und behoben

| # | Stelle | Befund (gemessen) | Fix |
|---|---|---|---|
| 1 | `store/storage.ts` (+ `api/persistCache.ts`) | **Volle Speicherquote riss einen unbehandelten Fehler bis in den Klick-Handler:** zustand persistiert synchron, `localStorage.setItem` wirft `QuotaExceededError`, und der Fehler landete als `Uncaught QuotaExceededError` in der Konsole — **zweimal pro Interaktion** (Theme-Wechsel, Zeitrahmen-Wechsel). Nebenwirkung: alles, was im selben Handler nach dem Store-Aufruf stand, wurde übersprungen. | `guardedStorage()` legt einen Schutzmantel um `localStorage` (Lesen/Schreiben/Löschen einzeln abgesichert). Bei voller Quote wird zuerst der **eigene L2-Cache** verdrängt (`nc-l2-v1:*`, Namespace jetzt als `L2_NAMESPACE` exportiert) und einmal erneut geschrieben — dieselbe Rangfolge, die `persistCache.ts` dokumentiert: Einstellungen sind wichtiger als Zwischenspeicher. Der In-Memory-Zustand bleibt in jedem Fall gültig. |
| 2 | `tools/MagnifierModal.tsx` | **Befund O3 bestätigt (Befund #4 aus §1):** gewinnt Binance, blieb der OKX-Promise unbeobachtet → `Uncaught (in promise) · TypeError: Failed to fetch` bei jedem Öffnen der Lupe, sobald OKX gesperrt/blockiert ist. Der 429-lose Normalfall (beide tot) war unauffällig, weil dann der Fallback-Pfad den Promise beobachtet — deshalb war der Fehler im 120-Läufe-Sweep nur sporadisch zu sehen. | `void okx.catch(() => null)` — der Zweitmarkt-Promise ist jetzt auch im Gewinn-Fall der Primärquelle beobachtet; der Fallback nutzt denselben Promise weiter. |
| 3 | `tools/MagnifierModal.tsx`, `tools/HeatmapModal.tsx`, `lib/scripts.ts` | **Rohe Sekundär-`fetch`-Aufrufe hatten kein Zeitlimit:** bei einer hängenden Verbindung blieb die Lupe dauerhaft im Ladezustand (kein Fehler, kein Ende) — der zentrale Fetch-Layer hat einen 12-s-Deckel, diese vier Aufrufe umgingen ihn. Ebenso konnte der Script-Lab-Import einer Nutzer-URL unbegrenzt laden. | `AbortSignal.timeout(12_000)` an allen vier Stellen; der Abbruch endet im regulären Fehlerpfad („Tape nicht erreichbar"). Nachweis S4c: Dialog endet nach **12,5 s** im Fehlerzustand statt zu hängen. |
| 4 | `scripts/audit-sandbox/fixtures.mjs` (**Harness**) | Die Fixture-Route feuerte für Tape-/Ticker-Aufrufe (`aggTrades`, `ticker/24hr`, `market/trades`) **nie**, weil `venue` nur aus den Kline-Mustern kam → die O3-Prüfung hätte still immer grün gemeldet. | `venue` wird jetzt auch für ungemusterte Venue-Hosts bestimmt; der Standard-Feed bleibt unverändert (503 für nicht abgedeckte Aufrufe). |

### 🔎 Zwei stille Messfehler im Harness (wichtiger als die Befunde)

1. **`unhandledrejection` als DOM-Event feuert in diesem Headless-Chromium nie.**
   Eine Prüfung darauf wäre immer grün gewesen. Verlässlich ist der CDP-Kanal:
   `Runtime.exceptionThrown` liefert `exceptionDetails.text` = „Uncaught (in
   promise) …"; Puppeteers `pageerror` reicht die Meldung zwar durch, aber **ohne
   dieses Merkmal** (`Failed to fetch` allein wäre auch ein normaler Fehler).
   Die Suite klassifiziert deshalb über CDP.
2. **Negativ-Kontrollen für jeden Fix.** Beide App-Fixes wurden mit *entferntem*
   Fix nachgemessen: Befund 1 erzeugte vorher zwei `Uncaught QuotaExceededError`
   (Kontrolle: 0), Befund 2 genau eine `Uncaught (in promise) · TypeError: Failed
   to fetch` im Lupe-Chunk (mit Fix: 0). Erst damit ist belegt, dass die Prüfung
   den Defekt wirklich sieht.

> **Fallstrick beim Verifizieren von Fixes:** `next build --webpack` hat den
> Chunk aus dem Webpack-Cache wiederverwendet, wenn nach dem Zurückrollen nur die
> Datei-Zeitstempel wechselten — die Negativ-Kontrolle lief dadurch zweimal gegen
> denselben Bundle-Stand (gleicher Chunk-Hash `5117.93d95feb…`). Seitdem gilt:
> vor Verifikations-Builds `rm -rf .next/cache`.

### ✅ Was ausdrücklich **gut** war (nicht angefasst)

- **429-Behandlung:** Overlay + Cooldown + automatischer Retry funktionieren
  end-to-end (Overlay erscheint, Countdown läuft 5→4→3…, Cooldown endet von
  selbst ≤ 8 s, Retry holt echte Kerzen, Drossel-Antwort wird **nicht** gecacht).
- **403/401/451** lösen korrekt keinen Cooldown aus (Retry wäre sinnlos) und
  degradieren in den Platzhalter.
- **4-MiB-Antwortdeckel** greift: eine 4 MiB große „Kline"-Antwort kostet 14 MB
  Heap und keinen Fehler.
- **Giftige Kerzen** (`null`, Strings, leere Liste) führen weder zu `NaN` im UI
  noch zu Cache-Vergiftung; der Chart heilt sich mit der nächsten guten Antwort.
- **Offline/Online** mitten im Betrieb: Status „Verbinde neu", Toolbar vollständig,
  0 Page-Errors, Erholung ohne Reload.
- **Dialog-Hygiene:** Schließen während laufender Anfrage hinterlässt keine
  weiteren Requests (n=0 in 3 s) und keine Rejections.

### 📋 Grenzen dieser Runde

- Gemessen wird mit dem Fixture-Feed (keine echten Börsenverbindungen); die
  Fehlerfälle sind dagegen **echte** HTTP-Antworten im Original-Wire-Format.
- Der 429-Pfad wurde auf einem Kline-Request ausgelöst; die Overlay-Logik ist
  global, ein zweiter gleichzeitiger 429 wird deshalb über die Zählung (`×N`)
  geprüft, nicht über zwei getrennte Quellen.
- Speicherdruck ist als **Quota**- und Heap-Druck geprüft (14 MB bei 4 MiB
  Antwort); ein echter OOM-Test bräuchte ein Speicherlimit des Browsers.
