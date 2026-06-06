const router = require('express').Router();
const db     = require('../db/connection');
const auth   = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  const { queue, page = 1, limit = 25 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  try {
    let where = 'p.is_deleted=0', whereParams = [];
    if (queue && queue !== 'all') {
      const q = queue.toUpperCase();
      // ARAM e ARENA são exclusivos — não entram no BOTH (Solo+Flex)
      if (q === 'ARAM' || q === 'ARENA') {
        where += ' AND p.queue_type=?';
      } else {
        where += ' AND (p.queue_type=? OR p.queue_type="BOTH")';
      }
      whereParams.push(q);
    }
    const [posts] = await db.execute(
      `SELECT p.id,p.content,p.queue_type,p.created_at,p.solo_tier_snapshot,p.flex_tier_snapshot,
              u.id AS user_id,u.username,u.display_name,u.lol_game_name,u.lol_tag_line,u.avatar_url,
              u.solo_tier,u.solo_rank,u.solo_lp,u.flex_tier,u.flex_rank,u.flex_lp,u.online_status,u.has_mic,u.custom_status,u.admin_role,
              (SELECT COUNT(*) FROM post_likes l WHERE l.post_id=p.id) AS total_likes,
              (SELECT COUNT(*) FROM post_comments c WHERE c.post_id=p.id AND c.is_deleted=0) AS total_comments,
              (SELECT COUNT(*) FROM post_likes lm WHERE lm.post_id=p.id AND lm.user_id=?) AS liked_by_me,
              pr_me.reaction AS my_reaction,
              react_agg.reactions_json
       FROM posts p
       JOIN users u ON u.id=p.user_id
       LEFT JOIN post_reactions pr_me ON pr_me.post_id=p.id AND pr_me.user_id=?
       LEFT JOIN (
         SELECT post_id, JSON_OBJECTAGG(reaction, cnt) AS reactions_json
         FROM (SELECT post_id, reaction, COUNT(*) AS cnt FROM post_reactions GROUP BY post_id, reaction) sub
         GROUP BY post_id
       ) react_agg ON react_agg.post_id=p.id
       WHERE ${where} ORDER BY p.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${offset}`,
      [req.user.id, req.user.id, ...whereParams]
    );
    res.json(posts);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar posts' }); }
});

router.post('/', auth, async (req, res) => {
  const { content, queue_type } = req.body;
  if (!content?.trim() || content.trim().length < 5) return res.status(400).json({ error: 'Conteúdo muito curto' });
  if (content.length > 500) return res.status(400).json({ error: 'Máximo 500 caracteres' });
  try {
    const [u] = await db.execute('SELECT solo_tier,solo_rank,flex_tier,flex_rank,post_restricted_until FROM users WHERE id=?', [req.user.id]);
    if (u[0]?.post_restricted_until && new Date(u[0].post_restricted_until) > new Date())
      return res.status(403).json({ error: `Você está impedido de postar até ${new Date(u[0].post_restricted_until).toLocaleString('pt-BR')}` });
    const user = u[0];
    const soloSnap = user.solo_tier ? `${user.solo_tier} ${user.solo_rank||''}`.trim() : null;
    const flexSnap = user.flex_tier ? `${user.flex_tier} ${user.flex_rank||''}`.trim() : null;
    const [r] = await db.execute(
      'INSERT INTO posts (user_id,content,queue_type,solo_tier_snapshot,flex_tier_snapshot) VALUES (?,?,?,?,?)',
      [req.user.id, content.trim(), (queue_type||'SOLO').toUpperCase(), soloSnap, flexSnap]
    );
    const [post] = await db.execute(
      `SELECT p.*,u.username,u.display_name,u.lol_game_name,u.lol_tag_line,u.avatar_url,u.online_status,
              u.solo_tier,u.solo_rank,u.solo_lp,u.flex_tier,u.flex_rank,u.flex_lp
       FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?`,
      [r.insertId]
    );
    res.status(201).json({ ...post[0], total_likes: 0, total_comments: 0, liked_by_me: 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao criar post' }); }
});

router.delete('/:id', auth, async (req, res) => {
  await db.execute('UPDATE posts SET is_deleted=1 WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

router.post('/:id/like', auth, async (req, res) => {
  try {
    const [ex] = await db.execute('SELECT id FROM post_likes WHERE post_id=? AND user_id=?', [req.params.id, req.user.id]);
    if (ex.length) {
      await db.execute('DELETE FROM post_likes WHERE post_id=? AND user_id=?', [req.params.id, req.user.id]);
      return res.json({ liked: false });
    }
    await db.execute('INSERT INTO post_likes (post_id,user_id) VALUES (?,?)', [req.params.id, req.user.id]);
    const [p] = await db.execute('SELECT user_id FROM posts WHERE id=?', [req.params.id]);
    if (p.length && p[0].user_id !== req.user.id)
      await db.execute('INSERT INTO notifications (user_id,actor_id,type,reference_id) VALUES (?,?,?,?)',
        [p[0].user_id, req.user.id, 'POST_LIKE', req.params.id]);
    res.json({ liked: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }); }
});

router.get('/:id/comments', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT c.*,u.username,u.lol_game_name,u.avatar_url
     FROM post_comments c JOIN users u ON u.id=c.user_id
     WHERE c.post_id=? AND c.is_deleted=0 ORDER BY c.created_at ASC`,
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/comments', auth, async (req, res) => {
  const { content, parent_id } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Comentário vazio' });
  try {
    const [r] = await db.execute(
      'INSERT INTO post_comments (post_id,user_id,content,parent_id) VALUES (?,?,?,?)',
      [req.params.id, req.user.id, content.trim(), parent_id||null]
    );
    const [p] = await db.execute('SELECT user_id FROM posts WHERE id=?', [req.params.id]);
    if (p.length && p[0].user_id !== req.user.id)
      await db.execute('INSERT INTO notifications (user_id,actor_id,type,reference_id) VALUES (?,?,?,?)',
        [p[0].user_id, req.user.id, 'POST_COMMENT', req.params.id]);
    const [c] = await db.execute(
      `SELECT c.*,u.username,u.lol_game_name,u.avatar_url FROM post_comments c
       JOIN users u ON u.id=c.user_id WHERE c.id=?`, [r.insertId]
    );
    res.status(201).json(c[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao comentar' }); }
});

// Denunciar post
router.post('/:id/report', auth, async (req, res) => {
  const { reason, details } = req.body;
  if (!reason) return res.status(400).json({ error: 'Motivo obrigatório' });
  try {
    await db.execute(
      'INSERT INTO post_reports (post_id, reporter_id, reason, details) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE reason=VALUES(reason), details=VALUES(details), status="pending"',
      [req.params.id, req.user.id, reason, details || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao denunciar' });
  }
});


const VALID_REACTIONS = ['penta','int','gap','gg','carry','tilted','diff','ff'];

router.post('/:id/react', auth, async (req, res) => {
  const { reaction } = req.body;
  const postId = req.params.id;

  if (!VALID_REACTIONS.includes(reaction))
    return res.status(400).json({ error: 'Reação inválida' });

  try {
    const [existing] = await db.execute(
      'SELECT reaction FROM post_reactions WHERE post_id=? AND user_id=?',
      [postId, req.user.id]
    );

    if (existing.length && existing[0].reaction === reaction) {
      // Remover reação (toggle off)
      await db.execute('DELETE FROM post_reactions WHERE post_id=? AND user_id=?', [postId, req.user.id]);
      return res.json({ reaction: null, removed: true });
    }

    // Inserir ou atualizar
    await db.execute(
      'INSERT INTO post_reactions (post_id, user_id, reaction) VALUES (?,?,?) ON DUPLICATE KEY UPDATE reaction=?',
      [postId, req.user.id, reaction, reaction]
    );

    res.json({ reaction, removed: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});


// GET /posts/:id — post individual (para atualizar reações)
router.get('/:id', auth, async (req, res) => {
  try {
    // Post completo
    const [rows] = await db.execute(
      `SELECT p.id,p.content,p.queue_type,p.created_at,
              u.id AS user_id,u.username,u.display_name,u.lol_game_name,u.lol_tag_line,
              u.avatar_url,u.solo_tier,u.solo_rank,u.solo_lp,u.flex_tier,u.flex_rank,u.flex_lp,
              u.online_status,u.has_mic,u.custom_status,u.admin_role,
              (SELECT COUNT(*) FROM post_likes l WHERE l.post_id=p.id) AS total_likes,
              (SELECT COUNT(*) FROM post_comments c WHERE c.post_id=p.id AND c.is_deleted=0) AS total_comments,
              (SELECT COUNT(*) FROM post_likes lm WHERE lm.post_id=p.id AND lm.user_id=?) AS liked_by_me,
              pr_me.reaction AS my_reaction,
              react_agg.reactions_json
       FROM posts p
       JOIN users u ON u.id=p.user_id
       LEFT JOIN post_reactions pr_me ON pr_me.post_id=p.id AND pr_me.user_id=?
       LEFT JOIN (
         SELECT post_id, JSON_OBJECTAGG(reaction, cnt) AS reactions_json
         FROM (SELECT post_id, reaction, COUNT(*) AS cnt FROM post_reactions GROUP BY post_id, reaction) sub
         GROUP BY post_id
       ) react_agg ON react_agg.post_id=p.id
       WHERE p.id=? AND p.is_deleted=0`,
      [req.user.id, req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post não encontrado' });

    // Comentários do post
    const [comments] = await db.execute(
      `SELECT c.id,c.content,c.created_at,
              u.id AS user_id,u.username,u.display_name,u.lol_game_name,u.lol_tag_line,u.avatar_url,u.admin_role
       FROM post_comments c JOIN users u ON u.id=c.user_id
       WHERE c.post_id=? AND c.is_deleted=0 ORDER BY c.created_at ASC`,
      [req.params.id]
    );

    res.json({ post: rows[0], comments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;