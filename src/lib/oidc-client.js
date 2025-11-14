const { Issuer } = require('openid-client');

let clientPromise;
let cachedSettingsKey;

function buildSettingsKey(settings) {
  return [settings.issuer, settings.clientId, settings.redirectUri].join('|');
}

async function getClient(settings) {
  const key = buildSettingsKey(settings);
  if (!clientPromise || cachedSettingsKey !== key) {
    clientPromise = Issuer.discover(settings.issuer)
      .then((issuer) => {
        const metadata = {
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          token_endpoint_auth_method: 'client_secret_post',
          response_types: ['code'],
        };

        if (settings.redirectUri) {
          metadata.redirect_uris = [settings.redirectUri];
        }

        return new issuer.Client(metadata);
      })
      .catch((error) => {
        clientPromise = null;
        cachedSettingsKey = null;
        throw error;
      });
    cachedSettingsKey = key;
  }
  return clientPromise;
}

module.exports = {
  getClient,
};
