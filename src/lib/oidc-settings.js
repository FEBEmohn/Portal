const REQUIRED_ENV = {
  clientId: 'OIDC_CLIENT_ID',
  clientSecret: 'OIDC_CLIENT_SECRET',
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
  const explicitIssuer = trimOrNull(process.env.OIDC_ISSUER);
  const tenantId = trimOrNull(process.env.OIDC_TENANT_ID);
  const issuer = explicitIssuer || (tenantId ? `https://login.microsoftonline.com/${tenantId}/v2.0` : null);

  const settings = {
    issuer,
    clientId: trimOrNull(process.env.OIDC_CLIENT_ID),
    clientSecret: trimOrNull(process.env.OIDC_CLIENT_SECRET),
    redirectUri: trimOrNull(process.env.OIDC_REDIRECT_URI),
  };

  const missing = [];
  if (!settings.clientId) {
    missing.push(REQUIRED_ENV.clientId);
  }
  if (!settings.clientSecret) {
    missing.push(REQUIRED_ENV.clientSecret);
  }

  if (!settings.issuer) {
    missing.push('OIDC_ISSUER or OIDC_TENANT_ID');
  }

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
