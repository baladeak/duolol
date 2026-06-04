const router = require('express').Router();
const db     = require('../db/connection');
const auth   = require('../middleware/auth');

// ── Listar / buscar grupos ─────────────────────
router.get('/', auth, async (req, res) => {
  const { q, page = 1 } = req.query;
  const offset = (parseInt(page) - 1) * 20;
  let where = '1=1', params = [];
  if (q) { where = '(g.name LIKE ? OR g.tag LIKE ? OR g.description LIKE ?)'; params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  const [rows] = await db.execute(
    `SELECT g.id, g.name, g.tag, g.description, g.is_public, g.avatar_url, g.banner_url, g.created_at,
            u.username AS owner_username, u.display_name AS owner_display_name,
            (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
            (SELECT role FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = ?) AS my_role
     FROM \`groups\` g
     JOIN users u ON u.id = g.owner_id
     WHERE ${where}
     ORDER BY member_count DESC, g.created_at DESC
     LIMIT 20 OFFSET ${offset}`,
    [req.user.id, ...params]
  );
  res.json(rows);
});

// ── Criar grupo ────────────────────────────────
router.post('/', auth, async (req, res) => {
  const { name, tag, description, is_public = 1 } = req.body;
  if (!name?.trim() || name.length > 60) return res.status(400).json({ error: 'Nome inválido (máx 60 chars)' });
  if (!tag?.trim()  || tag.length > 8)  return res.status(400).json({ error: 'Tag inválida (máx 8 chars)' });
  try {
    const [r] = await db.execute(
      'INSERT INTO `groups` (name, tag, description, owner_id, is_public) VALUES (?,?,?,?,?)',
      [name.trim(), tag.trim().toUpperCase(), description?.trim() || null, req.user.id, is_public ? 1 : 0]
    );
    // Dono entra automaticamente como owner
    await db.execute('INSERT INTO group_members (group_id, user_id, role) VALUES (?,?,?)', [r.insertId, req.user.id, 'owner']);
    res.status(201).json({ id: r.insertId, name: name.trim(), tag: tag.trim().toUpperCase() });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Tag já existe' });
    console.error(err); res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Detalhes do grupo ──────────────────────────
router.get('/:id', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT g.*, u.username AS owner_username, u.display_name AS owner_display_name,
            (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count,
            (SELECT role FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = ?) AS my_role,
            (SELECT status FROM group_requests gr WHERE gr.group_id = g.id AND gr.user_id = ? AND gr.status = 'pending') AS my_request
     FROM \`groups\` g JOIN users u ON u.id = g.owner_id
     WHERE g.id = ?`, [req.user.id, req.user.id, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Grupo não encontrado' });
  res.json(rows[0]);
});

// ── Membros ────────────────────────────────────
router.get('/:id/members', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.lol_game_name, u.lol_tag_line,
            u.solo_tier, u.solo_rank, u.flex_tier, u.flex_rank, u.online_status, u.has_mic,
            gm.role, gm.joined_at
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ?
     ORDER BY FIELD(gm.role,'owner','admin','member'), u.username ASC`,
    [req.params.id]
  );
  res.json(rows);
});

// ── Entrar / solicitar entrada ─────────────────
router.post('/:id/join', auth, async (req, res) => {
  const { message } = req.body;
  const [group] = await db.execute('SELECT id, is_public FROM `groups` WHERE id=?', [req.params.id]);
  if (!group.length) return res.status(404).json({ error: 'Grupo não encontrado' });

  // Verificar se já é membro
  const [existing] = await db.execute('SELECT id FROM group_members WHERE group_id=? AND user_id=?', [req.params.id, req.user.id]);
  if (existing.length) return res.status(409).json({ error: 'Você já é membro' });

  if (group[0].is_public) {
    // Grupo público: entra direto
    await db.execute('INSERT IGNORE INTO group_members (group_id, user_id, role) VALUES (?,?,?)', [req.params.id, req.user.id, 'member']);
    res.json({ ok: true, status: 'joined' });
  } else {
    // Grupo privado: solicita entrada
    try {
      await db.execute('INSERT IGNORE INTO group_requests (group_id, user_id, message) VALUES (?,?,?)', [req.params.id, req.user.id, message?.trim() || null]);
      // Notificar admins/owner
      const [admins] = await db.execute("SELECT user_id FROM group_members WHERE group_id=? AND role IN ('owner','admin')", [req.params.id]);
      for (const a of admins) {
        await db.execute('INSERT INTO notifications (user_id, actor_id, type, reference_id, body) VALUES (?,?,?,?,?)',
          [a.user_id, req.user.id, 'SYSTEM', req.params.id, `Novo pedido de entrada no grupo`]);
      }
      res.json({ ok: true, status: 'requested' });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Solicitação já enviada' });
      res.status(500).json({ error: 'Erro interno' });
    }
  }
});

// ── Sair do grupo ──────────────────────────────
router.delete('/:id/leave', auth, async (req, res) => {
  const [mem] = await db.execute("SELECT role FROM group_members WHERE group_id=? AND user_id=?", [req.params.id, req.user.id]);
  if (!mem.length) return res.status(404).json({ error: 'Você não é membro' });
  if (mem[0].role === 'owner') return res.status(400).json({ error: 'O dono não pode sair. Exclua o grupo.' });
  await db.execute('DELETE FROM group_members WHERE group_id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ── Excluir grupo (somente dono) ───────────────
router.delete('/:id', auth, async (req, res) => {
  const [mem] = await db.execute("SELECT role FROM group_members WHERE group_id=? AND user_id=?", [req.params.id, req.user.id]);
  if (!mem.length || mem[0].role !== 'owner') return res.status(403).json({ error: 'Somente o dono pode excluir o grupo' });
  await db.execute('DELETE FROM group_messages WHERE group_id=?', [req.params.id]);
  await db.execute('DELETE FROM group_post_likes WHERE post_id IN (SELECT id FROM group_posts WHERE group_id=?)', [req.params.id]);
  await db.execute('DELETE FROM group_posts WHERE group_id=?', [req.params.id]);
  await db.execute('DELETE FROM group_requests WHERE group_id=?', [req.params.id]);
  await db.execute('DELETE FROM group_members WHERE group_id=?', [req.params.id]);
  await db.execute('DELETE FROM `groups` WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ── Solicitações pendentes ─────────────────────
router.get('/:id/requests', auth, async (req, res) => {
  const [mem] = await db.execute("SELECT role FROM group_members WHERE group_id=? AND user_id=?", [req.params.id, req.user.id]);
  if (!mem.length || !['owner','admin'].includes(mem[0].role)) return res.status(403).json({ error: 'Sem permissão' });
  const [rows] = await db.execute(
    `SELECT gr.id, gr.message, gr.created_at,
            u.id AS user_id, u.username, u.display_name, u.avatar_url, u.lol_game_name, u.lol_tag_line,
            u.solo_tier, u.solo_rank, u.flex_tier, u.flex_rank
     FROM group_requests gr JOIN users u ON u.id = gr.user_id
     WHERE gr.group_id = ? AND gr.status = 'pending'
     ORDER BY gr.created_at ASC`, [req.params.id]
  );
  res.json(rows);
});

// ── Aprovar / rejeitar solicitação ─────────────
router.patch('/:id/requests/:reqId', auth, async (req, res) => {
  const { action } = req.body; // 'approve' | 'reject'
  const [mem] = await db.execute("SELECT role FROM group_members WHERE group_id=? AND user_id=?", [req.params.id, req.user.id]);
  if (!mem.length || !['owner','admin'].includes(mem[0].role)) return res.status(403).json({ error: 'Sem permissão' });
  const [reqRow] = await db.execute('SELECT * FROM group_requests WHERE id=? AND group_id=?', [req.params.reqId, req.params.id]);
  if (!reqRow.length) return res.status(404).json({ error: 'Solicitação não encontrada' });

  if (action === 'approve') {
    await db.execute('UPDATE group_requests SET status=? WHERE id=?', ['approved', req.params.reqId]);
    await db.execute('INSERT IGNORE INTO group_members (group_id, user_id, role) VALUES (?,?,?)', [req.params.id, reqRow[0].user_id, 'member']);
    await db.execute('INSERT INTO notifications (user_id, actor_id, type, reference_id, body) VALUES (?,?,?,?,?)',
      [reqRow[0].user_id, req.user.id, 'SYSTEM', req.params.id, 'Sua solicitação foi aprovada!']);
  } else {
    await db.execute('UPDATE group_requests SET status=? WHERE id=?', ['rejected', req.params.reqId]);
  }
  res.json({ ok: true });
});

// ── Gerenciar cargo de membro ──────────────────
router.patch('/:id/members/:userId/role', auth, async (req, res) => {
  const { role } = req.body; // 'admin' | 'member'
  if (!['admin','member'].includes(role)) return res.status(400).json({ error: 'Cargo inválido' });
  // Somente o dono pode mudar cargos
  const [myMem] = await db.execute("SELECT role FROM group_members WHERE group_id=? AND user_id=?", [req.params.id, req.user.id]);
  if (!myMem.length || myMem[0].role !== 'owner') return res.status(403).json({ error: 'Somente o dono pode mudar cargos' });
  // Não pode mudar o próprio cargo
  if (req.params.userId == req.user.id) return res.status(400).json({ error: 'Não pode mudar seu próprio cargo' });
  await db.execute('UPDATE group_members SET role=? WHERE group_id=? AND user_id=?', [role, req.params.id, req.params.userId]);
  res.json({ ok: true });
});

// ── Expulsar membro ────────────────────────────
router.delete('/:id/members/:userId', auth, async (req, res) => {
  const [myMem] = await db.execute("SELECT role FROM group_members WHERE group_id=? AND user_id=?", [req.params.id, req.user.id]);
  if (!myMem.length || !['owner','admin'].includes(myMem[0].role)) return res.status(403).json({ error: 'Sem permissão' });
  const [target] = await db.execute("SELECT role FROM group_members WHERE group_id=? AND user_id=?", [req.params.id, req.params.userId]);
  if (!target.length) return res.status(404).json({ error: 'Membro não encontrado' });
  if (target[0].role === 'owner') return res.status(400).json({ error: 'Não pode expulsar o dono' });
  if (target[0].role === 'admin' && myMem[0].role !== 'owner') return res.status(403).json({ error: 'Somente o dono pode expulsar admins' });
  await db.execute('DELETE FROM group_members WHERE group_id=? AND user_id=?', [req.params.id, req.params.userId]);
  res.json({ ok: true });
});

// ── Posts do grupo ─────────────────────────────
router.get('/:id/posts', auth, async (req, res) => {
  const [mem] = await db.execute('SELECT id FROM group_members WHERE group_id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!mem.length) return res.status(403).json({ error: 'Apenas membros podem ver posts' });
  const [rows] = await db.execute(
    `SELECT gp.id, gp.content, gp.created_at, gp.is_deleted,
            u.id AS user_id, u.username, u.display_name, u.avatar_url, u.lol_game_name, u.lol_tag_line,
            u.solo_tier, u.solo_rank, u.flex_tier, u.flex_rank, u.has_mic,
            (SELECT COUNT(*) FROM group_post_likes l WHERE l.post_id = gp.id) AS total_likes,
            (SELECT COUNT(*) FROM group_post_likes l WHERE l.post_id = gp.id AND l.user_id = ?) AS liked_by_me
     FROM group_posts gp JOIN users u ON u.id = gp.user_id
     WHERE gp.group_id = ? AND gp.is_deleted = 0
     ORDER BY gp.created_at DESC LIMIT 50`, [req.user.id, req.params.id]
  );
  res.json(rows);
});

router.post('/:id/posts', auth, async (req, res) => {
  const [mem] = await db.execute('SELECT id FROM group_members WHERE group_id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!mem.length) return res.status(403).json({ error: 'Apenas membros podem postar' });
  const { content } = req.body;
  if (!content?.trim() || content.length > 500) return res.status(400).json({ error: 'Conteúdo inválido' });
  const [r] = await db.execute('INSERT INTO group_posts (group_id, user_id, content) VALUES (?,?,?)', [req.params.id, req.user.id, content.trim()]);
  res.status(201).json({ id: r.insertId, content: content.trim(), created_at: new Date(), user_id: req.user.id });
});

router.post('/:id/posts/:postId/like', auth, async (req, res) => {
  const [ex] = await db.execute('SELECT id FROM group_post_likes WHERE post_id=? AND user_id=?', [req.params.postId, req.user.id]);
  if (ex.length) {
    await db.execute('DELETE FROM group_post_likes WHERE post_id=? AND user_id=?', [req.params.postId, req.user.id]);
    return res.json({ liked: false });
  }
  await db.execute('INSERT INTO group_post_likes (post_id, user_id) VALUES (?,?)', [req.params.postId, req.user.id]);
  res.json({ liked: true });
});

router.delete('/:id/posts/:postId', auth, async (req, res) => {
  const [mem] = await db.execute("SELECT role FROM group_members WHERE group_id=? AND user_id=?", [req.params.id, req.user.id]);
  const [post] = await db.execute('SELECT user_id FROM group_posts WHERE id=?', [req.params.postId]);
  if (!post.length) return res.status(404).json({ error: 'Post não encontrado' });
  const canDelete = post[0].user_id === req.user.id || ['owner','admin'].includes(mem[0]?.role);
  if (!canDelete) return res.status(403).json({ error: 'Sem permissão' });
  await db.execute('UPDATE group_posts SET is_deleted=1 WHERE id=?', [req.params.postId]);
  res.json({ ok: true });
});

// ── Chat do grupo ──────────────────────────────
router.get('/:id/messages', auth, async (req, res) => {
  const [mem] = await db.execute('SELECT id FROM group_members WHERE group_id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!mem.length) return res.status(403).json({ error: 'Apenas membros' });
  const [rows] = await db.execute(
    `SELECT gm.id, gm.content, gm.created_at, gm.user_id,
            u.username, u.display_name, u.avatar_url
     FROM group_messages gm JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ? ORDER BY gm.created_at DESC LIMIT 60`,
    [req.params.id]
  );
  res.json(rows.reverse());
});

router.post('/:id/messages', auth, async (req, res) => {
  const [mem] = await db.execute('SELECT id FROM group_members WHERE group_id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!mem.length) return res.status(403).json({ error: 'Apenas membros' });
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Mensagem vazia' });
  const [r] = await db.execute('INSERT INTO group_messages (group_id, user_id, content) VALUES (?,?,?)', [req.params.id, req.user.id, content.trim()]);

  // Broadcast via socket
  if (global._io) {
    const [userRows] = await db.execute('SELECT username, display_name, avatar_url FROM users WHERE id=?', [req.user.id]);
    const u = userRows[0] || {};
    global._io.to(`group_${req.params.id}`).emit('group_message', {
      id: r.insertId, group_id: parseInt(req.params.id),
      content: content.trim(), created_at: new Date(),
      user_id: req.user.id, username: u.username,
      display_name: u.display_name, avatar_url: u.avatar_url
    });
  }
  res.status(201).json({ id: r.insertId, content: content.trim(), created_at: new Date() });
});

// ── Atualizar grupo ────────────────────────────
router.patch('/:id', auth, async (req, res) => {
  const [mem] = await db.execute("SELECT role FROM group_members WHERE group_id=? AND user_id=?", [req.params.id, req.user.id]);
  if (!mem.length || !['owner','admin'].includes(mem[0].role)) return res.status(403).json({ error: 'Sem permissão' });
  const { description, is_public, avatar_url, banner_url } = req.body;
  if (description !== undefined) await db.execute('UPDATE `groups` SET description=? WHERE id=?', [description?.trim()||null, req.params.id]);
  if (is_public  !== undefined) await db.execute('UPDATE `groups` SET is_public=? WHERE id=?', [is_public?1:0, req.params.id]);
  if (avatar_url !== undefined) await db.execute('UPDATE `groups` SET avatar_url=? WHERE id=?', [avatar_url||null, req.params.id]);
  if (banner_url !== undefined) await db.execute('UPDATE `groups` SET banner_url=? WHERE id=?', [banner_url||null, req.params.id]);
  res.json({ ok: true });
});

module.exports = router;