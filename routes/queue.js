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


// ── Chat da fila (HTTP — confiável) ──────────────
router.get('/chat', auth, async (req, res) => {
  // Limpa mensagens com mais de 2 horas
  await db.execute("DELETE FROM queue_chat_messages WHERE created_at < DATE_SUB(NOW(), INTERVAL 2 HOUR)");
  const [rows] = await db.execute(
    `SELECT qcm.id, qcm.content, qcm.created_at, qcm.user_id,
            u.username, u.display_name, u.avatar_url
     FROM queue_chat_messages qcm
     JOIN users u ON u.id = qcm.user_id
     ORDER BY qcm.created_at ASC
     LIMIT 60`
  );
  res.json(rows);
});

router.post('/chat', auth, async (req, res) => {
  const { content } = req.body;
  if (!content?.trim() || content.length > 300)
    return res.status(400).json({ error: 'Mensagem inválida' });

  const [r] = await db.execute(
    'INSERT INTO queue_chat_messages (user_id, content) VALUES (?, ?)',
    [req.user.id, content.trim()]
  );

  const [userRows] = await db.execute(
    'SELECT id, username, display_name, avatar_url FROM users WHERE id=?',
    [req.user.id]
  );
  const u = userRows[0] || {};
  const msg = {
    id: r.insertId, user_id: req.user.id, content: content.trim(),
    created_at: new Date(), username: u.username,
    display_name: u.display_name, avatar_url: u.avatar_url
  };

  // Broadcast via socket (bonus real-time)
  if (global._io) global._io.emit('queue_chat_msg', {
    ...msg, sender_id: req.user.id,
    sender_name: u.display_name || u.username
  });

  res.status(201).json(msg);
});
module.exports = router;