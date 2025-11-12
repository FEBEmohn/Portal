const ADMIN_ALLOWED_IDENTIFIERS = (process.env.ADMIN_ALLOWED_IDENTIFIERS || '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

function isIdentifierAllowed(claims) {
  if (ADMIN_ALLOWED_IDENTIFIERS.length === 0) {
    console.warn(
      'ADMIN_ALLOWED_IDENTIFIERS is empty. No Microsoft account will be granted admin access.'
    );
    return false;
  }

  const candidates = [claims.email, claims.preferred_username, claims.oid, claims.sub]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return candidates.some((value) => ADMIN_ALLOWED_IDENTIFIERS.includes(value));
}

function ensureSession(req) {
  if (!req.session) {
    throw new Error('Session middleware must be mounted before auth middleware.');
  }
}

function requireAuthLocal(req, res, next) {
  ensureSession(req);
  if (req.session.authType === 'local' && req.session.user) {
    return next();
  }
  return res.redirect('/');
}

function requireAdmin(req, res, next) {
  ensureSession(req);
  if (req.session.authType === 'microsoft' && req.session.user?.isAdmin) {
    return next();
  }
  return res.redirect('/admin');
}

function resetIdleOnAction(req, res, next) {
  if (req.session) {
    res.locals.session = req.session;
    const isAction = req.method === 'POST' || req.path === '/session/ping';
    if (isAction) {
      req.session.touch();
    }
  }
  next();
}

module.exports = {
  isIdentifierAllowed,
  requireAdmin,
  requireAuthLocal,
  resetIdleOnAction,
};
