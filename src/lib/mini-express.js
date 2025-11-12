const http = require('http');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const { renderFile } = require('./simple-view');
const querystring = require('querystring');

const DEFAULT_POWERED_BY = 'MiniExpress';

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePath(routePath) {
  if (!routePath || routePath === '/') {
    return { regex: /^\/$/, keys: [] };
  }
  const segments = routePath.split('/').filter(Boolean);
  const keys = [];
  const pattern = segments
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      if (segment === '*') {
        keys.push('wild');
        return '(.*)';
      }
      return escapeRegex(segment);
    })
    .join('/');
  const regex = new RegExp(`^/${pattern}${routePath.endsWith('/') ? '' : '$'}`);
  return { regex, keys };
}

function matchPath(requestPath, basePath) {
  if (!basePath || basePath === '/' || basePath === '') {
    return true;
  }
  if (!requestPath.startsWith(basePath)) {
    return false;
  }
  const remainder = requestPath.slice(basePath.length);
  return remainder === '' || remainder.startsWith('/');
}

function appendHeader(res, name, value) {
  const existing = res.getHeader(name);
  if (existing === undefined) {
    res.setHeader(name, value);
  } else if (Array.isArray(existing)) {
    res.setHeader(name, existing.concat(value));
  } else {
    res.setHeader(name, [existing, value]);
  }
}

function enhanceResponse(res, app) {
  if (!res.locals) {
    res.locals = {};
  }
  res.status = function status(code) {
    res.statusCode = code;
    return res;
  };

  res.set = function set(field, value) {
    res.setHeader(field, value);
    return res;
  };

  res.appendHeader = function append(name, value) {
    appendHeader(res, name, value);
    return res;
  };

  res.send = function send(body) {
    if (body === undefined || body === null) {
      body = '';
    }
    if (typeof body === 'object' && !Buffer.isBuffer(body)) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      body = JSON.stringify(body);
    }
    if (typeof body === 'string' && !res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    if (app.settings['x-powered-by'] !== false && !res.getHeader('X-Powered-By')) {
      res.setHeader('X-Powered-By', DEFAULT_POWERED_BY);
    }
    res.end(body);
    return res;
  };

  res.json = function json(data) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (app.settings['x-powered-by'] !== false && !res.getHeader('X-Powered-By')) {
      res.setHeader('X-Powered-By', DEFAULT_POWERED_BY);
    }
    res.end(JSON.stringify(data));
    return res;
  };

  res.sendStatus = function sendStatus(code) {
    res.statusCode = code;
    res.send(String(code));
    return res;
  };

  res.redirect = function redirect(statusOrUrl, url) {
    let statusCode = 302;
    let target = statusOrUrl;
    if (typeof statusOrUrl === 'number') {
      statusCode = statusOrUrl;
      target = url;
    }
    res.statusCode = statusCode;
    res.setHeader('Location', target);
    if (app.settings['x-powered-by'] !== false && !res.getHeader('X-Powered-By')) {
      res.setHeader('X-Powered-By', DEFAULT_POWERED_BY);
    }
    res.end();
    return res;
  };

  res.clearCookie = function clearCookie(name) {
    const parts = [`${name}=`, 'Path=/', 'Max-Age=0'];
    res.appendHeader('Set-Cookie', parts.join('; '));
    return res;
  };

  res.render = function render(viewName, locals = {}) {
    const engine = app.settings['view engine'];
    const viewsDir = app.settings.views;
    if (!engine || !viewsDir) {
      throw new Error('View engine or views directory not configured.');
    }
    const filename = path.join(viewsDir, `${viewName}.${engine}`);
    return new Promise((resolve, reject) => {
      renderFile(filename, locals, (err, html) => {
        if (err) {
          reject(err);
          return;
        }
        if (!res.getHeader('Content-Type')) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
        }
        if (app.settings['x-powered-by'] !== false && !res.getHeader('X-Powered-By')) {
          res.setHeader('X-Powered-By', DEFAULT_POWERED_BY);
        }
        res.end(html);
        resolve();
      });
    });
  };
}

function createLayer({ type, method, path: routePath, handler }) {
  const layer = { type, method, path: routePath, handler };
  if (type === 'route') {
    const compiled = compilePath(routePath);
    layer.regex = compiled.regex;
    layer.keys = compiled.keys;
  }
  return layer;
}

function getRequestInfo(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  return {
    path: url.pathname || '/',
    query: Object.fromEntries(url.searchParams.entries()),
  };
}

function runLayer(layer, req, res, app, next, err, basePath = '') {
  const info = getRequestInfo(req);
  req.path = info.path;
  req.query = info.query;

  if (layer.type === 'middleware') {
    if (!matchPath(req.path, basePath + (layer.path === '/' ? '' : layer.path))) {
      next(err);
      return;
    }

    const originalUrl = req.url;
    const prefix = layer.path === '/' ? '' : layer.path;
    if (prefix && req.path.startsWith(prefix)) {
      const trimmed = req.url.slice(prefix.length) || '/';
      req.url = trimmed;
    }

    const callback = layer.handler;
    const isErrorHandler = callback.length === 4;

    const done = (callbackErr) => {
      req.url = originalUrl;
      next(callbackErr);
    };

    try {
      if (err) {
        if (isErrorHandler) {
          const maybePromise = callback(err, req, res, done);
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(() => done()).catch((error) => done(error));
          }
        } else {
          done(err);
        }
      } else {
        if (isErrorHandler) {
          done();
        } else {
          const maybePromise = callback(req, res, done);
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(() => done()).catch((error) => done(error));
          }
        }
      }
    } catch (error) {
      done(error);
    }
    return;
  }

  if (layer.type === 'route') {
    if (layer.method !== req.method) {
      next(err);
      return;
    }

    if (!layer.regex.test(req.path)) {
      next(err);
      return;
    }

    const match = layer.regex.exec(req.path);
    req.params = {};
    if (match) {
      layer.keys.forEach((key, index) => {
        req.params[key] = decodeURIComponent(match[index + 1]);
      });
    }

    req.__routeHandled = true;

    const callback = layer.handler;
    const isErrorHandler = callback.length === 4;

    try {
      if (err) {
        if (isErrorHandler) {
          const maybePromise = callback(err, req, res, next);
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(() => next()).catch((error) => next(error));
          }
        } else {
          next(err);
        }
      } else {
        if (isErrorHandler) {
          next();
        } else {
          const maybePromise = callback(req, res, next);
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(() => next()).catch((error) => next(error));
          }
        }
      }
    } catch (error) {
      next(error);
    }
  }
}

function createApplication({ isRouter = false } = {}) {
  const stack = [];
  const app = function app(req, res, out) {
    enhanceResponse(res, app);

    if (!req.originalUrl) {
      req.originalUrl = req.url;
    }

    const info = getRequestInfo(req);
    req.path = info.path;
    req.query = info.query;
    req.params = req.params || {};
    req.__routeHandled = false;

    let index = 0;
    let routerShouldContinue = false;

    function dispatch(err, fromNext = false) {
      if (index >= stack.length) {
        if (out) {
          const shouldPropagate = isRouter ? routerShouldContinue : fromNext;
          if (err || shouldPropagate) {
            out(err);
          }
        } else if (err) {
          res.status(err.status || 500);
          if (app.settings['x-powered-by'] !== false && !res.getHeader('X-Powered-By')) {
            res.setHeader('X-Powered-By', DEFAULT_POWERED_BY);
          }
          res.end('Internal Server Error');
        } else if (!res.writableEnded && !req.__routeHandled) {
          res.status(404);
          if (app.settings['x-powered-by'] !== false && !res.getHeader('X-Powered-By')) {
            res.setHeader('X-Powered-By', DEFAULT_POWERED_BY);
          }
          res.end('Not Found');
        }
        return;
      }

      const layer = stack[index++];
      if (isRouter) {
        routerShouldContinue = false;
      }
      const nextHandler = isRouter
        ? (nextErr) => {
            routerShouldContinue = true;
            dispatch(nextErr, true);
          }
        : (nextErr) => dispatch(nextErr, true);
      runLayer(layer, req, res, app, nextHandler, err, req.baseUrl || '');
    }

    dispatch(undefined, false);
  };

  app.stack = stack;
  app.settings = Object.create(null);
  if (!isRouter) {
    app.settings['x-powered-by'] = DEFAULT_POWERED_BY;
  }

  app.use = function use(pathOrHandler, maybeHandler) {
    let routePath = pathOrHandler;
    let handler = maybeHandler;
    if (typeof pathOrHandler === 'function') {
      handler = pathOrHandler;
      routePath = '/';
    }

    if (handler && handler.stack && typeof handler === 'function') {
      if (handler.settings) {
        Object.setPrototypeOf(handler.settings, app.settings);
      }
      const routerHandler = (req, res, next) => {
        const originalBase = req.baseUrl || '';
        const originalUrl = req.url;
        const prefix = routePath === '/' ? '' : routePath;
        if (prefix) {
          req.baseUrl = (originalBase || '') + prefix;
          if (req.url.startsWith(prefix)) {
            let trimmed = req.url.slice(prefix.length) || '/';
            if (!trimmed.startsWith('/')) {
              trimmed = `/${trimmed}`;
            }
            req.url = trimmed;
          }
        }
        const done = (err) => {
          req.baseUrl = originalBase;
          req.url = originalUrl;
          next(err);
        };
        handler(req, res, done);
      };
      stack.push(createLayer({ type: 'middleware', path: routePath, handler: routerHandler }));
      return app;
    }

    stack.push(createLayer({ type: 'middleware', path: routePath || '/', handler }));
    return app;
  };

  app.get = function get(path, handler) {
    stack.push(createLayer({ type: 'route', method: 'GET', path, handler }));
    return app;
  };

  app.post = function post(path, handler) {
    stack.push(createLayer({ type: 'route', method: 'POST', path, handler }));
    return app;
  };

  app.set = function set(key, value) {
    app.settings[key] = value;
    return app;
  };

  app.disable = function disable(key) {
    app.settings[key] = false;
    return app;
  };

  app.listen = function listen(port, host, callback) {
    if (isRouter) {
      throw new Error('Router cannot listen on ports directly');
    }
    const server = http.createServer((req, res) => app(req, res));
    return server.listen(port, host, callback);
  };

  return app;
}

function createRouter() {
  const routerApp = createApplication({ isRouter: true });
  const router = function router(req, res, next) {
    routerApp(req, res, next);
  };
  Object.assign(router, routerApp);
  router.stack = routerApp.stack;
  router.settings = routerApp.settings;
  return router;
}

function collectBody(req) {
  if (req._bodyPromise) {
    return req._bodyPromise;
  }
  req._bodyPromise = new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString();
      if (data.length > 1e6) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', (err) => reject(err));
  });
  return req._bodyPromise;
}

function jsonParser() {
  return async function json(req, res, next) {
    if (req._bodyParsed || req.method === 'GET' || req.method === 'HEAD') {
      next();
      return;
    }
    const type = (req.headers['content-type'] || '').split(';')[0].trim();
    if (type !== 'application/json') {
      next();
      return;
    }
    try {
      const raw = await collectBody(req);
      req.body = raw ? JSON.parse(raw) : {};
      req._bodyParsed = true;
      next();
    } catch (error) {
      error.status = 400;
      next(error);
    }
  };
}

function urlencodedParser(options = {}) {
  const extended = Boolean(options.extended);
  return async function urlencoded(req, res, next) {
    if (req._bodyParsed || req.method === 'GET' || req.method === 'HEAD') {
      next();
      return;
    }
    const type = (req.headers['content-type'] || '').split(';')[0].trim();
    if (type !== 'application/x-www-form-urlencoded') {
      next();
      return;
    }
    try {
      const raw = await collectBody(req);
      req.body = raw ? querystring.parse(raw) : {};
      req._bodyParsed = true;
      next();
    } catch (error) {
      error.status = 400;
      next(error);
    }
  };
}

function staticMiddleware(root, options = {}) {
  const index = options.index !== undefined ? options.index : 'index.html';
  return function serveStatic(req, res, next) {
    const info = getRequestInfo(req);
    let filePath = path.join(root, info.path);
    if (info.path.endsWith('/')) {
      filePath = path.join(filePath, index);
    }
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        next();
        return;
      }
      const stream = fs.createReadStream(filePath);
      stream.on('error', next);
      stream.pipe(res);
    });
  };
}

function noopTrustProxy() {
  return function trustProxy(req, res, next) {
    next();
  };
}

const express = createApplication;
express.Router = createRouter;
express.json = jsonParser;
express.urlencoded = urlencodedParser;
express.static = staticMiddleware;
express.trustProxy = noopTrustProxy;

module.exports = express;
