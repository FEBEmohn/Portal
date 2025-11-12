const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const argon2 = require('argon2');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(ACCOUNTS_FILE)) {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts: [] }, null, 2));
  }
}

function loadAccounts() {
  ensureStore();
  const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  let mutated = false;

  const normalized = accounts.map((account) => {
    const updated = { ...account };

    if (!updated.id) {
      updated.id = crypto.randomUUID();
      mutated = true;
    }

    if (updated.email) {
      const lower = String(updated.email).toLowerCase();
      if (lower !== updated.email) {
        updated.email = lower;
        mutated = true;
      }
    }

    if (updated.username) {
      const lower = String(updated.username).toLowerCase();
      if (lower !== updated.username) {
        updated.username = lower;
        mutated = true;
      }
    }

    if (!updated.displayName) {
      updated.displayName = '';
    }

    if (!updated.role) {
      updated.role = 'user';
      mutated = true;
    }

    if (!updated.createdAt) {
      updated.createdAt = new Date().toISOString();
      mutated = true;
    }

    if (!updated.updatedAt) {
      updated.updatedAt = updated.createdAt;
      mutated = true;
    }

    if (!updated.passwordHash) {
      updated.passwordHash = null;
    }

    return updated;
  });

  if (mutated) {
    persistAccounts(normalized);
  }

  return normalized;
}

function persistAccounts(accounts) {
  ensureStore();
  fs.writeFileSync(
    ACCOUNTS_FILE,
    JSON.stringify(
      {
        accounts,
      },
      null,
      2
    )
  );
}

function toPublicUser(account) {
  return {
    id: account.id,
    email: account.email,
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function listUsers() {
  return loadAccounts().map(toPublicUser);
}

async function upsertUser({ id, email, username, displayName, role, password }) {
  const normalizedEmail = email ? String(email).trim().toLowerCase() : undefined;
  const normalizedUsername = username ? String(username).trim().toLowerCase() : undefined;

  if (!normalizedEmail && !normalizedUsername) {
    throw new Error('Ein Benutzer benötigt mindestens eine E-Mail-Adresse oder einen Benutzernamen.');
  }

  if (!password && !id) {
    throw new Error('Für neue Benutzer muss ein Passwort gesetzt werden.');
  }

  const accounts = loadAccounts();
  const timestamp = new Date().toISOString();

  let account = id ? accounts.find((entry) => entry.id === id) : undefined;

  if (!account && normalizedEmail) {
    account = accounts.find((entry) => entry.email === normalizedEmail);
  }

  if (!account && normalizedUsername) {
    account = accounts.find((entry) => entry.username === normalizedUsername);
  }

  if (!account) {
    account = {
      id: crypto.randomUUID(),
      email: normalizedEmail,
      username: normalizedUsername,
      displayName: displayName || '',
      role: role || 'user',
      passwordHash: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    accounts.push(account);
  } else {
    account.email = normalizedEmail || account.email;
    account.username = normalizedUsername || account.username;
    account.displayName = displayName ?? account.displayName;
    account.role = role || account.role;
    account.updatedAt = timestamp;
  }

  if (password) {
    account.passwordHash = await argon2.hash(password);
    account.updatedAt = timestamp;
  }

  persistAccounts(accounts);

  return toPublicUser(account);
}

function removeUser(id) {
  const accounts = loadAccounts();
  const index = accounts.findIndex((entry) => entry.id === id);

  if (index === -1) {
    return false;
  }

  accounts.splice(index, 1);
  persistAccounts(accounts);
  return true;
}

async function verifyUserCredentials(identifier, password) {
  const normalizedIdentifier = String(identifier || '').trim().toLowerCase();
  if (!normalizedIdentifier || !password) {
    return null;
  }

  const accounts = loadAccounts();
  const account = accounts.find(
    (entry) => entry.email === normalizedIdentifier || entry.username === normalizedIdentifier
  );

  if (!account || !account.passwordHash) {
    return null;
  }

  const passwordMatches = await argon2.verify(account.passwordHash, password);

  if (!passwordMatches) {
    return null;
  }

  return toPublicUser(account);
}

module.exports = {
  listUsers,
  removeUser,
  upsertUser,
  verifyUserCredentials,
};
