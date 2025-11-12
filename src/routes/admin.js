const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { listUsers, upsertUser, removeUser } = require('../services/users');

const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    const isAdmin = req.session?.authType === 'microsoft' && req.session.user?.isAdmin;

    if (!isAdmin) {
      return res.render('admin-login', {
        title: 'Adminbereich',
        error: req.query.error,
      });
    }

    const users = listUsers();

    return res.render('admin-dashboard', {
      title: 'Adminbereich',
      admin: req.session.user,
      users,
      message: req.query.message,
      error: req.query.error,
    });
  } catch (error) {
    next(error);
  }
});

router.use(requireAdmin);

router.post('/users', async (req, res, next) => {
  try {
    await upsertUser({
      id: req.body.id,
      email: req.body.email,
      username: req.body.username,
      displayName: req.body.displayName,
      role: req.body.role,
      password: req.body.password || undefined,
    });

    return res.redirect('/admin?message=user_saved');
  } catch (error) {
    return res.redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  }
});

router.post('/users/:id/delete', (req, res, next) => {
  try {
    const deleted = removeUser(req.params.id);
    if (!deleted) {
      return res.redirect('/admin?error=not_found');
    }
    return res.redirect('/admin?message=user_deleted');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
