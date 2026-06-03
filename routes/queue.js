const router = require('express').Router();
const db     = require('../db/connection');
const auth   = require('../middleware/auth');

// Entrar na fila
router.post('/join', auth, async (req, res) => {
  const { queue_type = 'SOLO' } = req.body;
  const valid = ['SOLO','FLEX','ARAM','ARENA'];
  if (!valid.includes(queue_type.toUpperCase()))
    return res.status(400).json({ error: 'Fila inválida' });

  // Remove entrada anterior se existir
  await db.execute('DELETE FROM queue_entries WHERE user_id=?', [req.user.id]);

  // Usar DATE_ADD(NOW()) para evitar bugs de timezone entre Node.js e MySQL
  await db.execute(
    `INSERT INTO queue_entries (user_id, queue_type, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`,
    [req.user.id, queue_type.toUpperCase()]
  );

  // Buscar dados completos do usuário para broadcast
  const [rows] = await db.execute(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.lol_game_name, u.lol_tag_line,
            u.solo_tier, u.solo_rank, u.solo_lp, u.flex_tier, u.flex_rank, u.flex_lp,
            u.online_status, u.has_mic,
            GROUP_CONCAT(r.role ORDER BY r.priority SEPARATOR ',') AS roles
     FROM users u
     LEFT JOIN user_roles r ON r.user_id = u.id
     WHERE u.id = ?
     GROUP BY u.id`, [req.user.id]
  );

  const user = { ...rows[0], queue_type: queue_type.toUpperCase(), joined_at: new Date() };

  // Emitir em tempo real para todos
  if (global._io) global._io.emit('queue_update', { action: 'join', user });

  res.json({ ok: true, user });
});

// Sair da fila
router.delete('/leave', auth, async (req, res) => {
  await db.execute('DELETE FROM queue_entries WHERE user_id=?', [req.user.id]);
  if (global._io) global._io.emit('queue_update', { action: 'leave', user_id: req.user.id });
  res.json({ ok: true });
});

// Listar fila atual
router.get('/', auth, async (req, res) => {
  const { queue_type } = req.query;

  // Limpar expirados com NOW() do MySQL (sem conversão de timezone)
  await db.execute('DELETE FROM queue_entries WHERE expires_at < NOW()');

  let where = '1=1';
  const params = [];
  if (queue_type && queue_type !== 'all') {
    where = 'q.queue_type = ?';
    params.push(queue_type.toUpperCase());
  }

  const [rows] = await db.execute(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.lol_game_name, u.lol_tag_line,
            u.solo_tier, u.solo_rank, u.solo_lp, u.flex_tier, u.flex_rank, u.flex_lp,
            u.online_status, u.has_mic,
            q.queue_type, q.joined_at, q.expires_at,
            GROUP_CONCAT(r.role ORDER BY r.priority SEPARATOR ',') AS roles
     FROM queue_entries q
     JOIN users u ON u.id = q.user_id
     LEFT JOIN user_roles r ON r.user_id = u.id
     WHERE ${where}
     GROUP BY u.id, q.queue_type, q.joined_at, q.expires_at
     ORDER BY q.joined_at ASC`,
    params
  );

  res.json(rows);
});

// Status do usuário atual na fila
router.get('/me', auth, async (req, res) => {
  await db.execute('DELETE FROM queue_entries WHERE expires_at < NOW()');
  const [rows] = await db.execute(
    'SELECT queue_type, joined_at, expires_at FROM queue_entries WHERE user_id=?',
    [req.user.id]
  );
  res.json(rows[0] || null);
});

module.exports = router;