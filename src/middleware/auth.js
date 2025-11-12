const THIRTY_MINUTES = 30 * 60 * 1000;

function sessionHasUser(req) {
  return Boolean(req.session && req.session.user);
}

function normalizeList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminUser(user) {
  if (!user) {
    return false;
  }
  const allowed = normalizeList(process.env.ADMIN_USERS);
  if (!allowed.length) {
    return false;
  }
  const identifiers = [user.email, user.upn, user.oid, user.sub]
    .filter(Boolean)
    .map((entry) => String(entry).toLowerCase());
  return identifiers.some((value) => allowed.includes(value));
}

function activityGuard(req, res, next) {
  if (!sessionHasUser(req)) {
    return next();
  }

  const lastActivity = req.session.lastActivity || 0;
  const elapsed = Date.now() - lastActivity;

  if (elapsed > THIRTY_MINUTES) {
    req.session.destroy(() => {
      if (req.originalUrl.startsWith('/admin')) {
        return res.redirect('/admin');
      }
      return res.redirect('/');
    });
    return;
  }

  return next();
}

function resetIdleOnAction(req) {
  if (sessionHasUser(req)) {
    req.session.lastActivity = Date.now();
  }
}

function requireLocalAuth(req, res, next) {
  if (!sessionHasUser(req) || req.session.authType !== 'local') {
    return res.redirect('/');
  }
  return activityGuard(req, res, next);
}

function requireAdmin(req, res, next) {
  if (!sessionHasUser(req) || req.session.authType !== 'oidc' || !isAdminUser(req.session.user)) {
    return res.redirect('/admin');
  }
  return activityGuard(req, res, next);
}

module.exports = {
  activityGuard,
  resetIdleOnAction,
  requireLocalAuth,
  requireAdmin,
  isAdminUser,
};
