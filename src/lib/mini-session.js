const crypto = require('crypto');

function capitalize(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${value}`];
  parts.push('Path=/');
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  }
  if (options.httpOnly !== false) {
    parts.push('HttpOnly');
  }
  if (options.sameSite) {
    parts.push(`SameSite=${capitalize(options.sameSite)}`);
  }
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function expireCookie(name) {
  return `${name}=; Path=/; Max-Age=0`;
}

module.exports = function session(options = {}) {
  const store = new Map();
  const cookieName = options.name || 'sid';
  const cookieOptions = options.cookie || {};
  const rolling = Boolean(options.rolling);
  const saveUninitialized = options.saveUninitialized !== false;
  const resave = Boolean(options.resave);
  const ttl = cookieOptions.maxAge || 30 * 60 * 1000;

  function ensureRecord(meta, res) {
    if (!meta.id) {
      meta.id = generateId();
      meta.record = { data: meta.record.data || {}, expiresAt: Date.now() + ttl };
      store.set(meta.id, meta.record);
      res.appendHeader('Set-Cookie', serializeCookie(cookieName, meta.id, cookieOptions));
    } else {
      meta.record.expiresAt = Date.now() + ttl;
      if (rolling) {
        res.appendHeader('Set-Cookie', serializeCookie(cookieName, meta.id, cookieOptions));
      }
    }
  }

  function touch(meta, res) {
    if (!meta.id) {
      return;
    }
    meta.record.expiresAt = Date.now() + ttl;
    res.appendHeader('Set-Cookie', serializeCookie(cookieName, meta.id, cookieOptions));
  }

  function wrapSession(req, res, meta) {
    const target = meta.record.data || {};
    meta.record.data = target;
    const methodNames = new Set(['touch', 'save', 'destroy', 'regenerate']);
    let bypassDetection = false;

    const handler = {
      get(obj, prop) {
        if (prop === '__meta') {
          return meta;
        }
        return obj[prop];
      },
      set(obj, prop, value) {
        if (!bypassDetection && !methodNames.has(prop)) {
          meta.dirty = true;
          ensureRecord(meta, res);
        }
        obj[prop] = value;
        return true;
      },
      deleteProperty(obj, prop) {
        if (!bypassDetection && !methodNames.has(prop)) {
          meta.dirty = true;
          ensureRecord(meta, res);
        }
        delete obj[prop];
        return true;
      },
      defineProperty(obj, prop, descriptor) {
        return Reflect.defineProperty(obj, prop, descriptor);
      },
    };

    const sessionProxy = new Proxy(target, handler);

    function defineMethod(name, fn) {
      bypassDetection = true;
      Object.defineProperty(sessionProxy, name, {
        value: fn,
        enumerable: false,
        configurable: true,
        writable: true,
      });
      bypassDetection = false;
    }

    defineMethod('touch', (cb) => {
      ensureRecord(meta, res);
      touch(meta, res);
      if (cb) cb();
    });

    defineMethod('save', (cb) => {
      ensureRecord(meta, res);
      meta.record.data = target;
      meta.record.expiresAt = Date.now() + ttl;
      if (resave || meta.dirty) {
        res.appendHeader('Set-Cookie', serializeCookie(cookieName, meta.id, cookieOptions));
        meta.dirty = false;
      }
      if (cb) cb();
    });

    defineMethod('destroy', (cb) => {
      if (meta.id) {
        store.delete(meta.id);
        res.appendHeader('Set-Cookie', expireCookie(cookieName));
      }
      meta.id = null;
      meta.record = { data: {} };
      meta.dirty = false;
      Object.keys(target).forEach((key) => {
        delete target[key];
      });
      if (cb) cb();
    });

    defineMethod('regenerate', (cb) => {
      if (meta.id) {
        store.delete(meta.id);
      }
      const newId = generateId();
      meta.id = newId;
      meta.record = { data: {}, expiresAt: Date.now() + ttl };
      meta.dirty = false;
      Object.keys(target).forEach((key) => {
        delete target[key];
      });
      const replacement = wrapSession(req, res, meta);
      req.session = replacement;
      req.sessionID = meta.id;
      res.appendHeader('Set-Cookie', serializeCookie(cookieName, meta.id, cookieOptions));
      if (cb) cb();
    });

    return sessionProxy;
  }

  return function sessionMiddleware(req, res, next) {
    let existingId = req.cookies && req.cookies[cookieName];
    let record;
    if (existingId) {
      record = store.get(existingId);
      if (record && record.expiresAt && record.expiresAt <= Date.now()) {
        store.delete(existingId);
        record = null;
        existingId = null;
      }
    }

    const meta = {
      id: existingId || null,
      record: record || { data: {} },
      dirty: false,
    };

    if (existingId && record) {
      touch(meta, res);
    }

    req.sessionID = meta.id;
    req.session = wrapSession(req, res, meta);

    const originalEnd = res.end;
    res.end = function patchedEnd(chunk, encoding, callback) {
      if ((saveUninitialized || meta.dirty || meta.id) && meta.id) {
        ensureRecord(meta, res);
      }
      res.end = originalEnd;
      return originalEnd.call(res, chunk, encoding, callback);
    };

    next();
  };
};
