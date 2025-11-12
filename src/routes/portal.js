const express = require('express');
const argon2 = require('argon2');

const { requireLocalAuth } = require('../middleware/auth');
const users = require('../services/users');

const router = express.Router();

router.get('/', (req, res) => {
  if (req.session?.authType === 'local' && req.session.user) {
    return res.redirect('/dashboard');
  }

  return res.render('local-login', {
    title: 'Partner-Login',
    error: null,
  });
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).render('local-login', {
        title: 'Partner-Login',
        error: 'Bitte Zugangsdaten eingeben.',
      });
    }

    const user = await users.findByEmail(email);
    if (!user) {
      return res.status(401).render('local-login', {
        title: 'Partner-Login',
        error: 'Ungültige Zugangsdaten.',
      });
    }

    const passwordOk = await argon2.verify(user.passwordHash, password);
    if (!passwordOk) {
      return res.status(401).render('local-login', {
        title: 'Partner-Login',
        error: 'Ungültige Zugangsdaten.',
      });
    }

    req.session.regenerate((error) => {
      if (error) {
        return next(error);
      }

      req.session.user = {
        id: user.id,
        email: user.email,
        name: user.name,
      };
      req.session.authType = 'local';
      req.session.lastActivity = Date.now();
      req.session.cookie.maxAge = 30 * 60 * 1000;

      req.session.save((saveError) => {
        if (saveError) {
          return next(saveError);
        }
        res.redirect('/dashboard');
      });
    });
  } catch (error) {
    next(error);
  }
});

router.get('/dashboard', requireLocalAuth, (req, res) => {
  res.render('dashboard', {
    title: 'Partner-Dashboard',
    user: req.session.user,
  });
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }
    res.clearCookie('portal.sid');
    res.redirect('/');
  });
});

module.exports = router;
