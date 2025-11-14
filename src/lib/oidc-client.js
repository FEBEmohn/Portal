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
      .then(
        (issuer) =>
          new issuer.Client({
            client_id: settings.clientId,
            client_secret: settings.clientSecret,
            redirect_uris: [settings.redirectUri],
            response_types: ['code'],
          })
      )
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
