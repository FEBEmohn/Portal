# Febesol Subunternehmer Portal

Dieses Repository enthält ein leichtgewichtiges Grundgerüst für das geplante
Portal unter `portal.febesol.com`. Die Anwendung ist in Node.js umgesetzt und
liefert die grundlegende Struktur für folgende Bereiche:

- **Microsoft Login für Admins** – via Azure Entra ID (OpenID Connect) mit
  Domain-Whitelist für `@febesol.de`.
- **Adminbereich** unter `/admin` – nach erfolgreicher Anmeldung können hier
  Subunternehmer-Konten verwaltet und mit Items aus dem Board `4246150011`
  verknüpft werden.
- **Standard-Portal** unter `/` – ermöglicht die Anmeldung per lokalem Konto
  und zeigt die Aufträge aus den Boards `1766160356` und `1766184997`, sofern
  sie mit dem jeweiligen Item aus dem Subunternehmer-Board verknüpft sind.

## Entwicklungs-Setup

1. Node.js ≥ 18 installieren.
2. Repository klonen und ins Projektverzeichnis wechseln.
3. Abhängigkeiten installieren:

   ```bash
   npm install
   ```

4. `.env` anhand der Vorlage `.env.example` anlegen.
5. Server starten:

   ```bash
   node src/server.js
   ```

   Der Server lauscht standardmäßig auf `0.0.0.0:3004` und protokolliert den
   Start in der Konsole.

6. Die Anwendung im Browser öffnen:

   - Standard-Portal: <http://localhost:3004>
   - Adminbereich: <http://localhost:3004/admin>

## Azure Entra ID (Microsoft Login)

Für den Admin-Login muss eine App-Registrierung in Azure Entra ID angelegt
werden:

1. Neue App in Azure Portal registrieren (Single-Page oder Web App).
2. In der App-Registrierung folgende Redirect-URI hinzufügen (falls Produktion
   abweicht entsprechend anpassen):
   `https://portal.febesol.com/auth/microsoft/callback`
3. Client-Secret erzeugen und zusammen mit Tenant-ID, Client-ID und Redirect-URI
   in `.env` hinterlegen.

Nur Benutzer mit `@febesol.de`-Adresse erhalten Zugriff auf den Adminbereich.

## Monday.com API

Für die Auftragsanzeige ist ein Monday.com GraphQL Token erforderlich. Das
Token wird als Bearer-Token im Header gesetzt und in `.env` abgelegt. Die
Boards und Spalten sind aktuell fest verdrahtet:

- Subunternehmer-Board: `4246150011`
- Auftrags-Boards: `1766160356`, `1766184997`
- Link-Spalten siehe Quellcode (werden zur Filterung verwendet)

Die Antwort enthält Platzhalter für Status, Fälligkeitsdatum und Notizen. Diese
Spalten können in Zukunft ergänzt werden (siehe TODO-Kommentar im Code).

## Umgebungsvariablen

Eine Beispielkonfiguration befindet sich in `.env.example`:

```env
PORT=3004
HOST=0.0.0.0
NODE_ENV=development
COOKIE_SECRET=change-me

MS_TENANT_ID=<azure-tenant-id>
MS_CLIENT_ID=<azure-client-id>
MS_CLIENT_SECRET=<azure-client-secret>
MS_REDIRECT_URI=https://portal.febesol.com/auth/microsoft/callback

MONDAY_API_TOKEN=<monday-api-token>
```

## NSSM Deployment

Für die Installation als Windows-Dienst mit NSSM bietet sich folgende
Konfiguration an:

```powershell
nssm install FebesolPortal "C:\Program Files\nodejs\node.exe" "C:\portal\src\server.js"
nssm set FebesolPortal AppDirectory "C:\portal"
nssm set FebesolPortal AppStdout "C:\portal\portal.log"
nssm set FebesolPortal AppStderr "C:\portal\portal.log"
```

Die Umgebung kann bei Bedarf über `nssm set FebesolPortal AppEnvironmentExtra
"PORT=3004"` konfiguriert werden.

## Datenhaltung

- **Konten** werden in `data/accounts.json` als Array von Objekten gespeichert
  (`email`, `passwordHash`, `contractorItemId`, `role`, `createdAt`). Passwörter
  werden mit Argon2 gehasht.
- **Aufträge** liegen in `data/orders.json` und enthalten Beispiel-Daten für die
  Boards `1766160356` und `1766184997` (werden künftig durch Live-Daten aus der
  Monday API ersetzt).

## Weitere Schritte

- Anbindung zusätzlicher Monday-Spalten (Status, Termine, Notizen) anstelle der
  aktuellen Platzhalter.
- Aufbau einer modernen Frontend-Oberfläche (z. B. React oder Server-Side
  Rendering) inklusive Darstellung aller relevanten Datenpunkte.
