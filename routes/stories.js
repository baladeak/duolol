const router = require('express').Router();
const db     = require('../db/connection');
const auth   = require('../middleware/auth');

// GET /api/stories — stories dos amigos + próprios (agrupados por usuário)
router.get('/', auth, async (req, res) => {
  try {
    // Limpar stories expirados
    await db.execute('DELETE FROM stories WHERE expires_at < NOW()');

    // Buscar stories de amigos + próprios
    const [rows] = await db.execute(`
      SELECT s.id, s.user_id, s.caption, s.created_at, s.expires_at,
             s.image_data,
             u.username, u.display_name, u.lol_game_name, u.lol_tag_line, u.avatar_url,
             (SELECT COUNT(*) FROM story_views sv WHERE sv.story_id=s.id AND sv.viewer_id=?) AS viewed
      FROM stories s
      JOIN users u ON u.id=s.user_id
      WHERE s.expires_at > NOW()
        AND (
          s.user_id = ?
          OR s.user_id IN (
            SELECT CASE WHEN user_a_id=? THEN user_b_id ELSE user_a_id END
            FROM friendships WHERE user_a_id=? OR user_b_id=?
          )
        )
      ORDER BY s.user_id = ? DESC, s.created_at DESC
    `, [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]);

    // Agrupar por usuário
    const grouped = [];
    const userMap = {};
    for (const s of rows) {
      if (!userMap[s.user_id]) {
        userMap[s.user_id] = {
          user_id: s.user_id, username: s.username, display_name: s.display_name,
          lol_game_name: s.lol_game_name, lol_tag_line: s.lol_tag_line,
          avatar_url: s.avatar_url,
          all_viewed: true, stories: []
        };
        grouped.push(userMap[s.user_id]);
      }
      if (!s.viewed) userMap[s.user_id].all_viewed = false;
      userMap[s.user_id].stories.push({
        id: s.id, caption: s.caption, created_at: s.created_at,
        expires_at: s.expires_at, image_data: s.image_data, viewed: !!s.viewed
      });
    }

    res.json(grouped);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/stories — criar story
router.post('/', auth, async (req, res) => {
  const { image_data, caption } = req.body;
  if (!image_data) return res.status(400).json({ error: 'Imagem obrigatória' });
  if (image_data.length > 5000000) return res.status(400).json({ error: 'Imagem muito grande (máx 3MB)' });

  try {
    const [r] = await db.execute(
      'INSERT INTO stories (user_id, image_data, caption) VALUES (?,?,?)',
      [req.user.id, image_data, caption?.slice(0, 300) || null]
    );
    res.status(201).json({ id: r.insertId });
  } catch(err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// DELETE /api/stories/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.execute('DELETE FROM stories WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/stories/:id/view — marcar como visto
router.post('/:id/view', auth, async (req, res) => {
  try {
    await db.execute(
      'INSERT IGNORE INTO story_views (story_id, viewer_id) VALUES (?,?)',
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;