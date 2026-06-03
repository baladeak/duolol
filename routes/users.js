const router = require('express').Router();
const axios  = require('axios');
const db     = require('../db/connection');
const auth   = require('../middleware/auth');

const RIOT_KEY = () => process.env.RIOT_API_KEY;
const REGION   = () => process.env.RIOT_REGION || 'br1';

const n = v => (v === undefined || v === null || v === '') ? null : v;
const i = v => parseInt(v) || 0;

// Recebe imagem como base64 — persiste no banco, sobrevive a redeploys
router.post('/me/avatar', auth, async (req, res) => {
  const { image } = req.body; // data:image/jpeg;base64,...
  if (!image || !image.startsWith('data:image/'))
    return res.status(400).json({ error: 'Imagem inválida' });
  // Limita a ~2MB em base64 (~1.5MB real)
  if (image.length > 2 * 1024 * 1024)
    return res.status(400).json({ error: 'Imagem muito grande. Máximo 1.5MB.' });
  await db.execute('UPDATE users SET avatar_url=? WHERE id=?', [image, req.user.id]);
  res.json({ avatar_url: image });
});

router.get('/stats/online', auth, async (req, res) => {
  const [r] = await db.execute(
    `SELECT COUNT(DISTINCT p.user_id) AS count FROM posts p
     JOIN users u ON u.id=p.user_id
     WHERE p.is_deleted=0 AND p.created_at>=NOW()-INTERVAL 3 HOUR AND u.online_status!='offline'`
  );
  res.json({ count: r[0].count });
});

router.get('/me', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT id,username,display_name,email,lol_game_name,lol_tag_line,avatar_url,bio,chat_muted,main_champions,profile_banner,
            solo_tier,solo_rank,solo_lp,solo_wins,solo_losses,
            flex_tier,flex_rank,flex_lp,flex_wins,flex_losses,
            online_status,elo_last_updated_at,created_at
     FROM users WHERE id=?`, [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
  const [roles] = await db.execute('SELECT role,priority FROM user_roles WHERE user_id=? ORDER BY priority', [req.user.id]);
  const [stats] = await db.execute(
    `SELECT
      (SELECT COUNT(*) FROM posts WHERE user_id=? AND is_deleted=0) AS total_posts,
      (SELECT COUNT(*) FROM friendships WHERE user_a_id=? OR user_b_id=?) AS total_friends,
      (SELECT COUNT(*) FROM post_likes pl JOIN posts p ON p.id=pl.post_id WHERE p.user_id=?) AS total_likes_received`,
    [req.user.id, req.user.id, req.user.id, req.user.id]
  );
  res.json({ ...rows[0], roles, ...stats[0] });
});

router.get('/me/friends', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT u.id,u.username,u.display_name,u.lol_game_name,u.lol_tag_line,u.avatar_url,
            u.solo_tier,u.solo_rank,u.flex_tier,u.flex_rank,u.online_status,u.last_seen_at
     FROM friendships f
     JOIN users u ON u.id=IF(f.user_a_id=?,f.user_b_id,f.user_a_id)
     WHERE (f.user_a_id=? OR f.user_b_id=?)
     ORDER BY u.online_status='online' DESC,u.username ASC`,
    [req.user.id, req.user.id, req.user.id]
  );
  res.json(rows);
});

router.post('/me/friend-request', auth, async (req, res) => {
  const { receiver_id } = req.body;
  if (receiver_id == req.user.id) return res.status(400).json({ error: 'Não pode adicionar a si mesmo' });
  try {
    const [fr] = await db.execute('INSERT IGNORE INTO friend_requests (sender_id,receiver_id) VALUES (?,?)', [req.user.id, receiver_id]);
    const frId = fr.insertId || null;
    await db.execute('INSERT INTO notifications (user_id,actor_id,type,reference_id) VALUES (?,?,?,?)', [receiver_id, req.user.id, 'FRIEND_REQUEST', frId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// Responder por sender_id (usado pelas notificações)
router.post('/me/friend-request/respond', auth, async (req, res) => {
  const { sender_id, action } = req.body;
  // Busca qualquer solicitação pendente (sem filtrar status — compatível com bancos sem DEFAULT)
  const [fr] = await db.execute(
    `SELECT * FROM friend_requests
     WHERE sender_id=? AND receiver_id=?
       AND COALESCE(status,'PENDING') NOT IN ('ACCEPTED','REJECTED')
     LIMIT 1`,
    [sender_id, req.user.id]
  );
  if (!fr.length) {
    // Fallback: verifica se já são amigos (solicitação já foi aceita antes)
    const a = Math.min(parseInt(sender_id), req.user.id);
    const b = Math.max(parseInt(sender_id), req.user.id);
    const [existing] = await db.execute('SELECT id FROM friendships WHERE user_a_id=? AND user_b_id=?', [a, b]);
    if (existing.length) return res.json({ ok: true, already_friends: true });
    return res.status(404).json({ error: 'Solicitação não encontrada' });
  }
  const req_ = fr[0];
  if (action === 'accept') {
    await db.execute('UPDATE friend_requests SET status="ACCEPTED" WHERE id=?', [req_.id]);
    const a = Math.min(req_.sender_id, req_.receiver_id);
    const b = Math.max(req_.sender_id, req_.receiver_id);
    await db.execute('INSERT IGNORE INTO friendships (user_a_id,user_b_id) VALUES (?,?)', [a, b]);
    await db.execute('INSERT INTO notifications (user_id,actor_id,type) VALUES (?,?,?)', [req_.sender_id, req.user.id, 'FRIEND_ACCEPTED']);
  } else {
    await db.execute('UPDATE friend_requests SET status="REJECTED" WHERE id=?', [req_.id]);
  }
  res.json({ ok: true });
});

router.patch('/me/friend-request/:id', auth, async (req, res) => {
  const { action } = req.body;
  const [fr] = await db.execute('SELECT * FROM friend_requests WHERE id=? AND receiver_id=?', [req.params.id, req.user.id]);
  if (!fr.length) return res.status(404).json({ error: 'Não encontrada' });
  const req_ = fr[0];
  if (action === 'accept') {
    await db.execute('UPDATE friend_requests SET status=? WHERE id=?', ['ACCEPTED', req.params.id]);
    const a = Math.min(req_.sender_id, req_.receiver_id);
    const b = Math.max(req_.sender_id, req_.receiver_id);
    await db.execute('INSERT IGNORE INTO friendships (user_a_id,user_b_id) VALUES (?,?)', [a, b]);
    await db.execute('INSERT INTO notifications (user_id,actor_id,type) VALUES (?,?,?)', [req_.sender_id, req.user.id, 'FRIEND_ACCEPTED']);
  } else {
    await db.execute('UPDATE friend_requests SET status=? WHERE id=?', ['REJECTED', req.params.id]);
  }
  res.json({ ok: true });
});

router.patch('/me', auth, async (req, res) => {
  const { bio, roles, display_name, chat_muted, main_champions, profile_banner } = req.body;
  if (display_name !== undefined) {
    const dn = display_name.trim().slice(0, 60) || null;
    await db.execute('UPDATE users SET display_name=? WHERE id=?', [dn, req.user.id]);
  }
  if (bio !== undefined) await db.execute('UPDATE users SET bio=? WHERE id=?', [bio, req.user.id]);
  if (chat_muted !== undefined) await db.execute('UPDATE users SET chat_muted=? WHERE id=?', [chat_muted ? 1 : 0, req.user.id]);
  if (profile_banner !== undefined) {
    // Formato esperado: "ChampionKey_SkinNum" ex: "Xerath_1"
    const safe = typeof profile_banner === 'string' ? profile_banner.replace(/[^a-zA-Z0-9_]/g,'').slice(0,60) : null;
    await db.execute('UPDATE users SET profile_banner=? WHERE id=?', [safe||null, req.user.id]);
  }
  if (Array.isArray(main_champions)) {
    const VALID_ROLES = ['TOP','JUNGLE','MID','ADC','SUPPORT'];
    const champs = main_champions.slice(0, 3).filter(c => typeof c === 'string' && c.length <= 50);
    await db.execute('UPDATE users SET main_champions=? WHERE id=?', [JSON.stringify(champs), req.user.id]);
  }
  if (Array.isArray(roles)) {
    const VALID_ROLES = ['TOP','JUNGLE','MID','ADC','SUPPORT'];
    const validRoles = roles.filter(r => VALID_ROLES.includes(r)).slice(0, 2);
    await db.execute('DELETE FROM user_roles WHERE user_id=?', [req.user.id]);
    for (let idx = 0; idx < validRoles.length; idx++)
      await db.execute('INSERT IGNORE INTO user_roles (user_id,role,priority) VALUES (?,?,?)', [req.user.id, validRoles[idx], idx+1]);
  }
  res.json({ ok: true });
});

// Remover amizade
router.delete('/me/friends/:id', auth, async (req, res) => {
  const a = Math.min(req.user.id, parseInt(req.params.id));
  const b = Math.max(req.user.id, parseInt(req.params.id));
  await db.execute('DELETE FROM friendships WHERE user_a_id=? AND user_b_id=?', [a, b]);
  res.json({ ok: true });
});

// Bloquear usuário
router.post('/me/block/:id', auth, async (req, res) => {
  const targetId = parseInt(req.params.id);
  if (targetId === req.user.id) return res.status(400).json({ error: 'Não pode bloquear a si mesmo' });
  // Remove amizade ao bloquear
  const a = Math.min(req.user.id, targetId);
  const b = Math.max(req.user.id, targetId);
  await db.execute('DELETE FROM friendships WHERE user_a_id=? AND user_b_id=?', [a, b]);
  await db.execute('INSERT IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?,?)', [req.user.id, targetId]);
  res.json({ ok: true });
});

// Desbloquear usuário
router.delete('/me/block/:id', auth, async (req, res) => {
  await db.execute('DELETE FROM user_blocks WHERE blocker_id=? AND blocked_id=?', [req.user.id, parseInt(req.params.id)]);
  res.json({ ok: true });
});

// Checar se um usuário está bloqueado
router.get('/me/block/:id', auth, async (req, res) => {
  const [r] = await db.execute('SELECT id FROM user_blocks WHERE blocker_id=? AND blocked_id=?', [req.user.id, parseInt(req.params.id)]);
  res.json({ blocked: r.length > 0 });
});

router.post('/me/sync-elo', auth, async (req, res) => {
  const key = RIOT_KEY();
  if (!key || key.includes('xxxxxxxx'))
    return res.json({ warning: 'Chave da Riot API não configurada.' });
  try {
    const [user] = await db.execute(
      'SELECT lol_game_name,lol_tag_line,lol_puuid FROM users WHERE id=?',
      [req.user.id]
    );
    const u = user[0];
    let puuid = u.lol_puuid;

    // Passo 1: buscar PUUID pelo Riot ID (account-v1) — aprovado
    if (!puuid) {
      const { data: acc } = await axios.get(
        `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(u.lol_game_name)}/${encodeURIComponent(u.lol_tag_line)}`,
        { headers: { 'X-Riot-Token': key } }
      );
      puuid = acc.puuid;
      await db.execute('UPDATE users SET lol_puuid=? WHERE id=?', [n(puuid), req.user.id]);
    }

    // Passo 2: buscar elo direto pelo PUUID (league-v4/entries/by-puuid) — aprovado
    const { data: leagues } = await axios.get(
      `https://${REGION()}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`,
      { headers: { 'X-Riot-Token': key } }
    );

    const solo = leagues.find(l => l.queueType === 'RANKED_SOLO_5x5');
    const flex = leagues.find(l => l.queueType === 'RANKED_FLEX_SR');

    if (solo) {
      await db.execute(
        'UPDATE users SET solo_tier=?,solo_rank=?,solo_lp=?,solo_wins=?,solo_losses=?,elo_last_updated_at=NOW() WHERE id=?',
        [n(solo.tier), n(solo.rank), i(solo.leaguePoints), i(solo.wins), i(solo.losses), req.user.id]
      );
      await db.execute(
        'INSERT INTO elo_history (user_id,queue_type,tier,`rank`,lp,wins,losses) VALUES (?,?,?,?,?,?,?)',
        [req.user.id, 'SOLO', n(solo.tier), n(solo.rank), i(solo.leaguePoints), i(solo.wins), i(solo.losses)]
      );
    }

    if (flex) {
      await db.execute(
        'UPDATE users SET flex_tier=?,flex_rank=?,flex_lp=?,flex_wins=?,flex_losses=?,elo_last_updated_at=NOW() WHERE id=?',
        [n(flex.tier), n(flex.rank), i(flex.leaguePoints), i(flex.wins), i(flex.losses), req.user.id]
      );
      await db.execute(
        'INSERT INTO elo_history (user_id,queue_type,tier,`rank`,lp,wins,losses) VALUES (?,?,?,?,?,?,?)',
        [req.user.id, 'FLEX', n(flex.tier), n(flex.rank), i(flex.leaguePoints), i(flex.wins), i(flex.losses)]
      );
    }

    await db.execute('INSERT INTO notifications (user_id,type,body) VALUES (?,?,?)',
      [req.user.id, 'ELO_UPDATE', 'Seu elo foi atualizado com sucesso!']);

    res.json({ solo: solo || null, flex: flex || null });
  } catch (err) {
    console.error('Riot API:', err.response?.data || err.message);
    res.status(500).json({ error: 'Riot API: ' + JSON.stringify(err.response?.data || err.message) });
  }
});

router.get('/', auth, async (req, res) => {
  const { q, tier, queue = 'SOLO', page = 1 } = req.query;
  const offset = (parseInt(page)-1)*20;
  let where = 'u.id!=? AND u.is_banned=0', params = [req.user.id];
  if (q) { where += ' AND (u.lol_game_name LIKE ? OR u.display_name LIKE ? OR u.username LIKE ?)'; params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  if (tier) { where += ` AND u.${queue==='FLEX'?'flex_tier':'solo_tier'}=?`; params.push(tier.toUpperCase()); }
  const [users] = await db.execute(
    `SELECT u.id,u.username,u.display_name,u.lol_game_name,u.lol_tag_line,u.avatar_url,
            u.solo_tier,u.solo_rank,u.solo_lp,u.flex_tier,u.flex_rank,u.flex_lp,u.online_status
     FROM users u WHERE ${where}
     ORDER BY u.online_status='online' DESC,u.updated_at DESC LIMIT 20 OFFSET ${offset}`,
    params
  );
  res.json(users);
});

router.get('/:id', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT id,username,display_name,lol_game_name,lol_tag_line,avatar_url,bio,main_champions,profile_banner,
            solo_tier,solo_rank,solo_lp,solo_wins,solo_losses,
            flex_tier,flex_rank,flex_lp,flex_wins,flex_losses,online_status
     FROM users WHERE id=?`, [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
  const [roles] = await db.execute('SELECT role,priority FROM user_roles WHERE user_id=? ORDER BY priority', [req.params.id]);
  const [fs] = await db.execute(
    'SELECT id FROM friendships WHERE (user_a_id=? AND user_b_id=?) OR (user_a_id=? AND user_b_id=?) LIMIT 1',
    [req.user.id, req.params.id, req.params.id, req.user.id]
  );
  const [bl] = await db.execute(
    'SELECT id FROM user_blocks WHERE blocker_id=? AND blocked_id=? LIMIT 1',
    [req.user.id, req.params.id]
  );
  res.json({ ...rows[0], roles, is_friend: fs.length > 0, is_blocked: bl.length > 0 });
});

module.exports = router;