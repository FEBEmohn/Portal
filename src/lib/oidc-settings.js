const REQUIRED_ENV = {
  issuer: 'OIDC_ISSUER',
  clientId: 'OIDC_CLIENT_ID',
  clientSecret: 'OIDC_CLIENT_SECRET',
  redirectUri: 'OIDC_REDIRECT_URI',
};

class OidcConfigurationError extends Error {
  constructor(missingVariables) {
    super(
      `OIDC configuration is incomplete. Missing: ${missingVariables.join(', ')}`
    );
    this.name = 'OidcConfigurationError';
    this.missingVariables = missingVariables;
  }
}

function trimOrNull(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOidcSettings() {
  const settings = {
    issuer: trimOrNull(process.env.OIDC_ISSUER),
    clientId: trimOrNull(process.env.OIDC_CLIENT_ID),
    clientSecret: trimOrNull(process.env.OIDC_CLIENT_SECRET),
    redirectUri: trimOrNull(process.env.OIDC_REDIRECT_URI),
  };

  const missing = Object.entries(settings)
    .filter(([, value]) => !value)
    .map(([key]) => REQUIRED_ENV[key]);

  return { settings, missing };
}

function requireOidcSettings() {
  const { settings, missing } = readOidcSettings();
  if (missing.length > 0) {
    throw new OidcConfigurationError(missing);
  }
  return settings;
}

module.exports = {
  readOidcSettings,
  requireOidcSettings,
  OidcConfigurationError,
};
