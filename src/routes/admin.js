const express = require('express');

const { requireAdmin, isAdminUser } = require('../middleware/auth');
const users = require('../services/users');
const { renderAdminLogin } = require('../lib/admin-view');
const { OidcConfigurationError } = require('../lib/oidc-settings');
const { buildAuthorizationUrl } = require('../lib/oidc-login');

const router = express.Router();

router.get('/', async (req, res, next) => {
  const sessionUser = req.session?.user || null;
  const hasAdminSession = req.session?.authType === 'oidc';
  const isAuthorizedAdmin = hasAdminSession && isAdminUser(sessionUser);

  if (!hasAdminSession) {
    try {
      const { authorizationUrl } = await buildAuthorizationUrl(req);
      return renderAdminLogin(res, { authorizationUrl });
    } catch (error) {
      if (error instanceof OidcConfigurationError) {
        return renderAdminLogin(res);
      }
      return next(error);
    }
  }

  if (!isAuthorizedAdmin) {
    try {
      const { authorizationUrl } = await buildAuthorizationUrl(req);
      return renderAdminLogin(res, {
        status: 403,
        errorMessage: 'Ihr Konto ist nicht für den Adminbereich freigeschaltet.',
        authorizationUrl,
      });
    } catch (error) {
      if (error instanceof OidcConfigurationError) {
        return renderAdminLogin(res, {
          status: 403,
          errorMessage: 'Ihr Konto ist nicht für den Adminbereich freigeschaltet.',
        });
      }
      return next(error);
    }
  }
});

router.get('/start', requireAdmin, (req, res) => {
  return res.render('admin-dashboard', {
    title: 'Adminbereich',
    user: req.session.user,
  });
});

router.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const allUsers = await users.all();
    res.render('admin-users', {
      title: 'Benutzerübersicht',
      user: req.session.user,
      users: allUsers,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
