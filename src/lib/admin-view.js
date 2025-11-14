const { readOidcSettings } = require('./oidc-settings');

function renderAdminLogin(
  res,
  { status, errorMessage, infoMessage, authorizationUrl } = {}
) {
  const { missing } = readOidcSettings();
  const oidcReady = missing.length === 0;
  const baseStatus = typeof status === 'number' ? status : oidcReady ? 200 : 503;
  const effectiveStatus = !oidcReady && baseStatus < 500 ? 503 : baseStatus;

  return res.status(effectiveStatus).render('admin-login', {
    title: 'Adminbereich',
    oidcReady,
    missingSettings: missing,
    errorMessage: errorMessage || null,
    authorizationUrl: authorizationUrl || null,
    infoMessage:
      infoMessage ||
      (oidcReady
        ? 'Bitte melden Sie sich mit Microsoft an, um den Adminbereich zu öffnen.'
        : 'Die Microsoft-Anmeldung ist derzeit nicht konfiguriert.'),
  });
}

module.exports = {
  renderAdminLogin,
};
