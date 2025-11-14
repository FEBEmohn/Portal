const crypto = require('crypto');

const { requireOidcSettings } = require('./oidc-settings');
const { getClient } = require('./oidc-client');

async function buildAuthorizationUrl(req) {
  const settings = requireOidcSettings();
  const client = await getClient(settings);
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');

  req.session.oidcState = state;
  req.session.oidcNonce = nonce;

  return {
    authorizationUrl: client.authorizationUrl({
      scope: 'openid profile email',
      state,
      nonce,
      redirect_uri: settings.redirectUri,
      prompt: 'select_account',
    }),
    settings,
  };
}

module.exports = {
  buildAuthorizationUrl,
};
