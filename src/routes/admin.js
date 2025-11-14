const express = require('express');

const { requireAdmin, isAdminUser } = require('../middleware/auth');
const users = require('../services/users');
const { renderAdminLogin } = require('../lib/admin-view');

const router = express.Router();

router.get('/', (req, res) => {
  const sessionUser = req.session?.user || null;
  const hasAdminSession = req.session?.authType === 'oidc';
  const isAuthorizedAdmin = hasAdminSession && isAdminUser(sessionUser);

  if (isAuthorizedAdmin) {
    return res.redirect('/admin/start');
  }

  if (!hasAdminSession) {
    return renderAdminLogin(res);
  }

  if (!isAuthorizedAdmin) {
    return renderAdminLogin(res, {
      status: 403,
      errorMessage: 'Ihr Konto ist nicht für den Adminbereich freigeschaltet.',
    });
  }
});

router.get('/start', requireAdmin, (req, res) => {
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
