const express = require('express');

const { requireAdmin } = require('../middleware/auth');
const users = require('../services/users');

const router = express.Router();

router.get('/', (req, res) => {
  const isAdmin = req.session?.authType === 'oidc';

  if (!isAdmin) {
    return res.render('admin-login', {
      title: 'Adminbereich',
    });
  }

  return res.render('admin-dashboard', {
    title: 'Adminbereich',
    user: req.session.user,
  });
});

router.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const allUsers = await users.all();
    res.render('admin-users', {
      title: 'Benutzerübersicht',
      user: req.session.user,
      users: allUsers,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
