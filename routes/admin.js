const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const db      = require('../db/connection');
const auth    = require('../middleware/auth');
const isAdmin = require('../middleware/admin');

// Todos os endpoints exigem auth + admin
router.use(auth, isAdmin);

// Buscar usuários
router.get('/users', async (req, res) => {
  const { q = '' } = req.query;
  const like = `%${q}%`;
  const [rows] = await db.execute(
    `SELECT id, username, display_name, lol_game_name, lol_tag_line,
            admin_role, is_banned, post_restricted_until, created_at,
            solo_tier, solo_rank, flex_tier, flex_rank, email
     FROM users
     WHERE username LIKE ? OR display_name LIKE ? OR lol_game_name LIKE ? OR email LIKE ?
     ORDER BY created_at DESC LIMIT 50`,
    [like, like, like, like]
  );
  res.json(rows);
});

// Mudar senha
router.patch('/users/:id/password', async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
  const hash = await bcrypt.hash(password, 12);
  await db.execute('UPDATE users SET password_hash=? WHERE id=?', [hash, req.params.id]);
  res.json({ ok: true });
});

// Mudar nick do LoL
router.patch('/users/:id/nick', async (req, res) => {
  const { lol_game_name, lol_tag_line } = req.body;
  if (!lol_game_name || !lol_tag_line)
    return res.status(400).json({ error: 'Nome e tag obrigatórios' });
  await db.execute(
    'UPDATE users SET lol_game_name=?, lol_tag_line=? WHERE id=?',
    [lol_game_name.trim(), lol_tag_line.trim(), req.params.id]
  );
  res.json({ ok: true });
});

// Banir / desbanir
router.patch('/users/:id/ban', async (req, res) => {
  const { banned } = req.body;
  await db.execute('UPDATE users SET is_banned=? WHERE id=?', [banned ? 1 : 0, req.params.id]);
  res.json({ ok: true });
});

// Restringir posts por X horas (0 = remover restrição)
router.patch('/users/:id/restrict', async (req, res) => {
  const hours = parseInt(req.body.hours) || 0;
  const until = hours > 0
    ? new Date(Date.now() + hours * 3600000).toISOString().slice(0, 19).replace('T', ' ')
    : null;
  await db.execute('UPDATE users SET post_restricted_until=? WHERE id=?', [until, req.params.id]);
  res.json({ ok: true, until });
});

// Promover / rebaixar admin
router.patch('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role))
    return res.status(400).json({ error: 'Role inválida' });
  await db.execute('UPDATE users SET admin_role=? WHERE id=?', [role, req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
