const express = require('express');
const { isAdminUser } = require('../middleware/auth');
const {
  requireOidcSettings,
  OidcConfigurationError,
} = require('../lib/oidc-settings');
const { getClient } = require('../lib/oidc-client');
const { renderAdminLogin } = require('../lib/admin-view');
const { buildAuthorizationUrl } = require('../lib/oidc-login');

const router = express.Router();

function clearOidcTransaction(req) {
  if (req.session) {
    delete req.session.oidcState;
    delete req.session.oidcNonce;
  }
}

router.get('/microsoft', async (req, res, next) => {
  try {
    const { authorizationUrl } = await buildAuthorizationUrl(req);

    req.session.save((error) => {
      if (error) {
        return next(error);
      }
      res.redirect(authorizationUrl);
    });
  } catch (error) {
    if (error instanceof OidcConfigurationError) {
      return renderAdminLogin(res, {
        status: 503,
        errorMessage:
          'Die Microsoft-Anmeldung ist momentan nicht möglich, weil die OIDC-Konfiguration unvollständig ist.',
      });
    }
    next(error);
  }
});

router.get('/microsoft/callback', async (req, res, next) => {
  try {
    const settings = requireOidcSettings();
    const client = await getClient(settings);
    const params = client.callbackParams(req);
    const expectedState = req.session?.oidcState;
    const expectedNonce = req.session?.oidcNonce;

    if (!expectedState || !expectedNonce) {
      clearOidcTransaction(req);
      return renderLoginWithFreshLink(req, res, {
        status: 400,
        errorMessage:
          'Die Anmeldesitzung ist abgelaufen. Bitte starten Sie den Login erneut.',
      });
    }

    const tokenSet = await client.callback(settings.redirectUri, params, {
      state: expectedState,
      nonce: expectedNonce,
    });
    const claims = tokenSet.claims();

    if (!isAdminUser(claims)) {
      clearOidcTransaction(req);
      return renderLoginWithFreshLink(req, res, {
        status: 403,
        errorMessage:
          'Ihr Microsoft-Konto ist nicht für den Adminbereich freigeschaltet.',
      });
    }

    clearOidcTransaction(req);

    req.session.regenerate((error) => {
      if (error) {
        return next(error);
      }

      req.session.user = {
        sub: claims.sub,
        email: claims.email || claims.preferred_username,
        name: claims.name,
        upn: claims.preferred_username,
        oid: claims.oid,
      };
      req.session.authType = 'oidc';
      req.session.lastActivity = Date.now();
      req.session.cookie.maxAge = 30 * 60 * 1000;

      req.session.save((saveError) => {
        if (saveError) {
          return next(saveError);
        }
        res.redirect('/admin/start');
      });
    });
  } catch (error) {
    if (error instanceof OidcConfigurationError) {
      return renderAdminLogin(res, {
        status: 503,
        errorMessage:
          'Die Microsoft-Anmeldung ist momentan nicht möglich, weil die OIDC-Konfiguration unvollständig ist.',
      });
    }

    if (error && error.name === 'RPError') {
      return renderLoginWithFreshLink(req, res, {
        status: 401,
        errorMessage:
          'Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.',
      });
    }

    next(error);
  }
});

router.post('/logout', (req, res, next) => {
  const redirectTarget = req.session?.authType === 'oidc' ? '/admin' : '/login';
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }
    res.clearCookie('portal.sid');
    res.redirect(redirectTarget);
  });
});

module.exports = router;

async function renderLoginWithFreshLink(req, res, options) {
  try {
    const { authorizationUrl } = await buildAuthorizationUrl(req);
    return renderAdminLogin(res, { ...options, authorizationUrl });
  } catch (error) {
    if (error instanceof OidcConfigurationError) {
      return renderAdminLogin(res, options);
    }
    throw error;
  }
}
