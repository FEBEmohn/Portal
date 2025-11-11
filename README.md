# Febesol Subunternehmer Portal

Dieses Repository enthält ein leichtgewichtiges Grundgerüst für das geplante
Portal unter `portal.febesol.com`. Die Anwendung ist in Node.js (ohne externe
Bibliotheken) umgesetzt und liefert die grundlegende Struktur für folgende
Bereiche:

- **Microsoft Login für Admins** – aktuell als Mock-Login umgesetzt. Eine echte
  Azure AD Integration kann später über `/auth/microsoft/callback` ergänzt
  werden.
- **Adminbereich** unter `/admin` – nach erfolgreicher Anmeldung können hier
  Subunternehmer-Konten verwaltet und mit Items aus dem Board `4246150011`
  verknüpft werden.
- **Standard-Portal** unter `/` – ermöglicht die Anmeldung per lokalem Konto
  und zeigt die Aufträge aus den Boards `1766160356` und `1766184997`, sofern
  sie mit dem jeweiligen Item aus dem Subunternehmer-Board verknüpft sind.

## Entwicklungs-Setup

1. Node.js ≥ 18 installieren.
2. Repository klonen und ins Projektverzeichnis wechseln.
3. Server starten:

   ```bash
   node src/server.js
   ```

   Der Server lauscht standardmäßig auf `0.0.0.0:3004` und protokolliert den
   Start in der Konsole.

4. Die Anwendung im Browser öffnen:

   - Standard-Portal: <http://localhost:3004>
   - Adminbereich: <http://localhost:3004/admin>

## NSSM Deployment

Für die Installation als Windows-Dienst mit NSSM bietet sich folgende
Konfiguration an:

```powershell
nssm install FebesolPortal "C:\\Program Files\\nodejs\\node.exe" "C:\\portal\\src\\server.js"
nssm set FebesolPortal AppDirectory "C:\\portal"
nssm set FebesolPortal AppStdout "C:\\portal\\portal.log"
nssm set FebesolPortal AppStderr "C:\\portal\\portal.log"
```

Die Umgebung kann bei Bedarf über `nssm set FebesolPortal AppEnvironmentExtra
"PORT=3004"` konfiguriert werden.

## Datenhaltung

- **Konten** werden in `data/accounts.json` als Array von Objekten gespeichert
  (`email`, `passwordHash`, `mondayItemId`). Passwörter werden mit PBKDF2
  gehasht.
- **Aufträge** liegen in `data/orders.json` und enthalten Beispiel-Daten für die
  Boards `1766160356` und `1766184997`.

## Weitere Schritte

- Austausch des Mock-Logins durch eine echte Microsoft OAuth 2.0 / OpenID
  Connect Integration.
- Anbindung an die Monday.com API, um Konten mit Items im Board `4246150011`
  und Auftragsdaten dynamisch zu synchronisieren.
- Aufbau einer modernen Frontend-Oberfläche (z. B. React oder Server-Side
  Rendering) inklusive Darstellung aller relevanten Monday-Spalten.
