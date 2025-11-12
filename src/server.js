try {
  require('./preflight');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { activityGuard, resetIdleOnAction } = require('./middleware/auth');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const portalRouter = require('./routes/portal');

const PORT = process.env.PORT || 3004;
const HOST = process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.get('/healthz', (_req, res) => {
  res.status(200).type('text/plain').send('ok');
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[session] SESSION_SECRET fehlt – es wird ein ephemeres Secret verwendet.');
}

app.use(
  session({
    name: 'portal.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      sameSite: 'lax',
      httpOnly: true,
      secure: isProduction,
    },
  })
);

app.use(activityGuard);
app.use((req, _res, next) => {
  if (req.method === 'POST') {
    resetIdleOnAction(req);
  }
  next();
});

app.post('/session/ping', (req, res) => {
  res.sendStatus(204);
});

app.use('/_static', express.static(path.join(__dirname, '..', 'public'), { index: false }));

app.use('/auth', authRouter);
app.use('/', portalRouter);
app.use('/admin', adminRouter);

app.use((req, res) => {
  res.status(404).render('404', {
    title: 'Seite nicht gefunden',
    url: req.originalUrl,
  });
});

app.use((err, req, res, next) => {
  console.error('Unexpected error', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).render('500', {
    title: 'Fehler',
    message: 'Es ist ein unerwarteter Fehler aufgetreten.',
  });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
    const publicHost = process.env.PUBLIC_HOST || firstPublicIPv4();
    if (publicHost) {
      console.log(`Public URL: http://${publicHost}:${PORT}`);
    }
  });
}

function firstPublicIPv4() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const address of interfaces[name] || []) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }
  return null;
}

module.exports = app;
