const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { resetIdleOnAction } = require('./middleware/auth');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const portalRouter = require('./routes/portal');

const PORT = process.env.PORT || 3004;
const HOST = process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';
const SESSION_MAX_AGE_MS = 30 * 60 * 1000;

const app = express();
app.disable('x-powered-by');

app.use(helmet());
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

if (isProduction) {
  app.set('trust proxy', 1);
}

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.warn('SESSION_SECRET is not set. Falling back to an insecure development secret.');
}

app.use(
  session({
    name: 'portal.sid',
    secret: sessionSecret || 'development-secret',
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      maxAge: SESSION_MAX_AGE_MS,
      sameSite: 'lax',
      httpOnly: true,
      secure: isProduction,
    },
  })
);

app.use(resetIdleOnAction);

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
  });
}

module.exports = app;
