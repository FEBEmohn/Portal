# Portal

Das Projekt stellt einen Express-Server bereit, der zwei getrennte
Authentifizierungswege kombiniert:

- **Microsoft OIDC Login** für Administrator:innen unter `/admin`.
- **Lokaler Login** (E-Mail & Passwort) für Partner:innen unter `/login`.

Eine Sitzung entsteht erst nach einem erfolgreichen Login. Anschließend gilt
ein Idle-Timeout von 30 Minuten, das ausschließlich durch POST-Interaktionen
(z. B. Formulare oder `POST /session/ping`) zurückgesetzt wird.

## Voraussetzungen & Installation

1. Node.js ≥ 18 installieren.
2. Repository klonen und in das Projektverzeichnis wechseln.
3. Abhängigkeiten installieren:

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
2. Den Issuer (z. B. `https://login.microsoftonline.com/<tenant>/v2.0`)
   und die Redirect-URI `https://<host>/auth/microsoft/callback` notieren.
3. Die `.env` mit `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` und
   `OIDC_REDIRECT_URI` befüllen.
4. Über `ADMIN_USERS` (Komma-separiert) steuern, welche Microsoft-Accounts Zugriff
   erhalten – zugelassen sind E-Mails, `preferred_username`, `oid` oder `sub`.

Nicht berechtigte Accounts landen wieder auf `/admin`, ohne dass eine 404/403
ausgegeben wird.

## Lokaler Login

- Lokale Accounts werden in `data/users.json` hinterlegt. Passwörter sind mit
  `argon2` gehasht.
- Unauthentifizierte Aufrufe von `/login` liefern immer das Login-Formular.
- Nach erfolgreichem Login gelangen Partner:innen auf die Startseite (`/start`).
- Ein Demo-Account ist bereits hinterlegt: `test@partner.de` / `Mustermann`.

## Sessions & Idle-Timeout

- `express-session` arbeitet mit `saveUninitialized: false`, es entsteht also
  keine Session, bevor ein Login erfolgreich war.
- Nach dem Login wird `cookie.maxAge` auf `30 * 60 * 1000` gesetzt (`rolling: false`).
- Der Idle-Timer (`req.session.lastActivity`) wird nur bei `POST`-Interaktionen
  oder `POST /session/ping` aktualisiert. Reine GET-Aufrufe verlängern die Session
  nicht.
- `helmet`, `cookie-parser` und `app.set('trust proxy', 1)` sind standardmäßig aktiv.

## Umgebungsvariablen

| Variable            | Beschreibung                               |
| ------------------- | ------------------------------------------ |
| `PORT`, `HOST`      | Adresse des HTTP-Servers                    |
| `SESSION_SECRET`    | Secret zur Signierung der Session-Cookies   |
| `OIDC_ISSUER`       | OIDC-Issuer (z. B. Microsoft)               |
| `OIDC_CLIENT_ID`    | Client-ID der App-Registrierung             |
| `OIDC_CLIENT_SECRET`| Client-Secret der App-Registrierung         |
| `OIDC_REDIRECT_URI` | Redirect-URI für den OIDC-Flow              |
| `ADMIN_USERS`       | Komma-separierte Liste erlaubter Admins     |

## Checks

1. `GET /healthz` → `ok`.
2. `GET /admin` ohne Session → Login-Seite mit „Login mit Microsoft“.
3. Erfolgreicher Microsoft-Login → Admin-Dashboard erreichbar, weitere Unterseiten
   wie `/admin/users` verlangen eine Admin-Session.
4. `GET /login` → lokales Loginformular, kein 403.
5. Lokaler Login → `/start` erreichbar, Logout zerstört die Session.
6. Nach >30 Minuten ohne Interaktion → Session ungültig, erneuter Login erforderlich.
