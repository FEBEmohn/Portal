const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3004;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, '..', 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

const mondayBoards = {
  contractorBoardId: '4246150011',
  orderBoardIds: ['1766160356', '1766184997'],
  linkingColumns: {
    '1766160356': ['ext__dc_partner_mkka8r', 'ext__ac_partner_mkkatjey'],
    '1766184997': ['ext__ac_partner_mkkvqqbf', 'ext__dc_partner_mkkvr93m'],
  },
};

const sessions = new Map();

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
  return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8')).accounts;
}

function writeAccounts(accounts) {
  ensureDataFiles();
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts }, null, 2));
}

function readOrders() {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8')).boards;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto
    .pbkdf2Sync(password, salt, 10000, 64, 'sha512')
    .toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const inputHash = crypto
    .pbkdf2Sync(password, salt, 10000, 64, 'sha512')
    .toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(inputHash, 'hex'));
}

function generateSession(user) {
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + 1000 * 60 * 60 * 12; // 12h
  sessions.set(sessionId, { ...user, expiresAt });
  return sessionId;
}

function getSession(req) {
  const cookies = (req.headers['cookie'] || '')
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
    .reduce((acc, cur) => {
      const [key, ...rest] = cur.split('=');
      acc[key] = decodeURIComponent(rest.join('='));
      return acc;
    }, {});
  const sessionId = cookies['portal.sid'];
  if (!sessionId || !sessions.has(sessionId)) {
    return null;
  }
  const session = sessions.get(sessionId);
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

function destroySession(req, res) {
  const cookies = (req.headers['cookie'] || '')
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
    .reduce((acc, cur) => {
      const [key, ...rest] = cur.split('=');
      acc[key] = decodeURIComponent(rest.join('='));
      return acc;
    }, {});
  const sessionId = cookies['portal.sid'];
  if (sessionId && sessions.has(sessionId)) {
    sessions.delete(sessionId);
  }
  res.setHeader('Set-Cookie', 'portal.sid=; HttpOnly; Path=/; Max-Age=0');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
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

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/login') {
    try {
      const body = await parseRequestBody(req);
      const { email, password } = body;
      if (!email || !password) {
        sendJson(res, 400, { error: 'E-Mail und Passwort sind erforderlich.' });
        return;
      }
      const accounts = readAccounts();
      const account = accounts.find((a) => a.email === email.toLowerCase());
      if (!account || !verifyPassword(password, account.passwordHash)) {
        sendJson(res, 401, { error: 'Ungültige Anmeldedaten.' });
        return;
      }
      const sessionId = generateSession({
        id: account.id,
        email: account.email,
        role: 'standard',
        mondayItemId: account.mondayItemId,
      });
      res.setHeader(
        'Set-Cookie',
        `portal.sid=${sessionId}; HttpOnly; Path=/; Max-Age=${60 * 60 * 12}`,
      );
      sendJson(res, 200, { message: 'Angemeldet', user: { email: account.email } });
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
      const { email, password, mondayItemId } = body;
      if (!email || !password || !mondayItemId) {
        sendJson(res, 400, {
          error: 'E-Mail, Passwort und Monday-Item-ID sind erforderlich.',
        });
        return;
      }
      const normalizedEmail = email.toLowerCase();
      const accounts = readAccounts();
      if (accounts.some((a) => a.email === normalizedEmail)) {
        sendJson(res, 409, { error: 'E-Mail ist bereits vergeben.' });
        return;
      }
      const account = {
        id: crypto.randomUUID(),
        email: normalizedEmail,
        passwordHash: hashPassword(password),
        mondayItemId,
        createdAt: new Date().toISOString(),
      };
      accounts.push(account);
      writeAccounts(accounts);
      sendJson(res, 201, { account: { ...account, passwordHash: undefined } });
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
    const boards = readOrders();
    const assignedOrders = [];
    for (const boardId of mondayBoards.orderBoardIds) {
      const boardOrders = boards[boardId] || [];
      const columns = mondayBoards.linkingColumns[boardId] || [];
      for (const order of boardOrders) {
        if (columns.some((columnId) => order.linkedItems?.[columnId] === session.mondayItemId)) {
          assignedOrders.push({
            boardId,
            ...order,
          });
        }
      }
    }
    sendJson(res, 200, { orders: assignedOrders });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/auth/microsoft/mock-login') {
    const queryEmail = url.searchParams.get('email');
    if (!queryEmail || !queryEmail.endsWith('@febesol.de')) {
      sendJson(res, 400, {
        error: 'Für den Mock-Login muss eine @febesol.de Adresse angegeben werden.',
      });
      return;
    }
    const sessionId = generateSession({
      id: crypto.randomUUID(),
      email: queryEmail.toLowerCase(),
      role: 'admin',
    });
    res.setHeader(
      'Set-Cookie',
      `portal.sid=${sessionId}; HttpOnly; Path=/; Max-Age=${60 * 60 * 12}`,
    );
    sendJson(res, 200, { message: 'Mock-Login erfolgreich', email: queryEmail });
    return;
  }

  sendJson(res, 404, { error: 'Nicht gefunden' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      await handleApi(req, res, url);
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      serveStatic(req, res, path.join(__dirname, '..', 'public', 'index.html'));
      return;
    }

    if (url.pathname === '/admin' || url.pathname === '/admin/index.html') {
      const session = getSession(req);
      if (!session || session.role !== 'admin') {
        serveStatic(req, res, path.join(__dirname, '..', 'public', 'admin', 'login.html'));
      } else {
        serveStatic(req, res, path.join(__dirname, '..', 'public', 'admin', 'index.html'));
      }
      return;
    }

    const publicPath = path.join(__dirname, '..', 'public');
    const filePath = path.normalize(path.join(publicPath, url.pathname));
    if (filePath.startsWith(publicPath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      serveStatic(req, res, filePath);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (error) {
    console.error('Unhandled error', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Interner Serverfehler' }));
  }
});

ensureDataFiles();

server.listen(PORT, HOST, () => {
  console.log(`Portal server running at http://${HOST}:${PORT}`);
});
