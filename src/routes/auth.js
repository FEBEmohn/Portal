const express = require('express');
const { Issuer, generators } = require('openid-client');
const { isIdentifierAllowed } = require('../middleware/auth');

const router = express.Router();

const tenantId = process.env.MICROSOFT_TENANT_ID;
const clientId = process.env.MICROSOFT_CLIENT_ID;
const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
const redirectUri = process.env.MICROSOFT_REDIRECT_URI;

let clientPromise;

async function getClient() {
  if (!tenantId || !clientId || !clientSecret || !redirectUri) {
    throw new Error('Microsoft OIDC environment variables are not fully configured.');
  }

  if (!clientPromise) {
    const authority = `https://login.microsoftonline.com/${tenantId}/v2.0`;
    clientPromise = Issuer.discover(`${authority}/.well-known/openid-configuration`).then(
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
    const state = generators.state();
    const nonce = generators.nonce();

    req.session.oidc = { state, nonce };

    const authorizationUrl = client.authorizationUrl({
      scope: 'openid profile email',
      state,
      nonce,
      response_mode: 'query',
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
    const stored = req.session.oidc;

    if (!stored || params.state !== stored.state) {
      return res.redirect('/admin?error=invalid_state');
    }

    const tokenSet = await client.callback(redirectUri, params, {
      state: stored.state,
      nonce: stored.nonce,
    });

    const claims = tokenSet.claims();

    if (!isIdentifierAllowed(claims)) {
      return res.redirect('/admin?error=unauthorized');
    }

    req.session.regenerate((regenerateError) => {
      if (regenerateError) {
        return next(regenerateError);
      }

      req.session.authType = 'microsoft';
      req.session.user = {
        name: claims.name || claims.preferred_username || claims.email,
        email: claims.email || claims.preferred_username,
        oid: claims.oid,
        isAdmin: true,
      };

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
  const redirectTarget = req.session?.authType === 'microsoft' ? '/admin' : '/';

  req.session.destroy((destroyError) => {
    if (destroyError) {
      return next(destroyError);
    }

    res.clearCookie('portal.sid');
    res.redirect(redirectTarget);
  });
});

module.exports = router;
