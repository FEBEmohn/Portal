const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, '..', '..', 'data', 'users.json');

function ensureStore() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2));
  }
}

async function readStore() {
  ensureStore();
  const raw = await fs.promises.readFile(DB_FILE, 'utf-8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.users)) {
    data.users = [];
  }
  return data;
}

async function writeStore(data) {
  await fs.promises.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

async function all() {
  const data = await readStore();
  return data.users;
}

async function findByEmail(email) {
  if (!email) {
    return null;
  }
  const data = await readStore();
  const needle = String(email).trim().toLowerCase();
  return (
    data.users.find((user) => user.email && user.email.toLowerCase() === needle) || null
  );
}

async function addOrUpdate(user) {
  const data = await readStore();
  const id = user.id || crypto.randomUUID();
  const normalizedEmail = user.email ? String(user.email).trim().toLowerCase() : null;
  const existingIndex = data.users.findIndex(
    (entry) => entry.id === id || (normalizedEmail && entry.email === normalizedEmail)
  );

  const record = {
    id,
    email: normalizedEmail,
    name: user.name || '',
    passwordHash: user.passwordHash,
  };

  if (existingIndex >= 0) {
    data.users.splice(existingIndex, 1, { ...data.users[existingIndex], ...record });
  } else {
    data.users.push(record);
  }

  await writeStore(data);
  return record;
}

module.exports = {
  all,
  findByEmail,
  addOrUpdate,
};
