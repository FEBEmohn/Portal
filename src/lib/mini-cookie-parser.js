function parseCookies(header) {
  const cookies = {};
  if (!header) {
    return cookies;
  }
  header.split(';').forEach((part) => {
    const [name, ...rest] = part.split('=');
    if (!name) {
      return;
    }
    const key = name.trim();
    const value = rest.join('=').trim();
    cookies[key] = decodeURIComponent(value || '');
  });
  return cookies;
}

module.exports = function cookieParser() {
  return function cookieMiddleware(req, res, next) {
    req.cookies = parseCookies(req.headers.cookie || '');
    next();
  };
};
