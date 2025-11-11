const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');
const argon2 = require('argon2');
const { Issuer, generators } = require('openid-client');

const PORT = process.env.PORT || 3004;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, '..', 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const COOKIE_SECRET = process.env.COOKIE_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h
const SESSION_COOKIE_NAME = 'portal.sid';
const isProduction = process.env.NODE_ENV === 'production';
const allowedCorsOrigin = 'https://portal.febesol.com';

const mondayBoards = {
  contractorBoardId: '4246150011',
  orderBoardIds: ['1766160356', '1766184997'],
  linkingColumns: {
    '1766160356': ['ext__dc_partner_mkka8r', 'ext__ac_partner_mkkatjey'],
    '1766184997': ['ext__ac_partner_mkkvqqbf', 'ext__dc_partner_mkkvr93m'],
  },
};

if (!process.env.COOKIE_SECRET) {
  console.warn('WARNUNG: COOKIE_SECRET ist nicht gesetzt. Es wird ein temporäres Secret verwendet.');
}

const sessions = new Map(); // TODO: Für Produktion Redis oder vergleichbaren Storage einsetzen.
const loginRequests = new Map();
let openIdClientPromise;

function setSecurityHeaders(res) {
  if (!res.hasHeader('Content-Security-Policy')) {
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // TODO: CSP für benötigte Skripte/Styles nachschärfen, sobald Frontend steht.
  }
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && origin === allowedCorsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts: [] }, null, 2));
  }
  if (!fs.existsSync(ORDERS_FILE)) {
    const seed = {
      boards: {
        '1766160356': [
          {
            id: 'order-1001',
            name: 'Montage Auftrag 1001',
            linkedItems: {
              ext__dc_partner_mkka8r: 'item-2001',
            },
            status: 'offen',
          },
          {
            id: 'order-1002',
            name: 'Installation Auftrag 1002',
            linkedItems: {
              ext__ac_partner_mkkatjey: 'item-2002',
            },
            status: 'in_bearbeitung',
          },
        ],
        '1766184997': [
          {
            id: 'order-2001',
            name: 'Wartung Auftrag 2001',
            linkedItems: {
              ext__ac_partner_mkkvqqbf: 'item-2002',
            },
            status: 'geplant',
          },
        ],
      },
    };
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(seed, null, 2));
  }
}

function readAccounts() {
  ensureDataFiles();
  const stored = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8')).accounts || [];
  let mutated = false;
  const accounts = stored.map((account) => {
    const normalized = { ...account };
    if (normalized.email) {
      const lower = String(normalized.email).toLowerCase();
      if (lower !== normalized.email) {
        normalized.email = lower;
        mutated = true;
      }
    }
    if (!normalized.contractorItemId && normalized.mondayItemId) {
      normalized.contractorItemId = normalized.mondayItemId;
      delete normalized.mondayItemId;
      mutated = true;
    }
    if (
      normalized.contractorItemId !== undefined &&
      normalized.contractorItemId !== null
    ) {
      const asString = String(normalized.contractorItemId);
      if (asString !== normalized.contractorItemId) {
        normalized.contractorItemId = asString;
        mutated = true;
      }
    }
    if (!normalized.role) {
      normalized.role = 'user';
      mutated = true;
    }
    return normalized;
  });
  if (mutated) {
    writeAccounts(accounts);
  }
  return accounts;
}

function writeAccounts(accounts) {
  ensureDataFiles();
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts }, null, 2));
}

function readOrders() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8')).boards;
}

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
    .reduce((acc, cur) => {
      const [key, ...rest] = cur.split('=');
      acc[key] = decodeURIComponent(rest.join('='));
      return acc;
    }, {});
}

function signSessionId(rawId) {
  return crypto.createHmac('sha256', COOKIE_SECRET).update(rawId).digest('hex');
}

function createSession(payload) {
  const rawId = crypto.randomUUID();
  const signature = signSessionId(rawId);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(signature, { ...payload, expiresAt });
  return `${rawId}.${signature}`;
}

function getSession(req) {
  const cookies = parseCookies(req.headers['cookie']);
  const cookieValue = cookies[SESSION_COOKIE_NAME];
  if (!cookieValue) {
    return null;
  }
  const [rawId, signature] = cookieValue.split('.');
  if (!rawId || !signature) {
    return null;
  }
  let sigBuffer;
  let expectedBuffer;
  try {
    sigBuffer = Buffer.from(signature, 'hex');
    expectedBuffer = Buffer.from(signSessionId(rawId), 'hex');
  } catch (error) {
    return null;
  }
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null;
  }
  const session = sessions.get(signature);
  if (!session) {
    return null;
  }
  if (session.expiresAt <= Date.now()) {
    sessions.delete(signature);
    return null;
  }
  return session;
}

function buildSessionCookie(value, { expire = false } = {}) {
  const parts = [`${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`];
  parts.push('HttpOnly');
  parts.push('Path=/');
  parts.push('SameSite=Lax');
  if (isProduction) {
    parts.push('Secure');
  }
  if (expire) {
    parts.push('Max-Age=0');
  } else {
    parts.push(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  }
  return parts.join('; ');
}

function destroySession(req, res) {
  const cookies = parseCookies(req.headers['cookie']);
  const cookieValue = cookies[SESSION_COOKIE_NAME];
  if (cookieValue) {
    const [rawId, signature] = cookieValue.split('.');
    if (rawId && signature) {
      try {
        const expected = signSessionId(rawId);
        if (expected === signature && sessions.has(signature)) {
          sessions.delete(signature);
        }
      } catch (error) {
        // Ignorieren – Session wird weiter unten durch Cookie-Löschung entfernt.
      }
    }
  }
  res.setHeader('Set-Cookie', buildSessionCookie('', { expire: true }));
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.socket.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          resolve(JSON.parse(data));
          return;
        }
        if (contentType.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(data);
          const obj = {};
          for (const [key, value] of params.entries()) {
            obj[key] = value;
          }
          resolve(obj);
          return;
        }
        resolve({ raw: data });
      } catch (error) {
        reject(error);
      }
    });
  });
}

function serveStatic(req, res, filePath) {
  const ext = path.extname(filePath);
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  }[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function requireAuth(req, res, role) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { error: 'Unauthenticated' });
    return null;
  }
  if (role && session.role !== role) {
    sendJson(res, 403, { error: 'Unauthorized' });
    return null;
  }
  return session;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidContractorItemId(contractorItemId) {
  if (contractorItemId === undefined || contractorItemId === null) return false;
  if (typeof contractorItemId === 'number') return Number.isFinite(contractorItemId);
  if (typeof contractorItemId === 'string') return contractorItemId.trim().length > 0;
  return false;
}

async function initOpenIdClient() {
  if (!process.env.MS_TENANT_ID || !process.env.MS_CLIENT_ID || !process.env.MS_CLIENT_SECRET) {
    throw new Error('Microsoft Entra ID Konfiguration ist unvollständig.');
  }
  if (!openIdClientPromise) {
    openIdClientPromise = (async () => {
      const tenantId = process.env.MS_TENANT_ID;
      const issuerUrl = `https://login.microsoftonline.com/${tenantId}/v2.0`;
      const issuer = await Issuer.discover(`${issuerUrl}/.well-known/openid-configuration`);
      return new issuer.Client({
        client_id: process.env.MS_CLIENT_ID,
        client_secret: process.env.MS_CLIENT_SECRET,
        redirect_uris: [process.env.MS_REDIRECT_URI],
        response_types: ['code'],
      });
    })();
  }
  return openIdClientPromise;
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/login') {
    try {
      const body = await parseRequestBody(req);
      const { email, password } = body;
      if (!email || !password) {
        sendJson(res, 400, { error: 'E-Mail und Passwort sind erforderlich.' });
        return;
      }
      const normalizedEmail = String(email).toLowerCase();
      const accounts = readAccounts();
      const account = accounts.find((a) => a.email === normalizedEmail);
      if (!account) {
        sendJson(res, 401, { error: 'Ungültige Anmeldedaten.' });
        return;
      }
      const validPassword = await argon2.verify(account.passwordHash, password);
      if (!validPassword) {
        sendJson(res, 401, { error: 'Ungültige Anmeldedaten.' });
        return;
      }
      const sessionValue = createSession({
        id: account.id,
        email: account.email,
        role: account.role || 'user',
        contractorItemId: account.contractorItemId,
      });
      res.setHeader('Set-Cookie', buildSessionCookie(sessionValue));
      sendJson(res, 200, {
        message: 'Angemeldet',
        user: { email: account.email, role: account.role || 'user' },
      });
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: 'Interner Fehler.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    destroySession(req, res);
    sendJson(res, 200, { message: 'Abgemeldet' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/accounts') {
    const session = requireAuth(req, res, 'admin');
    if (!session) return;
    try {
      const body = await parseRequestBody(req);
      const { email, password, contractorItemId, role } = body;
      if (!email || !password || contractorItemId === undefined) {
        sendJson(res, 400, {
          error: 'E-Mail, Passwort und contractorItemId sind erforderlich.',
        });
        return;
      }
      const normalizedEmail = String(email).toLowerCase();
      if (!isValidEmail(normalizedEmail)) {
        sendJson(res, 400, { error: 'E-Mail-Adresse ist ungültig.' });
        return;
      }
      if (!isValidContractorItemId(contractorItemId)) {
        sendJson(res, 400, { error: 'contractorItemId ist ungültig.' });
        return;
      }
      const normalizedContractorId = String(contractorItemId);
      const selectedRole = role ? String(role) : 'user';
      if (!['user', 'admin'].includes(selectedRole)) {
        sendJson(res, 400, { error: 'role muss "user" oder "admin" sein.' });
        return;
      }
      const accounts = readAccounts();
      if (accounts.some((a) => a.email === normalizedEmail)) {
        sendJson(res, 409, { error: 'E-Mail ist bereits vergeben.' });
        return;
      }
      const passwordHash = await argon2.hash(password);
      const account = {
        id: crypto.randomUUID(),
        email: normalizedEmail,
        passwordHash,
        contractorItemId: normalizedContractorId,
        role: selectedRole,
        createdAt: new Date().toISOString(),
      };
      accounts.push(account);
      writeAccounts(accounts);
      const { passwordHash: _, ...responseAccount } = account;
      sendJson(res, 201, { account: responseAccount });
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: 'Interner Fehler.' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/accounts') {
    const session = requireAuth(req, res, 'admin');
    if (!session) return;
    const accounts = readAccounts().map(({ passwordHash, ...rest }) => rest);
    sendJson(res, 200, { accounts });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/orders') {
    const session = requireAuth(req, res);
    if (!session) return;
    try {
      const queryContractorId = url.searchParams.get('contractorItemId');
      const contractorItemId =
        session.role === 'admin' && queryContractorId
          ? String(queryContractorId)
          : session.contractorItemId;
      if (!contractorItemId) {
        sendJson(res, 400, { error: 'Kein contractorItemId vorhanden.' });
        return;
      }
      const allItems = [];
      for (const boardId of mondayBoards.orderBoardIds) {
        const columnIds = mondayBoards.linkingColumns[boardId] || [];
        const boardItems = await fetchMondayBoardItems(boardId, columnIds);
        allItems.push({ boardId, items: boardItems, columnIds });
      }
      const orders = filterOrdersForContractor(allItems, contractorItemId);
      sendJson(res, 200, { orders });
    } catch (error) {
      console.error(error);
      const message = error.expose ? error.message : 'Fehler bei der Kommunikation mit Monday.com.';
      sendJson(res, error.statusCode || 502, { error: message });
    }
    return;
  }

  sendJson(res, 404, { error: 'Nicht gefunden' });
}

async function handleAuth(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/auth/microsoft') {
    try {
      const client = await initOpenIdClient();
      const state = generators.state();
      const nonce = generators.nonce();
      const now = Date.now();
      for (const [storedState, meta] of loginRequests.entries()) {
        if (now - meta.createdAt > 15 * 60 * 1000) {
          loginRequests.delete(storedState);
        }
      }
      loginRequests.set(state, { nonce, createdAt: Date.now() });
      const authorizationUrl = client.authorizationUrl({
        scope: 'openid profile email',
        state,
        nonce,
        redirect_uri: process.env.MS_REDIRECT_URI,
      });
      res.writeHead(302, { Location: authorizationUrl });
      res.end();
    } catch (error) {
      console.error(error);
      sendJson(res, 500, {
        error: 'Microsoft Login ist nicht konfiguriert. Bitte wenden Sie sich an den Administrator.',
      });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/auth/microsoft/callback') {
    try {
      const client = await initOpenIdClient();
      const params = client.callbackParams(req);
      const storedState = params.state && loginRequests.get(params.state);
      if (!storedState) {
        sendJson(res, 400, { error: 'Ungültiger oder abgelaufener Login-Status.' });
        return;
      }
      loginRequests.delete(params.state);
      const tokenSet = await client.callback(
        process.env.MS_REDIRECT_URI,
        params,
        { state: params.state, nonce: storedState.nonce }
      );
      const claims = tokenSet.claims();
      const email = claims.email || claims.preferred_username;
      if (!email || !email.toLowerCase().endsWith('@febesol.de')) {
        sendJson(res, 403, {
          error: 'Der Microsoft-Login ist nur für @febesol.de Konten erlaubt.',
        });
        return;
      }
      const sessionValue = createSession({
        id: claims.sub,
        email: email.toLowerCase(),
        role: 'admin',
      });
      res.setHeader('Set-Cookie', buildSessionCookie(sessionValue));
      res.writeHead(302, { Location: '/admin' });
      res.end();
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: 'Microsoft Login fehlgeschlagen.' });
    }
    return;
  }

  sendJson(res, 404, { error: 'Nicht gefunden' });
}

async function fetchMondayBoardItems(boardId, columnIds = []) {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    const error = new Error('MONDAY_API_TOKEN ist nicht gesetzt.');
    error.statusCode = 502;
    error.expose = true;
    throw error;
  }

  const results = [];
  const limit = 100;
  let page = 1;
  const requestPayload = (pageNumber) => ({
    query: `query ($boardId: [ID!], $limit: Int!, $page: Int!, $columnIds: [String!]) {
      boards(ids: $boardId) {
        items_page(limit: $limit, page: $page) {
          items {
            id
            name
            column_values(ids: $columnIds) {
              id
              value
              text
            }
          }
          more_items
        }
      }
    }`,
    variables: {
      boardId: [boardId],
      limit,
      page: pageNumber,
      columnIds,
    },
  });

  while (true) {
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestPayload(page)),
    });

    if (!response.ok) {
      const error = new Error(`Monday API antwortete mit Status ${response.status}.`);
      error.statusCode = 502;
      throw error;
    }

    const payload = await response.json();
    if (payload.errors && payload.errors.length) {
      const error = new Error('Monday API meldete einen Fehler.');
      error.statusCode = 502;
      throw error;
    }

    const board = payload?.data?.boards?.[0];
    const pageData = board?.items_page;
    const items = pageData?.items || [];
    for (const item of items) {
      const columnValues = (item.column_values || []).reduce((acc, column) => {
        acc[column.id] = { value: column.value, text: column.text };
        return acc;
      }, {});
      results.push({
        boardId,
        itemId: item.id,
        name: item.name,
        columnValues,
      });
    }

    if (!pageData?.more_items) {
      break;
    }
    page += 1;
  }

  return results;
}

function extractLinkedContractorIds(columnValueEntry = {}) {
  const collected = new Set();
  const candidates = [];
  if (typeof columnValueEntry.value === 'string' && columnValueEntry.value.trim()) {
    candidates.push(columnValueEntry.value);
  }
  if (typeof columnValueEntry.text === 'string' && columnValueEntry.text.trim()) {
    candidates.push(columnValueEntry.text);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const linkedIds = parsed?.linkedPulseIds || parsed?.linkedPulseId || parsed;
      const list = Array.isArray(linkedIds) ? linkedIds : linkedIds ? [linkedIds] : [];
      for (const entry of list) {
        const rawId =
          typeof entry === 'object' && entry !== null
            ? entry.linkedPulseId || entry.pulseId || entry.id
            : entry;
        if (rawId) {
          const asString = String(rawId);
          collected.add(asString);
          collected.add(`${mondayBoards.contractorBoardId}_${asString}`);
        }
      }
    } catch (error) {
      const raw = candidate.split(',').map((v) => v.trim()).filter(Boolean);
      for (const value of raw) {
        collected.add(value);
      }
    }
  }

  return Array.from(collected);
}

function filterOrdersForContractor(boardItems, contractorItemId) {
  const normalizedId = String(contractorItemId);
  const orders = [];
  for (const { boardId, items, columnIds } of boardItems) {
    for (const item of items) {
      const linkedIds = [];
      for (const columnId of columnIds) {
        const entry = item.columnValues[columnId];
        const values = extractLinkedContractorIds(entry);
        for (const value of values) {
          if (!linkedIds.includes(value)) {
            linkedIds.push(value);
          }
        }
      }
      if (linkedIds.includes(normalizedId)) {
        orders.push({
          boardId,
          itemId: item.itemId,
          name: item.name,
          linkedContractorItemIds: linkedIds,
          placeholders: {
            status: 'PLATZHALTER',
            due_date: 'PLATZHALTER',
            notes: 'PLATZHALTER', // TODO: Reale Monday-Spalten anbinden.
          },
        });
      }
    }
  }
  return orders;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    applyCors(req, res);
    setSecurityHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    if (url.pathname.startsWith('/auth/')) {
      await handleAuth(req, res, url);
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      serveStatic(req, res, path.join(__dirname, '..', 'public', 'index.html'));
      return;
    }

    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') {
        res.writeHead(302, { Location: '/auth/microsoft' });
        res.end();
      } else {
        serveStatic(req, res, path.join(__dirname, '..', 'public', 'admin', 'index.html'));
      }
      return;
    }

    if (url.pathname === '/admin/login') {
      serveStatic(req, res, path.join(__dirname, '..', 'public', 'admin', 'login.html'));
      return;
    }

    const publicPath = path.join(__dirname, '..', 'public');
    const filePath = path.normalize(path.join(publicPath, url.pathname));
    if (
      filePath.startsWith(publicPath) &&
      fs.existsSync(filePath) &&
      fs.statSync(filePath).isFile()
    ) {
      serveStatic(req, res, filePath);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (error) {
    console.error('Unhandled error', error);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Interner Serverfehler' }));
  }
});

ensureDataFiles();

server.listen(PORT, HOST, () => {
  console.log(`Portal server running at http://${HOST}:${PORT}`);
});
