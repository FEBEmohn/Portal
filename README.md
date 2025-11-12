# Febesol Portal

Das Projekt stellt einen leichtgewichtigen, Express-kompatiblen Server bereit,
der zwei getrennte Authentifizierungswege kombiniert:

- **Microsoft OIDC Login** für Administratoren unter `/admin`.
- **Lokale Benutzerkonten** für Partner unter `/` inkl. Dashboard.

Sitzungen laufen jeweils 30 Minuten und werden ausschließlich durch aktive
Button-Interaktionen verlängert.

## Voraussetzungen & Installation

1. Node.js ≥ 18 installieren.
2. Repository klonen und in das Projektverzeichnis wechseln.
3. Optional: Die wenigen externen Abhängigkeiten (`argon2`, `openid-client`)
   installieren, falls sie in der Zielumgebung nicht bereits vorhanden sind:

   ```bash
   npm install
   ```

4. Eine `.env` auf Basis von [`.env.example`](./.env.example) anlegen.
5. Server starten:

   ```bash
   node src/server.js
   ```

   Standardmäßig lauscht der Server auf `0.0.0.0:3004`.

## Microsoft OIDC für den Adminbereich

1. In Azure Entra ID eine **Web App** registrieren.
2. Folgende Redirect-URI hinterlegen (ggf. an Umgebung anpassen):
   `https://<host>/auth/microsoft/callback`.
3. **Client-ID**, **Client-Secret**, **Tenant-ID** und Redirect-URI in die `.env`
   eintragen (`MICROSOFT_*`).
4. Mit `ADMIN_ALLOWED_IDENTIFIERS` steuern, welche Konten Zugriff erhalten. Die
   Liste akzeptiert E-Mail-Adressen, `preferred_username`, Objekt-IDs (`oid`) oder
   `sub`-Werte – Komma-separiert.

Nach erfolgreichem Login wird in der Session vermerkt, dass es sich um einen
verifizierten Admin handelt. Auf nicht autorisierte Konten reagiert `/admin`
mit einem Hinweis statt 404/403.

## Lokale Benutzerverwaltung

- Lokale Konten werden im Adminbereich verwaltet. Es steht ein Formular zum
  Anlegen/Ändern von Benutzern und eine Liste zum Löschen vorhandener Konten zur
  Verfügung.
- Die Daten landen in `data/accounts.json`. Passwörter werden mit `argon2`
  gehasht; weder Klartext noch Argon2-Parameter müssen manuell gepflegt werden.
- Lokale Nutzer melden sich auf `/` an und gelangen anschließend zum geschützten
  `/dashboard`.

## Sessions & Idle-Reset

- Eine eingebaute Session-Implementierung nutzt einen 30-Minuten-Cookie
  (`maxAge = 30 * 60 * 1000`).
- In Produktion werden `cookie.secure = true`, `sameSite = 'lax'` und
  `httpOnly = true` gesetzt.
- Die Middleware `resetIdleOnAction` ruft `req.session.touch()` **nur** bei
  `POST`-Requests sowie beim Endpoint `POST /session/ping` auf. Dadurch verlängert
  sich die Session ausschließlich bei tatsächlichen Interaktionen.
- Formulare und Buttons lösen daher entweder einen `POST` aus (z. B. Login,
  Logout, Benutzerverwaltung) oder schicken per JS `fetch('/session/ping', { method: 'POST' })`.

## Umgebungsvariablen

Siehe [`.env.example`](./.env.example) für eine vollständige Liste. Wichtige
Variablen im Überblick:

| Variable                     | Beschreibung                                       |
| ---------------------------- | -------------------------------------------------- |
| `PORT`, `HOST`               | Adresse des HTTP-Servers                           |
| `SESSION_SECRET`             | Secret zur Signierung der Session-Cookies          |
| `MICROSOFT_TENANT_ID`        | Azure Entra ID Tenant                              |
| `MICROSOFT_CLIENT_ID`        | App-Registrierung Client-ID                        |
| `MICROSOFT_CLIENT_SECRET`    | App-Registrierung Secret                           |
| `MICROSOFT_REDIRECT_URI`     | Redirect-URI der App                               |
| `ADMIN_ALLOWED_IDENTIFIERS`  | Komma-separierte Liste erlaubter Admin-Konten      |

## Troubleshooting

- **403/Redirect-Schleifen**: Sicherstellen, dass
  `ADMIN_ALLOWED_IDENTIFIERS` den Microsoft-Account enthält bzw. dass lokale
  Nutzer ein Konto besitzen.
- **404 auf `/admin`**: Die Route existiert immer; ein fehlender Login zeigt den
  Microsoft-Button. Prüfen Sie, ob das Frontend versehentlich eine andere Route
  ansteuert.
- **Session/Cookie-Probleme hinter Nginx**: Sicherstellen, dass TLS-Termination
  den Client weiterhin als HTTPS identifiziert und `cookie.secure` nicht blockiert.
- **OIDC-Fehler nach Login**: Redirect-URI exakt mit Azure-Konfiguration
  abgleichen (einschließlich Protokoll) und bei Bedarf neue Secrets generieren.

## Kurz-Testplan

1. `GET /healthz` → `ok`.
2. `GET /admin` (ohne Session) → Seite mit Button „Login mit Microsoft“.
3. Button klicken → OIDC-Flow → nach Erfolg `/admin` erreichbar (Admin-Benutzer).
4. `GET /` → lokale Login-Seite; `POST /login` prüft Argon2-Credentials.
5. Nach lokalem Login → `/dashboard` erreichbar.
6. >30 Minuten ohne Interaktion warten → Session erlischt, erneuter Login nötig.
7. Buttons/Formulare klicken → Session verlängert sich (über `POST` oder
   `POST /session/ping`).
