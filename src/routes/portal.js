const express = require('express');
const { requireAuthLocal } = require('../middleware/auth');
const { verifyUserCredentials } = require('../services/users');

const router = express.Router();

router.get('/', (req, res) => {
  if (req.session?.authType === 'local' && req.session.user) {
    return res.redirect('/dashboard');
  }

  res.render('local-login', {
    title: 'Partner-Login',
    error: req.query.error,
  });
});

router.post('/login', async (req, res, next) => {
  try {
    const identifier = (req.body.identifier || req.body.email || '').trim().toLowerCase();
    const password = req.body.password;

    if (!identifier || !password) {
      return res.redirect('/?error=missing');
    }

    const user = await verifyUserCredentials(identifier, password);

    if (!user) {
      return res.redirect('/?error=invalid');
    }

    req.session.regenerate((regenerateError) => {
      if (regenerateError) {
        return next(regenerateError);
      }

      req.session.authType = 'local';
      req.session.user = {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      };

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

router.get('/dashboard', requireAuthLocal, (req, res) => {
  res.render('dashboard', {
    title: 'Partner-Dashboard',
    user: req.session.user,
  });
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((destroyError) => {
    if (destroyError) {
      return next(destroyError);
    }

    res.clearCookie('portal.sid');
    res.redirect('/');
  });
});

module.exports = router;
