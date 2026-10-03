# 🚀 NodeChart veröffentlichen — Schritt für Schritt

**Ziel:** Dieses Projekt wird aus einem GitHub-Repository mit Cloudflare Workers und dem OpenNext-Adapter veröffentlicht und optional mit `nodechart.cc` verbunden. Ob Hosting und Anbieterzugriffe innerhalb eines kostenlosen Plans bleiben, hängt von den jeweils aktuellen Quoten, Nutzungsbedingungen und dem tatsächlichen Traffic ab.

> Diese Anleitung beschreibt den Deploy-Ablauf, nicht den Prüfstatus des aktuellen Checkout. Vor einer Veröffentlichung die Tests und Builds auf dem zu deployenden Stand ausführen.

---

## 0. Checkliste

| Brauchst du | Woher | Haken |
| --- | --- | --- |
| GitHub-Konto | github.com; aktuelle Konto- und Repository-Bedingungen prüfen | ☐ |
| Cloudflare-Konto | dash.cloudflare.com; aktuelle Workers- und Tarifbedingungen prüfen | ☐ |
| Git installiert | Terminal: `git --version` → sonst git-scm.com | ☐ |
| Aktueller Prüf-Lauf | Im Projektordner die für diesen Stand verfügbaren Type-, Lint-, Locale-, Smoke- und Build-Prüfungen ausführen; Ergebnisse dokumentieren. | ☐ |
| Browser-/Provider-Checks | Browser- und Live-Provider-Prüfungen separat durchführen; Ergebnisse sind abhängig von Browser, Netzwerk, Region und Upstream-Verfügbarkeit. | ☐ |
| Historische Audit-Berichte | `AUDIT.md` und `RELEASE-AUDIT.md` enthalten frühere Test-Snapshots und sind kein PASS-Nachweis für spätere Änderungen. | ☐ |
| Dieser Ordner (`nodechart/`) auf deinem Rechner | z. B. als Download/Workspace-Kopie | ☐ |

Ein Terminal öffnen und **in den Projektordner wechseln** (alle Befehle unten
gelten nur dort):

```bash
cd pfad/zum/ordner/nodechart
```

---

## 1. GitHub: leeres Repository anlegen

1. Auf github.com einloggen → oben rechts **+** → **New repository**.
2. Ausfüllen, **sonst NICHTS**:
   * Repository name: `nodechart`
   * Sichtbarkeit auswählen und vor der Veröffentlichung prüfen, welche Dateien und Konfigurationen öffentlich werden.
   * **KEIN** Häkchen bei „Add a README“, **KEINE** zusätzliche License, **KEINE** .gitignore
     (die entsprechenden Projektdateien sind bereits vorhanden; doppelte Dateien können den ersten Push erschweren.)
3. **Create repository**. Die Seite zeigt jetzt leere Anweisungen — genau richtig.
4. Merk dir deine Adresszeile: `https://github.com/DEIN-NAME/nodechart`

## 2. Code hochladen

Im Terminal (immer noch im Projektordner):

```bash
git remote add origin https://github.com/DEIN-NAME/nodechart.git
git push -u origin main
```

* Ersetze `DEIN-NAME` durch deinen GitHub-Nutzernamen.
* Bei der Anmeldung Git Credential Manager, GitHub CLI oder einen von GitHub unterstützten Credential-Manager verwenden. Zugangsdaten oder Tokens nicht in Repository-Dateien, Logs oder Chats einfügen.
* **Prüfen:** Der Push-Befehl sollte ohne Fehler enden; kontrolliere auf GitHub, ob der erwartete Quellstand sichtbar ist. Eine feste Datei-Anzahl ist kein verlässliches Prüfkriterium.

> ❌ Fehler `remote origin already exists`? → `git remote set-url origin https://github.com/DEIN-NAME/nodechart.git`
> ❌ Fehler `rejected … non-fast-forward`? → Das Repo war doch nicht leer (README-Häkchen?).
>    Auf GitHub das Repo löschen (**Settings → ganz unten → Delete this repository**) und Schritt 1 wiederholen.

## 3. Cloudflare Workers einrichten

1. dash.cloudflare.com einloggen → links **Workers & Pages** → **Create** (blauer Button).
2. Tab/Option **Import a Git repository** / **Connect to Git** → GitHub autorisieren
   (einmalig) → Repository `nodechart` auswählen → **Begin setup**.
3. Build-Einstellungen **exakt** so setzen:

   | Feld | Wert |
   | --- | --- |
   | Framework preset | **None** |
   | Build command | `npm run cf:build` |
   | Deploy command | `npx wrangler deploy` |
   | Production branch | `main` |

4. Unter **Environment variables** hinzufügen (Button „Add variable“):

   | Variable | Wert |
   | --- | --- |
   | `NODE_VERSION` | `22` |
   | `NEXT_PUBLIC_SITE_URL` | `https://nodechart.cc` |

5. **Save and Deploy** klicken und den Status im Cloudflare-Dashboard verfolgen.
   Build- und Deploy-Dauer hängen von Checkout, Abhängigkeiten, Worker-Konfiguration
   und Plattform-Auslastung ab. Bei der nativen Git-Integration verwaltet
   Cloudflare den Deploy-Zugang; verwende keine Zugangsdaten in Quellcodedateien.
6. Nach erfolgreichem Deploy liegt die App unter der Worker-URL, zum Beispiel
   `nodechart.DEIN-SUB.workers.dev`. Verfügbarkeit und Nutzung unterliegen dem gewählten Cloudflare-Plan.

> 💡 **Drittanbieter-Werbung:** Die aktuelle Quellkonfiguration enthält Adsterra-Delivery-URLs und Sponsored-Link-Ziele als Defaults. Ein leeres Env-Setup schaltet nicht zwingend alle externen Anfragen ab. Prüfe vor dem Deploy, welche Ad-/Partner-Skripte aktiviert sind, und passe Defaults oder Build-Variablen an. Ads und gesponserte Links können externe Seiten öffnen; deren Inhalte, Datenverarbeitung und Bedingungen sind separat.
>
> **Zugangsmodell:** Kern-Charts benötigen kein Konto und kein wiederkehrendes Abo. Zwei Themen werden lokal freigeschaltet, sobald sich der vorbereitete X-/Telegram-Composer öffnet; die App prüft nicht, ob tatsächlich veröffentlicht wurde. Ausgewählte Pro-Funktionen setzen eine qualifizierende On-Chain-Unterstützung voraus, die nur auf unterstützten Netzwerken verifiziert werden kann. Ein selbst gesetzter Support-Badge verifiziert keine Zahlung und schaltet Pro nicht frei.

## 3b. Variante B (empfohlen): Auto-Deploy per GitHub Actions

Die Dashboard-Variante (§3) baut in Cloudflares CI. Noch einfacher und
nachvollziehbarer ist der mitgelieferte Workflow `.github/workflows/deploy.yml`:
**Pushes auf `main` starten den konfigurierten Deploy-Workflow** — sofern GitHub Actions aktiviert und die erforderlichen Secrets eingerichtet sind. Vor dem Push die aktuellen lokalen Prüfungen ausführen; der Workflow allein bestätigt weder Datenverfügbarkeit noch Copy-Genauigkeit.

1. Cloudflare → oben rechts **My Profile → API Tokens → Create Token** →
   Template **„Edit Cloudflare Workers"** → **Continue → Create Token**.
   Token einmal anzeigen und kopieren.
2. Cloudflare → beliebige Seite der **Workers & Pages**-Overview: rechts steht die
   **Account ID** (32 Zeichen) — kopieren.
3. GitHub → dein Repository → **Settings → Secrets and variables → Actions →
   New repository secret**, zweimal:
   | Name | Wert |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | Token aus Schritt 1 |
   | `CLOUDFLARE_ACCOUNT_ID` | ID aus Schritt 2 |
4. Nach erfolgreicher Einrichtung lösen Pushes auf `main` den Workflow aus.
   Den Status im Tab **Actions** beobachten. Fehlen Secrets oder schlägt ein
   Gate fehl, kann der Deploy-Job nicht erfolgreich abgeschlossen werden.
5. **Deploy neu starten** (kein neuer Commit nötig): **Actions → „Deploy to
   Cloudflare“ → letzten Lauf öffnen → Re-run jobs**. Fehlen die Secrets
   weiterhin, nennt der Job sie namentlich — als Annotation am roten Check
   und in seiner Zusammenfassung.
6. **Domain prüfen:** **Actions → „Live check (Domain)“ → Run workflow** (oder
   lokal `npm run check:live`). Die Ausgabe dokumentiert nur die geprüften URL-/Header-/Metadaten-Prüfungen zum Laufzeitpunkt.

> Beide Varianten schließen sich nicht aus; wer §3 gebaut hat, kann §3b trotzdem
> aktivieren — gewonnen hat immer der letzte erfolgreiche Deploy.

## 4. Eigene Domain `nodechart.cc` verbinden

*Nur nötig, wenn die Domain noch nicht live auf der App liegt:*

1. Cloudflare → **Workers & Pages** → Projekt `nodechart` → Tab **Settings** →
   **Domains & Routes** → **Add custom domain**.
2. `nodechart.cc` eintragen → **Add domain** und den angezeigten Status sowie
   erforderliche DNS- und Zertifikatsschritte prüfen. Propagierung und Ausstellung
   können je nach Domain-Konfiguration und Plattform variieren. Voraussetzung:
   die Domain liegt in deinem Cloudflare-Account (ist sie das nicht: Domain
   zuerst unter **Websites → Add a site** hinzufügen). `www` wird separat per
   Redirect Rule bedient und nicht als Worker-Custom-Domain gebunden.
3. **SEO-Edge-Regeln (einmalig):** Cloudflare → Domain `nodechart.cc`
   → links im Menü:
   | Regel | Wo | Einstellung |
   | --- | --- | --- |
   | www → apex | **DNS → Add record**: AAAA `www` → `100::`, **Proxied** (orange cloud). Danach **Rules → Redirect Rules**: `www.nodechart.cc/*` → `https://nodechart.cc/$1`, Status **301**, Query-String erhalten. | Live-Check kann die www-Weiterleitung direkt prüfen |
   | HTTPS erzwingen | **SSL/TLS → Edge Certificates → Always Use HTTPS** | an |
   | Early Hints | **Speed → Optimization → Early Hints** | optional – unsere Font-Preloads stehen als `<link rel="preload">` im HTML (nicht als `Link:`-Header), Cloudflare hat also nichts vorab zu schicken; schadet nicht, hilft hier aber nicht |
   | Brotli | **Speed → Optimization → Content Optimization → Brotli** | an |
   | Hotlink-Protection | **Scrapes/Hotlinks** | für `/og.png` AUS (Social-Cards!) |
4. Prüfe nach erfolgreichem Deploy und abgeschlossener Propagierung, ob
   `https://nodechart.cc` die erwartete Version ausliefert. Pushes lösen nur dann
   automatisch einen Deploy aus, wenn der Workflow korrekt eingerichtet ist; die
   Laufzeit und Erreichbarkeit sind nicht garantiert.

## 5. Live-Checkliste nach dem Deploy

| Test | Erwartung |
| --- | --- |
| `https://nodechart.cc/de/terminal` | Chartfläche lädt; Feed-Status prüfen. Candles hängen von Symbol, Region, Browser und Provider ab. |
| Sprache oben rechts wechseln | de/en/es/ru/zh durchgehen; fehlende oder abgeschnittene Strings dokumentieren. |
| `…/de/terminal?adwall=1` | Support-/Ad-Block-Prompt testen, sofern nicht durch einen lokalen Cooldown unterdrückt. |
| `https://nodechart.cc/sitemap.xml` | Sitemap-Inhalte mit den aktuell konfigurierten Routen, Sprachen und `hreflang`-Alternativen abgleichen; Antwort und Cache-Header zur Laufzeit prüfen. Die genaue Anzahl ändert sich mit der Konfiguration. |
| Desktop-Browser auf `/de/terminal` | Werbeplatz und sichtbare Sponsored-Kennzeichnung prüfen; Füllung ist nicht garantiert. |
| `https://nodechart.cc/de/terminal?ticker=SOL` | Social-Card-Rendering prüfen; ein übergebener Kurswert ist nur ein Snapshot beim Teilen. |
| `https://nodechart.cc/de/legal/nope` | 404 (keine Soft-404s); `/xx` wird erst auf `/en/xx` geleitet und endet dann ebenfalls 404 |
| Browser-Konsole (F12) | App-Fehler von blockierten oder nicht erreichbaren Drittanbieter-Requests unterscheiden. |
| **Alles auf einmal** | `npm run check:live` — prüft Sitemap, Sprachen, Canonicals, robots/googlebot, JSON-LD, OG-Karte, 404-Verhalten, Header und (auf nodechart.cc) Always HTTPS + www-Weiterleitung. Erwartung: keine unerklärten App-Fehler; externe Provider-Ergebnisse können je nach Netz abweichen. |

## 6. Sitemap einreichen (Google & Bing)

Die Sitemap wird unter `https://nodechart.cc/sitemap.xml` bereitgestellt (Routen × konfigurierte Sprachen mit `hreflang` + `x-default`). Ihre Einträge und aktuelle Antworten vor dem Einreichen prüfen:

1. **Google Search Console** (search.google.com/search-console) → Property
   `https://nodechart.cc` hinzufügen und die dort angebotene
   Bestätigungsmethode verwenden. Bei einer Domain-Property kann die Oberfläche
   eine DNS-Verifikation per TXT-Record verlangen; bei einer URL-Präfix-Property
   stehen weitere Methoden zur Verfügung. Nur Records setzen, die das Dashboard
   vorgibt.
2. Links **Sitemaps** → `sitemap.xml` eintragen → **Senden** und den in der
   Search Console gemeldeten Status prüfen. Eine akzeptierte Sitemap bestätigt
   weder, dass alle URLs indexiert werden, noch wann ein Crawl oder eine
   Indexierungsentscheidung erfolgt.
3. **Bing Webmaster Tools** (bing.com/webmasters) → „Add site“. Falls die
   Importfunktion für dein Konto verfügbar ist, kannst du die Google-Search-
   Console-Property auswählen; anschließend Bing-Status und Sitemap-Eintrag
   separat prüfen.
4. Optional: strukturierte Daten mit einem geeigneten Validator prüfen. Ein erkannter Eintrag garantiert weder Rich Results noch Indexierung oder Ranking.

> Sitemap-Einreichung und Crawl-Ergebnisse liegen beim jeweiligen Suchdienst. Eine Sitemap garantiert weder Indexierung noch einen Zeitrahmen.

## 7. Troubleshooting (falls etwas zickt)

| Symptom | Lösung |
| --- | --- |
| Build-Fehler mit „Node … unsupported“ | Env-Var `NODE_VERSION=22` fehlt (Teil 3, Schritt 4) |
| Deploy hängt/fehlt nach Push | Workers & Pages → Projekt → **Deployments** → „Retry“; Build-Log lesen |
| Seite zeigt alten Stand | Cloudflare-Cache: Projekt → Deployments → neuer Push löst automatisch neuen Deploy aus; sonst **Purge cache** unter Caching |
| Ad-Slots leer | Füllung ist nicht garantiert. Prüfe Quell-Defaults, Build-Variablen, Netzwerkzugriff und Provider-Status. |
| `git push` fragt wiederholt nach Anmeldung | Credential Manager oder GitHub CLI einrichten; keine Tokens in Repository-Dateien oder Logs speichern. |
| Lokales Ausprobieren vor dem Push | `npm ci && npm run build && npm start` → http://localhost:3000 |
| `npm run qa:full` meldet FAILs | **Nicht pushen.** `RELEASE-AUDIT.md` öffnet die Fail-Liste pro Modul; Modul einzeln erneut: `node scripts/release-audit/run.mjs M3` |

## 8. Kosten & Recht

* **Kosten:** Diese Bereitstellungsanleitung garantiert keinen Preis. Cloudflare-, GitHub-, Datenanbieter- und Werbenetzwerk-Tarife, Quoten und Bedingungen können sich ändern; prüfe die aktuellen Konditionen und beobachte den tatsächlichen Verbrauch.
* **Lizenzhinweis:** Prüfe `LICENSE.md` und die jeweiligen Lizenzen der
  eingebundenen Bibliotheken, bevor du Code weitergibst oder einsetzt. Diese
  Anleitung ersetzt keine Lizenz- oder Rechtsprüfung. Lizenzdateien und
  Copyright-Hinweise bei Änderungen nicht versehentlich entfernen.

---

**Reihenfolge:** ① Repository vorbereiten → ② Deployment-Branch verbinden → ③ Cloudflare-Build konfigurieren → ④ Domain optional verbinden → ⑤ aktuellen Stand prüfen → ⑥ Sitemap optional einreichen. Frühere Audit-Zähler in den Dokumenten sind historische Snapshots und keine Aussage über diesen Deploy. Viel Erfolg, Andrex. 🖤💚
