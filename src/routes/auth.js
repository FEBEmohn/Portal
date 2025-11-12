const express = require('express');
const { Issuer } = require('openid-client');

const { isAdminUser } = require('../middleware/auth');

const router = express.Router();

let clientPromise;
async function getClient() {
  if (!clientPromise) {
    const issuerUrl = process.env.OIDC_ISSUER;
    const clientId = process.env.OIDC_CLIENT_ID;
    const clientSecret = process.env.OIDC_CLIENT_SECRET;
    const redirectUri = process.env.OIDC_REDIRECT_URI;

    if (!issuerUrl || !clientId || !clientSecret || !redirectUri) {
      throw new Error('OIDC configuration is incomplete.');
    }

    clientPromise = Issuer.discover(issuerUrl).then(
      (issuer) =>
        new issuer.Client({
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uris: [redirectUri],
          response_types: ['code'],
        })
    );
  }
  return clientPromise;
}

router.get('/microsoft', async (req, res, next) => {
  try {
    const client = await getClient();
    const authorizationUrl = client.authorizationUrl({
      scope: 'openid profile email',
    });
    res.redirect(authorizationUrl);
  } catch (error) {
    next(error);
  }
});

router.get('/microsoft/callback', async (req, res, next) => {
  try {
    const client = await getClient();
    const params = client.callbackParams(req);
    const redirectUri = process.env.OIDC_REDIRECT_URI;
    const tokenSet = await client.callback(redirectUri, params, {});
    const claims = tokenSet.claims();

    if (!isAdminUser(claims)) {
      return res.redirect('/admin');
    }

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
        res.redirect('/admin');
      });
    });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', (req, res, next) => {
  const redirectTarget = req.session?.authType === 'oidc' ? '/admin' : '/';
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }
    res.clearCookie('portal.sid');
    res.redirect(redirectTarget);
  });
});

module.exports = router;
