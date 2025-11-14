const crypto = require('crypto');

const { requireOidcSettings } = require('./oidc-settings');
const { getClient } = require('./oidc-client');

function getRedirectUri(req) {
  const forwardedProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || (req.headers['x-arr-ssl'] ? 'https' : req.protocol || 'https');
  const forwardedHost = (req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host');
  return `${proto}://${host}/auth/microsoft/callback`;
}

function resolveRedirectUri(req) {
  const configured = typeof process.env.OIDC_REDIRECT_URI === 'string' ? process.env.OIDC_REDIRECT_URI.trim() : '';
  return configured || getRedirectUri(req);
}

async function buildAuthorizationUrl(req) {
  const settings = requireOidcSettings();
  const client = await getClient(settings);
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  const redirectUri = resolveRedirectUri(req);

  req.session.oidcState = state;
  req.session.oidcNonce = nonce;

  return {
    authorizationUrl: client.authorizationUrl({
      scope: 'openid profile email',
      state,
      nonce,
      redirect_uri: redirectUri,
      response_type: 'code',
      response_mode: 'form_post',
      prompt: 'select_account',
    }),
    redirectUri,
  };
}

module.exports = {
  getRedirectUri,
  resolveRedirectUri,
  buildAuthorizationUrl,
};
