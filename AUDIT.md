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
| M5 | A11y vertieft (Tastatur, Fokus, Screenreader, Kontrast) | ⏳ offen | – |
| M6 | Werbung/Monetarisierung im echten Fill-Fall | ⏳ offen | – |
| M7 | Performance / Core Web Vitals | ⏳ offen | – |
| M8 | Robustheit (Netzabbruch, Rate-Limit, Speicher) | ⏳ offen | – |
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

## 7. Vorschlag für die nächsten Schritte

| Reihenfolge | Modul | Inhalt | Warum jetzt |
|---|---|---|---|
| 1 | ~~**M3a**~~ | ~~mobiler Terminal-Umbau~~ | ✅ **erledigt** (Abschnitt 4) |
| 2 | ~~**M3b**~~ | ~~Chart-Engine-Prüfung~~ | ✅ **erledigt** (Abschnitt 5, inkl. Fixture-Feed statt Netzzwang) |
| 3 | ~~**M4**~~ | ~~i18n-Layout-Stresstest~~ | ✅ **erledigt** (Abschnitt 6, 10 Fixes) |
| 4 | **M5** | A11y: Fokusringe, Tab-Reihenfolge in Modals, Kontrast im Light-Theme, Screenreader-Namen der Icon-Buttons | Barrierefreiheit + SEO-Nebenwirkung |
| 5 | **M6** | Werbung/Monetarisierung im Fill-Fall (CLS, „kollabiert ohne Fill", Social Bar, Ad-Block-Wall) | Einnahmen, ohne die UX zu beschädigen |
| 6 | **M7** | Performance: Bundle, LCP/INP/CLS auf Mid-Range-Mobile, `next/font`-Subsets | Ranking + subjektive Geschwindigkeit |
| 7 | **M8** | Robustheit: Netzabbruch, 429-Overlay, Speicher-voll, Sekundär-Fetch-Härtung (O3) | „läuft einfach" auf echten Geräten |
| 8 | **M9** | Deploy-Pfad Cloudflare, Domain, Sitemap-Einreichung, Endkontrolle | Abschluss |

---

## 8. Arbeitsumgebung / Reproduktion

Die Prüfungen liefen in einer Sandbox ohne Zugang zu Börsen/DEX/Fonts (nur npm + GitHub).
Damit der Produktionsbuild trotzdem echt geprüft werden kann:

```bash
# Build (offline-fähig: echte Fonts über fontsource gemockt)
NEXT_FONT_GOOGLE_MOCKED_RESPONSES=<mock.cjs> \
NEXT_PUBLIC_SITE_URL=https://nodechart.cc npx next build --webpack

# Server + Headless-Chrome
npx next start -H 0.0.0.0 -p 3000
LD_LIBRARY_PATH=<nss-libs> PUPPETEER_EXECUTABLE_PATH=<chromium> node <harness.mjs>
```

Auf einem Rechner mit normalem Internetzugang entfällt der Font-Mock; `npm run build`
funktioniert dort unverändert. Die Projekt-Skripte `qa:features`, `qa:modules`,
`browser-check` und `gui-audit` brauchen `PUPPETEER_EXECUTABLE_PATH` bzw. ein
installiertes Chrome for Testing.

---

## 9. Fixes dieses Durchgangs (Diff-Übersicht)

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

Alle Änderungen sind typgeprüft (`tsc`), lint-frei, gebaut und im Browser nachgemessen.
