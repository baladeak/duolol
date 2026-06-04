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

// Deletar post
router.delete('/posts/:id', async (req, res) => {
  await db.execute('UPDATE posts SET is_deleted=1 WHERE id=?', [req.params.id]);
  await db.execute('UPDATE post_reports SET status="reviewed" WHERE post_id=?', [req.params.id]);
  res.json({ ok: true });
});

// Listar denúncias pendentes
router.get('/reports', async (req, res) => {
  const [rows] = await db.execute(
    `SELECT r.id, r.post_id, r.reason, r.details, r.status, r.created_at,
            p.content AS post_content, p.is_deleted,
            u_rep.username AS reporter_username, u_rep.display_name AS reporter_name,
            u_aut.id AS author_id, u_aut.username AS author_username,
            u_aut.display_name AS author_name, u_aut.lol_game_name, u_aut.lol_tag_line,
            u_aut.is_banned, u_aut.post_restricted_until
     FROM post_reports r
     JOIN posts p ON p.id = r.post_id
     JOIN users u_rep ON u_rep.id = r.reporter_id
     JOIN users u_aut ON u_aut.id = p.user_id
     WHERE r.status = 'pending'
     ORDER BY r.created_at DESC
     LIMIT 100`
  );
  res.json(rows);
});

// Dispensar denúncia
router.patch('/reports/:id/dismiss', async (req, res) => {
  await db.execute('UPDATE post_reports SET status="dismissed" WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// Promover / rebaixar admin
router.patch('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role))
    return res.status(400).json({ error: 'Role inválida' });
  await db.execute('UPDATE users SET admin_role=? WHERE id=?', [role, req.params.id]);
  res.json({ ok: true });
});

// ── Reset Match Duo ──────────────────────────
router.post('/reset-matches', auth, isAdmin, async (req, res) => {
  try {
    const [r] = await db.execute('DELETE FROM duo_swipes');
    console.log(`[ADMIN] Reset matches: ${r.affectedRows} swipes removidos por ${req.user.id}`);
    res.json({ ok: true, deleted: r.affectedRows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao resetar matches' });
  }
});

// ── Reset Fila ao vivo ────────────────────────
router.post('/reset-queue', auth, isAdmin, async (req, res) => {
  try {
    const [r] = await db.execute('DELETE FROM queue_entries');
    if (global._io) global._io.emit('queue_update', { action: 'reset' });
    res.json({ ok: true, deleted: r.affectedRows });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao limpar fila' });
  }
});

module.exports = router;